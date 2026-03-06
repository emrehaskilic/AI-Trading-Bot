/**
 * [FAZ-6] Anti-Spoof Guard - M1 Mitigation Patch
 * 
 * Detects and mitigates order book spoofing attacks:
 * - Rapid order add/cancel patterns (< 100ms)
 * - Repeated add/cancel at same price level
 * - Large order volume + rapid cancel
 * 
 * Down-weights spoof-suspected levels in OBI calculations
 * to prevent manipulation of trading signals.
 */

export interface SpoofDetectionConfig {
  // Time window for rapid cancel detection (ms)
  rapidCancelThresholdMs: number;
  // Minimum order size to consider for large order spoofing
  minOrderSizeForSpoof: number;
  // Number of repeated add/cancel cycles to flag as spoof
  repeatCycleThreshold: number;
  // Time window for repeat cycle detection (ms)
  repeatCycleWindowMs: number;
  // Down-weight factor for spoof-suspected levels (0-1)
  downWeightFactor: number;
  // Decay rate for spoof scores (per tick)
  spoofScoreDecay: number;
  // Threshold to mark level as spoof-suspected
  spoofScoreThreshold: number;
}

export interface OrderActivity {
  price: number;
  side: 'bid' | 'ask';
  size: number;
  timestampMs: number;
  type: 'add' | 'cancel' | 'modify';
}

export interface LevelActivity {
  price: number;
  side: 'bid' | 'ask';
  addCount: number;
  cancelCount: number;
  lastAddMs: number;
  lastCancelMs: number;
  totalVolumeAdded: number;
  totalVolumeCancelled: number;
  spoofScore: number;
  cycleCount: number;
  lastCycleStartMs: number;
}

export interface SpoofDetectionResult {
  isSpoofSuspected: boolean;
  spoofScore: number;
  downWeightFactor: number;
  reason: string;
}

export interface AntiSpoofGuardStatus {
  totalLevelsTracked: number;
  spoofSuspectedLevels: number;
  totalSpoofDetections: number;
  avgSpoofScore: number;
  lastCleanupMs: number;
}

const DEFAULT_CONFIG: SpoofDetectionConfig = {
  rapidCancelThresholdMs: 100,      // < 100ms = rapid
  minOrderSizeForSpoof: 10.0,       // 10+ units = large
  repeatCycleThreshold: 3,          // 3+ cycles = spoof pattern
  repeatCycleWindowMs: 5000,        // 5 second window
  downWeightFactor: 0.3,            // 70% reduction
  spoofScoreDecay: 0.95,            // 5% decay per tick
  spoofScoreThreshold: 2.0,         // Score >= 2.0 = suspected
};

/**
 * Anti-Spoof Guard - Detects spoofing patterns in order book
 */
export class AntiSpoofGuard {
  private readonly config: SpoofDetectionConfig;
  private readonly levelActivity: Map<string, LevelActivity> = new Map();
  private totalDetections = 0;
  private lastCleanupMs = 0;
  private readonly symbol: string;

  constructor(symbol: string, config?: Partial<SpoofDetectionConfig>) {
    this.symbol = symbol;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastCleanupMs = 0;
  }

  /**
   * Record order activity for spoof detection
   */
  recordActivity(activity: OrderActivity): void {
    const key = this.getLevelKey(activity.price, activity.side);
    const existing = this.levelActivity.get(key);

    if (existing) {
      this.updateLevelActivity(existing, activity);
    } else {
      this.levelActivity.set(key, this.createLevelActivity(activity));
    }
  }

  /**
   * Check if a price level is spoof-suspected and get down-weight factor
   */
  checkLevel(price: number, side: 'bid' | 'ask', nowMs: number): SpoofDetectionResult {
    const key = this.getLevelKey(price, side);
    const activity = this.levelActivity.get(key);

    if (!activity) {
      return {
        isSpoofSuspected: false,
        spoofScore: 0,
        downWeightFactor: 1.0,
        reason: 'no_activity_recorded',
      };
    }

    // Apply decay to spoof score
    this.applySpoofScoreDecay(activity, nowMs);

    const isSuspected = activity.spoofScore >= this.config.spoofScoreThreshold;
    const downWeight = isSuspected ? this.config.downWeightFactor : 1.0;

    let reason = 'normal_activity';
    if (isSuspected) {
      if (activity.cycleCount >= this.config.repeatCycleThreshold) {
        reason = 'repeat_cycle_pattern';
      } else if (activity.lastCancelMs - activity.lastAddMs < this.config.rapidCancelThresholdMs) {
        reason = 'rapid_cancel_detected';
      } else {
        reason = 'elevated_spoof_score';
      }
    }

    return {
      isSpoofSuspected: isSuspected,
      spoofScore: activity.spoofScore,
      downWeightFactor: downWeight,
      reason,
    };
  }

