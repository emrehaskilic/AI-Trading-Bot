/**
 * [FAZ-6] Delta Burst Filter - M2 Mitigation Patch
 * 
 * Detects and mitigates delta burst attacks:
 * - Abnormal delta changes in short window (3-5 ticks)
 * - Z-score > 3.5 threshold detection
 * - Cooldown period after burst detection (500ms signal freeze)
 * 
 * Prevents trading on manipulated delta signals.
 */

export interface DeltaBurstConfig {
  // Window size for delta history (ticks)
  windowSize: number;
  // Z-score threshold for burst detection
  zScoreThreshold: number;
  // Cooldown period after burst (ms)
  cooldownMs: number;
  // Minimum delta samples required
  minSamples: number;
  // EWMA alpha for mean estimation
  ewmaAlpha: number;
  // Burst severity multiplier for confidence reduction
  severityMultiplier: number;
}

export interface DeltaSample {
  delta: number;
  timestampMs: number;
  price: number;
}

export interface BurstDetectionResult {
  isBurst: boolean;
  zScore: number;
  severity: 'none' | 'low' | 'medium' | 'high';
  confidenceReduction: number;
  inCooldown: boolean;
  cooldownRemainingMs: number;
}

export interface DeltaBurstStatus {
  sampleCount: number;
  meanDelta: number;
  stdDelta: number;
  lastBurstMs: number;
  totalBurstsDetected: number;
  currentCooldownActive: boolean;
}

const DEFAULT_CONFIG: DeltaBurstConfig = {
  windowSize: 5,              // 3-5 tick window
  zScoreThreshold: 3.5,       // Z-score > 3.5 = burst
  cooldownMs: 500,            // 500ms freeze
  minSamples: 10,             // Need 10 samples minimum
  ewmaAlpha: 0.1,             // 10% EWMA
  severityMultiplier: 0.5,    // 50% confidence reduction per severity level
};

/**
 * Delta Burst Filter - Detects anomalous delta spikes
 */
export class DeltaBurstFilter {
  private readonly config: DeltaBurstConfig;
  private readonly samples: DeltaSample[] = [];
  private readonly symbol: string;
  
  private ewmaMean = 0;
  private ewmaVar = 0;
  private initialized = false;
  private lastBurstMs = 0;
  private totalBursts = 0;
  private sampleCount = 0;

