/**
 * ExampleChopFilter.ts
 * 
 * Example chop filter strategy that can veto other strategies.
 * Detects choppy/low-volatility markets and prevents trading.
 * Part of FAZ-5 Strategy Framework.
 */

import { 
  BaseStrategy, 
  StrategyContext, 
  StrategySignal, 
  SignalSide 
} from '../StrategyInterface';

export interface ChopFilterConfig {
  /** Volatility index threshold below which market is considered choppy */
  chopThreshold: number;
  /** Minimum volatility required for normal trading */
  minVolatility: number;
  /** Hysteresis buffer to prevent rapid toggling */
  hysteresis: number;
  /** Cooldown period in milliseconds after chop detection */
  cooldownMs: number;
}

/** Default configuration */
export const DEFAULT_CHOP_FILTER_CONFIG: ChopFilterConfig = {
  chopThreshold: 0.15,
  minVolatility: 0.1,
  hysteresis: 0.02,
  cooldownMs: 10000
};

/**
 * Chop filter strategy that detects low-volatility/choppy market conditions.
 * When active, this strategy can veto other strategies' signals.
 * 
 * Veto Logic:
 * - Returns FLAT when volatility is below threshold
 * - Marks signal with canVeto=true to trigger veto in ConsensusEngine
 * - Other strategies' signals are suppressed during veto
 */
export class ExampleChopFilterStrategy extends BaseStrategy {
  readonly id = 'chop-filter-v1';
  readonly name = 'Example Chop Filter';
  readonly version = '1.0.0';
  readonly description = 'Chop filter that vetoes trading in low-volatility markets';

  private config: ChopFilterConfig;
  private lastChopTimestamp: number = 0;
  private isInChopState: boolean = false;

  constructor(config: Partial<ChopFilterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CHOP_FILTER_CONFIG, ...config };
  }

  /**
   * This strategy can veto other strategies
   */
  canVeto(): boolean {
    return true;
  }

  /**
   * Evaluate volatility and generate veto signal if market is choppy
   */
  evaluate(ctx: StrategyContext): StrategySignal {
    const { volatilityIndex, timestamp } = ctx;

    // Check cooldown period
    const inCooldown = (timestamp - this.lastChopTimestamp) < this.config.cooldownMs;

    // Determine chop state with hysteresis
    const effectiveThreshold = this.isInChopState 
      ? this.config.chopThreshold + this.config.hysteresis  // Higher threshold to exit chop
      : this.config.chopThreshold;                          // Normal threshold to enter chop

    const isChoppy = volatilityIndex < effectiveThreshold;
    const isTooLow = volatilityIndex < this.config.minVolatility;

    // Update state
    if (isChoppy && !this.isInChopState) {
      this.isInChopState = true;
      this.lastChopTimestamp = timestamp;
    } else if (!isChoppy && this.isInChopState) {
      this.isInChopState = false;
    }

    // Generate signal
    if (isChoppy || isTooLow || (inCooldown && this.isInChopState)) {
      // Market is choppy - return FLAT with veto capability
      const confidence = this.calculateChopConfidence(volatilityIndex);
      
      return this.createSignal(
        SignalSide.FLAT,
        confidence,
        timestamp,
        {
          volatilityIndex,
          chopThreshold: this.config.chopThreshold,
          isChoppy,
          isTooLow,
          inCooldown,
          canVeto: true,  // This triggers the veto in ConsensusEngine
          chopState: this.isInChopState,
          reason: this.getChopReason(volatilityIndex, isChoppy, isTooLow, inCooldown)
        }
      );
    }

    // Market conditions are normal - return low-confidence FLAT (no veto)
    return this.createSignal(
      SignalSide.FLAT,
      0.1,  // Low confidence indicates no strong opinion
      timestamp,
      {
        volatilityIndex,
        chopThreshold: this.config.chopThreshold,
        isChoppy: false,
        canVeto: false,  // No veto when conditions are normal
        reason: 'Market volatility normal'
      }
    );
  }

  /**
   * Calculate confidence in the chop detection
   * Higher confidence = stronger chop signal
   */
  private calculateChopConfidence(volatilityIndex: number): number {
    if (volatilityIndex >= this.config.chopThreshold) {
      return 0;
    }

    // Confidence increases as volatility drops further below threshold
    const deviation = this.config.chopThreshold - volatilityIndex;
    const maxDeviation = this.config.chopThreshold; // Assuming volatility can go to 0
    
    return this.normalize(deviation, 0, maxDeviation);
  }

  /**
   * Get human-readable reason for chop detection
   */
  private getChopReason(
    volatilityIndex: number, 
    isChoppy: boolean, 
    isTooLow: boolean,
    inCooldown: boolean
  ): string {
    if (isTooLow) {
      return `Volatility too low (${volatilityIndex.toFixed(3)} < ${this.config.minVolatility})`;
    }
    if (inCooldown) {
      return 'In cooldown period after chop detection';
    }
    if (isChoppy) {
      return `Choppy market detected (${volatilityIndex.toFixed(3)} < ${this.config.chopThreshold})`;
    }
    return 'Unknown';
  }

  /**
   * Check if currently in chop state
   */
  isChopActive(): boolean {
    return this.isInChopState;
  }

  /**
   * Get time remaining in cooldown period
   */
  getCooldownRemaining(currentTime: number): number {
    const elapsed = currentTime - this.lastChopTimestamp;
    return Math.max(0, this.config.cooldownMs - elapsed);
  }

  /**
   * Reset chop state (for testing or manual override)
   */
  reset(): void {
    this.isInChopState = false;
    this.lastChopTimestamp = 0;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<ChopFilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ChopFilterConfig {
    return { ...this.config };
  }

  /**
   * Get current state information
   */
  getState(currentTime: number): {
    isChopActive: boolean;
    cooldownRemaining: number;
    lastChopTimestamp: number;
  } {
    return {
      isChopActive: this.isInChopState,
      cooldownRemaining: this.getCooldownRemaining(currentTime),
      lastChopTimestamp: this.lastChopTimestamp
    };
  }
}