  /**
   * Get OBI weight for a level (applies down-weighting for spoof-suspected levels)
   */
  getOBIWeight(price: number, side: 'bid' | 'ask', baseWeight: number, nowMs: number): number {
    const check = this.checkLevel(price, side, nowMs);
    return baseWeight * check.downWeightFactor;
  }

  /**
   * Calculate OBI with spoof-aware weighting
   */
  calculateOBI(
    bids: Map<number, number> | [number, number][],
    asks: Map<number, number> | [number, number][],
    depth: number,
    nowMs: number
  ): { obi: number; obiWeighted: number; spoofAdjusted: boolean } {
    const bidEntries = Array.from(Array.isArray(bids) ? bids : bids.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, depth);
    
    const askEntries = Array.from(Array.isArray(asks) ? asks : asks.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, depth);

    let totalBidWeight = 0;
    let totalAskWeight = 0;
    let spoofAdjustedBid = 0;
    let spoofAdjustedAsk = 0;
    let anySpoofAdjusted = false;

    // Process bids with spoof weighting
    for (const [price, size] of bidEntries) {
      const check = this.checkLevel(price, 'bid', nowMs);
      const weight = size * check.downWeightFactor;
      totalBidWeight += size;
      spoofAdjustedBid += weight;
      if (check.isSpoofSuspected) anySpoofAdjusted = true;
    }

    // Process asks with spoof weighting
    for (const [price, size] of askEntries) {
      const check = this.checkLevel(price, 'ask', nowMs);
      const weight = size * check.downWeightFactor;
      totalAskWeight += size;
      spoofAdjustedAsk += weight;
      if (check.isSpoofSuspected) anySpoofAdjusted = true;
    }

    const totalWeight = totalBidWeight + totalAskWeight;
    const spoofAdjustedTotal = spoofAdjustedBid + spoofAdjustedAsk;

    const obi = totalWeight > 0 ? (totalBidWeight - totalAskWeight) / totalWeight : 0;
    const obiWeighted = spoofAdjustedTotal > 0 
      ? (spoofAdjustedBid - spoofAdjustedAsk) / spoofAdjustedTotal 
      : 0;

    return { obi, obiWeighted, spoofAdjusted: anySpoofAdjusted };
  }

  /**
   * Get current guard status
   */
  getStatus(nowMs: number): AntiSpoofGuardStatus {
    let spoofSuspected = 0;
    let totalScore = 0;

    for (const activity of this.levelActivity.values()) {
      this.applySpoofScoreDecay(activity, nowMs);
      if (activity.spoofScore >= this.config.spoofScoreThreshold) {
        spoofSuspected++;
      }
      totalScore += activity.spoofScore;
    }

    const count = this.levelActivity.size;
    return {
      totalLevelsTracked: count,
      spoofSuspectedLevels: spoofSuspected,
      totalSpoofDetections: this.totalDetections,
      avgSpoofScore: count > 0 ? totalScore / count : 0,
      lastCleanupMs: this.lastCleanupMs,
    };
  }

  /**
   * Clean up old activity records
   */
  cleanup(nowMs: number, maxAgeMs: number = 60000): void {
    const cutoff = nowMs - maxAgeMs;
    
    for (const [key, activity] of this.levelActivity.entries()) {
      const lastActivity = Math.max(activity.lastAddMs, activity.lastCancelMs);
      if (lastActivity < cutoff && activity.spoofScore < 0.5) {
        this.levelActivity.delete(key);
      }
    }

    this.lastCleanupMs = nowMs;
  }

  /**
   * Reset all tracking state
   */
  reset(): void {
    this.levelActivity.clear();
    this.totalDetections = 0;
    this.lastCleanupMs = 0;
  }

  private getLevelKey(price: number, side: 'bid' | 'ask'): string {
    return `${side}:${price.toFixed(8)}`;
  }