  constructor(symbol: string, config?: Partial<DeltaBurstConfig>) {
    this.symbol = symbol;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a new delta sample
   */
  recordDelta(delta: number, price: number, timestampMs: number): BurstDetectionResult {
    // Add sample
    this.samples.push({ delta, timestampMs, price });
    this.sampleCount++;

    // Maintain window size
    while (this.samples.length > this.config.windowSize) {
      this.samples.shift();
    }

    // Update EWMA statistics
    this.updateStatistics(delta);

    // Check for burst
    const result = this.detectBurst(delta, timestampMs);

    // Record burst if detected
    if (result.isBurst) {
      this.lastBurstMs = timestampMs;
      this.totalBursts++;
    }

    return result;
  }

  /**
   * Check if currently in cooldown
   */
  isInCooldown(nowMs: number): boolean {
    if (this.lastBurstMs === 0) return false;
    return (nowMs - this.lastBurstMs) < this.config.cooldownMs;
  }

  /**
   * Get cooldown remaining time
   */
  getCooldownRemainingMs(nowMs: number): number {
    if (!this.isInCooldown(nowMs)) return 0;
    return this.config.cooldownMs - (nowMs - this.lastBurstMs);
  }

  /**
   * Get confidence multiplier (reduced during/after burst)
   */
  getConfidenceMultiplier(nowMs: number): number {
    if (!this.isInCooldown(nowMs)) return 1.0;
    
    const remaining = this.getCooldownRemainingMs(nowMs);
    const progress = 1 - (remaining / this.config.cooldownMs);
    
    // Gradually restore confidence during cooldown
    return 0.3 + (0.7 * progress);
  }

  /**
   * Check if signal should be suppressed
   */
  shouldSuppressSignal(nowMs: number): boolean {
    // Suppress if in active cooldown (first 50% of cooldown)
    if (!this.isInCooldown(nowMs)) return false;
    const remaining = this.getCooldownRemainingMs(nowMs);
    return remaining > (this.config.cooldownMs * 0.5);
  }

  /**
   * Get current filter status
   */
  getStatus(nowMs: number): DeltaBurstStatus {
    const values = this.samples.map(s => s.delta);
    const mean = this.calculateMean(values);
    const std = this.calculateStd(values, mean);

    return {
      sampleCount: this.samples.length,
      meanDelta: mean,
      stdDelta: std,
      lastBurstMs: this.lastBurstMs,
      totalBurstsDetected: this.totalBursts,
      currentCooldownActive: this.isInCooldown(nowMs),
    };
  }

  /**
   * Get Z-score for a delta value
   */
  getZScore(delta: number): number {
    if (!this.initialized) return 0;
    const std = Math.sqrt(this.ewmaVar);
    if (std < 1e-10) return 0;
    return (delta - this.ewmaMean) / std;
  }

  /**
   * Reset filter state
   */
  reset(): void {
    this.samples.length = 0;
    this.ewmaMean = 0;
    this.ewmaVar = 0;
    this.initialized = false;
    this.lastBurstMs = 0;
    this.totalBursts = 0;
    this.sampleCount = 0;
  }

  private updateStatistics(delta: number): void {
    if (!this.initialized) {
      this.ewmaMean = delta;
      this.ewmaVar = 0;
      this.initialized = true;
      return;
    }

    const alpha = this.config.ewmaAlpha;
    const diff = delta - this.ewmaMean;
    
    // Update mean
    this.ewmaMean = this.ewmaMean + alpha * diff;
    
    // Update variance (using EWMA for variance)
    const newDiff = delta - this.ewmaMean;
    this.ewmaVar = (1 - alpha) * this.ewmaVar + alpha * (diff * newDiff);
    
    // Ensure non-negative variance
    this.ewmaVar = Math.max(0, this.ewmaVar);
  }

  private detectBurst(delta: number, timestampMs: number): BurstDetectionResult {
    // Check cooldown first
    const inCooldown = this.isInCooldown(timestampMs);
    const cooldownRemaining = this.getCooldownRemainingMs(timestampMs);

    // Need minimum samples for reliable detection
    if (this.sampleCount < this.config.minSamples || !this.initialized) {
      return {
        isBurst: false,
        zScore: 0,
        severity: 'none',
        confidenceReduction: 0,
        inCooldown,
        cooldownRemainingMs: cooldownRemaining,
      };
    }

    const zScore = this.getZScore(delta);
    const absZScore = Math.abs(zScore);
    const isBurst = absZScore > this.config.zScoreThreshold;

    // Determine severity
    let severity: 'none' | 'low' | 'medium' | 'high' = 'none';
    if (absZScore > this.config.zScoreThreshold * 2) {
      severity = 'high';
    } else if (absZScore > this.config.zScoreThreshold * 1.5) {
      severity = 'medium';
    } else if (absZScore > this.config.zScoreThreshold) {
      severity = 'low';
    }

    // Calculate confidence reduction
    let confidenceReduction = 0;
    if (severity === 'low') confidenceReduction = this.config.severityMultiplier;
    else if (severity === 'medium') confidenceReduction = this.config.severityMultiplier * 2;
    else if (severity === 'high') confidenceReduction = this.config.severityMultiplier * 3;
    confidenceReduction = Math.min(0.9, confidenceReduction);

    return {
      isBurst,
      zScore,
      severity,
      confidenceReduction,
      inCooldown,
      cooldownRemainingMs: cooldownRemaining,
    };
  }

  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private calculateStd(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  }
}

/**
 * Multi-symbol delta burst filter registry
 */
export class DeltaBurstFilterRegistry {
  private readonly filters: Map<string, DeltaBurstFilter> = new Map();
  private readonly defaultConfig?: Partial<DeltaBurstConfig>;

  constructor(defaultConfig?: Partial<DeltaBurstConfig>) {
    this.defaultConfig = defaultConfig;
  }

  getFilter(symbol: string): DeltaBurstFilter {
    const normalized = symbol.toUpperCase();
    let filter = this.filters.get(normalized);
    if (!filter) {
      filter = new DeltaBurstFilter(normalized, this.defaultConfig);
      this.filters.set(normalized, filter);
    }
    return filter;
  }

  removeFilter(symbol: string): void {
    this.filters.delete(symbol.toUpperCase());
  }

  resetAll(): void {
    for (const filter of this.filters.values()) {
      filter.reset();
    }
  }

  getAllStatus(nowMs: number): Record<string, DeltaBurstStatus> {
    const status: Record<string, DeltaBurstStatus> = {};
    for (const [symbol, filter] of this.filters.entries()) {
      status[symbol] = filter.getStatus(nowMs);
    }
    return status;
  }

  /**
   * Check if any filter is in cooldown
   */
  anyInCooldown(nowMs: number): boolean {
    for (const filter of this.filters.values()) {
      if (filter.isInCooldown(nowMs)) return true;
    }
    return false;
  }

  /**
   * Get minimum confidence multiplier across all filters
   */
  getMinConfidenceMultiplier(nowMs: number): number {
    let min = 1.0;
    for (const filter of this.filters.values()) {
      min = Math.min(min, filter.getConfidenceMultiplier(nowMs));
    }
    return min;
  }

  getFilterMap(): Map<string, DeltaBurstFilter> {
    return this.filters;
  }
}

export default DeltaBurstFilter;
