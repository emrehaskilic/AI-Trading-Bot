/**
 * [FAZ-6] Churn Detector - M3 Mitigation Patch
 * 
 * Detects and mitigates churn conditions (excessive flip rate):
 * - Flip rate > threshold (5 minutes, 3+ flips)
 * - Chop score > 0.7
 * 
 * Actions: NO_TRADE or confidence cap (0.5)
 */

export interface ChurnDetectionConfig {
  // Window size for flip tracking (ms)
  flipWindowMs: number;
  // Maximum flips allowed in window
  maxFlipsInWindow: number;
  // Chop score threshold for churn
  chopScoreThreshold: number;
  // Confidence cap when churn detected (0-1)
  confidenceCap: number;
  // Minimum samples for chop calculation
  minChopSamples: number;
  // Recovery time after churn (ms)
  recoveryTimeMs: number;
}

export interface FlipEvent {
  fromSide: 'BUY' | 'SELL' | null;
  toSide: 'BUY' | 'SELL';
  timestampMs: number;
  price: number;
}

export interface ChurnDetectionResult {
  isChurning: boolean;
  flipCount: number;
  flipRatePerMinute: number;
  chopScore: number;
  confidenceCap: number;
  action: 'NO_TRADE' | 'CAP_CONFIDENCE' | 'ALLOW';
  reason: string;
  recoveryRemainingMs: number;
}

export interface ChurnDetectorStatus {
  totalFlips: number;
  flipsInWindow: number;
  isChurning: boolean;
  inRecovery: boolean;
  avgFlipIntervalMs: number;
  lastFlipMs: number;
  currentChopScore: number;
  totalChurnEvents: number;
}

const DEFAULT_CONFIG: ChurnDetectionConfig = {
  flipWindowMs: 5 * 60 * 1000,    // 5 minutes
  maxFlipsInWindow: 3,             // 3+ flips = churn
  chopScoreThreshold: 0.7,         // 0.7+ chop = churn
  confidenceCap: 0.5,              // 50% confidence cap
  minChopSamples: 10,              // Need 10 samples
  recoveryTimeMs: 30 * 1000,       // 30 second recovery
};

/**
 * Churn Detector - Monitors flip rate and chop conditions
 */
export class ChurnDetector {
  private readonly config: ChurnDetectionConfig;
  private readonly flips: FlipEvent[] = [];
  private readonly chopSamples: number[] = [];
  private readonly symbol: string;
  
  private totalFlips = 0;
  private lastFlipMs = 0;
  private totalChurnEvents = 0;
  private lastChurnMs = 0;
  private currentSide: 'BUY' | 'SELL' | null = null;