  private createLevelActivity(activity: OrderActivity): LevelActivity {
    return {
      price: activity.price,
      side: activity.side,
      addCount: activity.type === 'add' ? 1 : 0,
      cancelCount: activity.type === 'cancel' ? 1 : 0,
      lastAddMs: activity.type === 'add' ? activity.timestampMs : 0,
      lastCancelMs: activity.type === 'cancel' ? activity.timestampMs : 0,
      totalVolumeAdded: activity.type === 'add' ? activity.size : 0,
      totalVolumeCancelled: activity.type === 'cancel' ? activity.size : 0,
      spoofScore: 0,
      cycleCount: 0,
      lastCycleStartMs: activity.timestampMs,
    };
  }

  private updateLevelActivity(existing: LevelActivity, activity: OrderActivity): void {
    if (activity.type === 'add') {
      existing.addCount++;
      existing.lastAddMs = activity.timestampMs;
      existing.totalVolumeAdded += activity.size;
    } else if (activity.type === 'cancel') {
      existing.cancelCount++;
      existing.lastCancelMs = activity.timestampMs;
      existing.totalVolumeCancelled += activity.size;

      // Check for rapid cancel pattern
      const timeSinceAdd = activity.timestampMs - existing.lastAddMs;
      if (timeSinceAdd < this.config.rapidCancelThresholdMs && existing.lastAddMs > 0) {
        // Rapid cancel detected - increase spoof score
        const sizeFactor = activity.size >= this.config.minOrderSizeForSpoof ? 1.5 : 1.0;
        existing.spoofScore += 1.0 * sizeFactor;
      }

      // Check for repeat cycle pattern
      if (existing.lastCycleStartMs > 0) {
        const cycleTime = activity.timestampMs - existing.lastCycleStartMs;
        if (cycleTime <= this.config.repeatCycleWindowMs) {
          existing.cycleCount++;
          if (existing.cycleCount >= this.config.repeatCycleThreshold) {
            existing.spoofScore += 0.5;
            this.totalDetections++;
          }
        } else {
          // Reset cycle tracking
          existing.cycleCount = 1;
          existing.lastCycleStartMs = existing.lastAddMs;
        }
      } else {
        existing.lastCycleStartMs = existing.lastAddMs;
        existing.cycleCount = 1;
      }
    }
  }

  private applySpoofScoreDecay(activity: LevelActivity, nowMs: number): void {
    const timeDelta = nowMs - Math.max(activity.lastAddMs, activity.lastCancelMs);
    // Apply decay based on time passed (approximate)
    const decayTicks = Math.floor(timeDelta / 100); // Assume 100ms per tick
    if (decayTicks > 0) {
      activity.spoofScore *= Math.pow(this.config.spoofScoreDecay, decayTicks);
      activity.spoofScore = Math.max(0, activity.spoofScore);
    }
  }
}

/**
 * Global spoof guard registry for multi-symbol tracking
 */
export class AntiSpoofGuardRegistry {
  private readonly guards: Map<string, AntiSpoofGuard> = new Map();
  private readonly defaultConfig?: Partial<SpoofDetectionConfig>;

  constructor(defaultConfig?: Partial<SpoofDetectionConfig>) {
    this.defaultConfig = defaultConfig;
  }

  getGuard(symbol: string): AntiSpoofGuard {
    const normalized = symbol.toUpperCase();
    let guard = this.guards.get(normalized);
    if (!guard) {
      guard = new AntiSpoofGuard(normalized, this.defaultConfig);
      this.guards.set(normalized, guard);
    }
    return guard;
  }

  removeGuard(symbol: string): void {
    this.guards.delete(symbol.toUpperCase());
  }

  cleanupAll(nowMs: number, maxAgeMs?: number): void {
    for (const guard of this.guards.values()) {
      guard.cleanup(nowMs, maxAgeMs);
    }
  }

  resetAll(): void {
    for (const guard of this.guards.values()) {
      guard.reset();
    }
  }

  getAllStatus(nowMs: number): Record<string, AntiSpoofGuardStatus> {
    const status: Record<string, AntiSpoofGuardStatus> = {};
    for (const [symbol, guard] of this.guards.entries()) {
      status[symbol] = guard.getStatus(nowMs);
    }
    return status;
  }

  getGuardMap(): Map<string, AntiSpoofGuard> {
    return this.guards;
  }
}

export default AntiSpoofGuard;