  constructor(symbol: string, config?: Partial<ChurnDetectionConfig>) {
    this.symbol = symbol;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a side change (flip)
   */
  recordFlip(
    newSide: 'BUY' | 'SELL',
    price: number,
    timestampMs: number
  ): ChurnDetectionResult {
    // Only record if side actually changed
    if (newSide !== this.currentSide && this.currentSide !== null) {
      const flip: FlipEvent = {
        fromSide: this.currentSide,
        toSide: newSide,
        timestampMs,
        price,
      };
      
      this.flips.push(flip);
      this.totalFlips++;
      this.lastFlipMs = timestampMs;
    }

    this.currentSide = newSide;

    // Prune old flips
    this.pruneFlips(timestampMs);

    // Return detection result
    return this.detectChurn(timestampMs);
  }

  /**
   * Record chop score sample
   */
  recordChopScore(chopScore: number, timestampMs: number): void {
    this.chopSamples.push(chopScore);
    
    // Keep only recent samples
    while (this.chopSamples.length > this.config.minChopSamples * 2) {
      this.chopSamples.shift();
    }
  }

  /**
   * Check if trading should be allowed
   */
  canTrade(nowMs: number): boolean {
    const result = this.detectChurn(nowMs);
    return result.action !== 'NO_TRADE';
  }

  /**
   * Get confidence multiplier (capped during churn)
   */
  getConfidenceMultiplier(nowMs: number): number {
    const result = this.detectChurn(nowMs);
    if (result.action === 'NO_TRADE') return 0;
    if (result.action === 'CAP_CONFIDENCE') return this.config.confidenceCap;
    return 1.0;
  }

  /**
   * Detect churn conditions
   */
  detectChurn(nowMs: number): ChurnDetectionResult {
    const flipsInWindow = this.flips.length;
    const flipRatePerMinute = flipsInWindow / (this.config.flipWindowMs / 60000);
    
    // Calculate chop score (average of recent samples)
    const chopScore = this.calculateChopScore();
    
    // Check recovery period
    const inRecovery = this.isInRecovery(nowMs);
    const recoveryRemaining = this.getRecoveryRemainingMs(nowMs);

    // Determine if churning
    const flipThresholdExceeded = flipsInWindow >= this.config.maxFlipsInWindow;
    const chopThresholdExceeded = chopScore >= this.config.chopScoreThreshold;
    const isChurning = (flipThresholdExceeded || chopThresholdExceeded) && !inRecovery;

    // Record churn event
    if (isChurning && (nowMs - this.lastChurnMs) > this.config.recoveryTimeMs) {
      this.lastChurnMs = nowMs;
      this.totalChurnEvents++;
    }

    // Determine action
    let action: 'NO_TRADE' | 'CAP_CONFIDENCE' | 'ALLOW' = 'ALLOW';
    let reason = 'normal_conditions';
    let confidenceCap = 1.0;

    if (isChurning) {
      if (flipThresholdExceeded && chopThresholdExceeded) {
        action = 'NO_TRADE';
        reason = 'high_flip_rate_and_chop';
        confidenceCap = 0;
      } else if (flipThresholdExceeded) {
        action = 'CAP_CONFIDENCE';
        reason = 'high_flip_rate';
        confidenceCap = this.config.confidenceCap;
      } else {
        action = 'CAP_CONFIDENCE';
        reason = 'high_chop_score';
        confidenceCap = this.config.confidenceCap;
      }
    } else if (inRecovery) {
      action = 'CAP_CONFIDENCE';
      reason = 'churn_recovery_period';
      confidenceCap = this.config.confidenceCap + 
        ((1 - this.config.confidenceCap) * (1 - recoveryRemaining / this.config.recoveryTimeMs));
    }

    return {
      isChurning,
      flipCount: flipsInWindow,
      flipRatePerMinute,
      chopScore,
      confidenceCap,
      action,
      reason,
      recoveryRemainingMs: recoveryRemaining,
    };
  }

  /**
   * Get current detector status
   */
  getStatus(nowMs: number): ChurnDetectorStatus {
    this.pruneFlips(nowMs);
    
    const avgInterval = this.calculateAvgFlipInterval();
    const result = this.detectChurn(nowMs);

    return {
      totalFlips: this.totalFlips,
      flipsInWindow: this.flips.length,
      isChurning: result.isChurning,
      inRecovery: this.isInRecovery(nowMs),
      avgFlipIntervalMs: avgInterval,
      lastFlipMs: this.lastFlipMs,
      currentChopScore: this.calculateChopScore(),
      totalChurnEvents: this.totalChurnEvents,
    };
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.flips.length = 0;
    this.chopSamples.length = 0;
    this.totalFlips = 0;
    this.lastFlipMs = 0;
    this.totalChurnEvents = 0;
    this.lastChurnMs = 0;
    this.currentSide = null;
  }

  /**
   * Force churn detection (for testing/emergency)
   */
  forceChurn(timestampMs: number): void {
    this.lastChurnMs = timestampMs;
    this.totalChurnEvents++;
  }

  private pruneFlips(nowMs: number): void {
    const cutoff = nowMs - this.config.flipWindowMs;
    while (this.flips.length > 0 && this.flips[0].timestampMs < cutoff) {
      this.flips.shift();
    }
  }

  private calculateChopScore(): number {
    if (this.chopSamples.length < this.config.minChopSamples) {
      return 0;
    }
    // Return average of recent chop scores
    const sum = this.chopSamples.reduce((a, b) => a + b, 0);
    return sum / this.chopSamples.length;
  }

  private calculateAvgFlipInterval(): number {
    if (this.flips.length < 2) return 0;
    
    let totalInterval = 0;
    for (let i = 1; i < this.flips.length; i++) {
      totalInterval += this.flips[i].timestampMs - this.flips[i - 1].timestampMs;
    }
    return totalInterval / (this.flips.length - 1);
  }

  private isInRecovery(nowMs: number): boolean {
    if (this.lastChurnMs === 0) return false;
    return (nowMs - this.lastChurnMs) < this.config.recoveryTimeMs;
  }

  private getRecoveryRemainingMs(nowMs: number): number {
    if (!this.isInRecovery(nowMs)) return 0;
    return this.config.recoveryTimeMs - (nowMs - this.lastChurnMs);
  }
}

/**
 * Multi-symbol churn detector registry
 */
export class ChurnDetectorRegistry {
  private readonly detectors: Map<string, ChurnDetector> = new Map();
  private readonly defaultConfig?: Partial<ChurnDetectionConfig>;

  constructor(defaultConfig?: Partial<ChurnDetectionConfig>) {
    this.defaultConfig = defaultConfig;
  }

  getDetector(symbol: string): ChurnDetector {
    const normalized = symbol.toUpperCase();
    let detector = this.detectors.get(normalized);
    if (!detector) {
      detector = new ChurnDetector(normalized, this.defaultConfig);
      this.detectors.set(normalized, detector);
    }
    return detector;
  }

  removeDetector(symbol: string): void {
    this.detectors.delete(symbol.toUpperCase());
  }

  resetAll(): void {
    for (const detector of this.detectors.values()) {
      detector.reset();
    }
  }

  getAllStatus(nowMs: number): Record<string, ChurnDetectorStatus> {
    const status: Record<string, ChurnDetectorStatus> = {};
    for (const [symbol, detector] of this.detectors.entries()) {
      status[symbol] = detector.getStatus(nowMs);
    }
    return status;
  }

  /**
   * Check if any symbol is churning
   */
  anyChurning(nowMs: number): boolean {
    for (const detector of this.detectors.values()) {
      const result = detector.detectChurn(nowMs);
      if (result.isChurning) return true;
    }
    return false;
  }

  /**
   * Get minimum confidence multiplier across all detectors
   */
  getMinConfidenceMultiplier(nowMs: number): number {
    let min = 1.0;
    for (const detector of this.detectors.values()) {
      min = Math.min(min, detector.getConfidenceMultiplier(nowMs));
    }
    return min;
  }

  /**
   * Get symbols that are currently churning
   */
  getChurningSymbols(nowMs: number): string[] {
    const symbols: string[] = [];
    for (const [symbol, detector] of this.detectors.entries()) {
      const result = detector.detectChurn(nowMs);
      if (result.isChurning) {
        symbols.push(symbol);
      }
    }
    return symbols;
  }
}

export default ChurnDetector;
