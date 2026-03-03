/**
 * ExampleTrendFollow.ts
 * 
 * Example trend-following strategy implementation.
 * Demonstrates how to extend BaseStrategy for trend-based signals.
 * Part of FAZ-5 Strategy Framework.
 */

import { 
  BaseStrategy, 
  StrategyContext, 
  StrategySignal, 
  SignalSide 
} from '../StrategyInterface';

export interface TrendFollowConfig {
  /** Minimum trend score to trigger LONG signal */
  longThreshold: number;
  /** Minimum trend score (negative) to trigger SHORT signal */
  shortThreshold: number;
  /** Weight for m3 trend score (0-1) */
  m3Weight: number;
  /** Weight for m5 trend score (0-1) */
  m5Weight: number;
  /** Maximum confidence cap */
  maxConfidence: number;
}

/** Default configuration */
export const DEFAULT_TREND_FOLLOW_CONFIG: TrendFollowConfig = {
  longThreshold: 0.3,
  shortThreshold: -0.3,
  m3Weight: 0.4,
  m5Weight: 0.6,
  maxConfidence: 0.95
};

/**
 * Trend-following strategy that uses m3 and m5 trend scores
 * to generate LONG/SHORT signals based on market momentum.
 */
export class ExampleTrendFollowStrategy extends BaseStrategy {
  readonly id = 'trend-follow-v1';
  readonly name = 'Example Trend Follow';
  readonly version = '1.0.0';
  readonly description = 'Trend-following strategy using m3 and m5 trend scores';

  private config: TrendFollowConfig;

  constructor(config: Partial<TrendFollowConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TREND_FOLLOW_CONFIG, ...config };
    
    // Validate weights sum to 1
    const totalWeight = this.config.m3Weight + this.config.m5Weight;
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      // Normalize weights
      this.config.m3Weight /= totalWeight;
      this.config.m5Weight /= totalWeight;
    }
  }

  /**
   * Evaluate trend scores and generate signal
   */
  evaluate(ctx: StrategyContext): StrategySignal {
    // Calculate weighted trend score
    const weightedTrendScore = 
      ctx.m3TrendScore * this.config.m3Weight +
      ctx.m5TrendScore * this.config.m5Weight;

    // Determine signal side based on trend
    if (weightedTrendScore >= this.config.longThreshold) {
      // Strong positive trend - LONG signal
      const confidence = this.calculateConfidence(weightedTrendScore, true);
      return this.createSignal(
        SignalSide.LONG,
        confidence,
        ctx.timestamp,
        {
          weightedTrendScore,
          m3TrendScore: ctx.m3TrendScore,
          m5TrendScore: ctx.m5TrendScore,
          threshold: this.config.longThreshold
        }
      );
    } else if (weightedTrendScore <= this.config.shortThreshold) {
      // Strong negative trend - SHORT signal
      const confidence = this.calculateConfidence(weightedTrendScore, false);
      return this.createSignal(
        SignalSide.SHORT,
        confidence,
        ctx.timestamp,
        {
          weightedTrendScore,
          m3TrendScore: ctx.m3TrendScore,
          m5TrendScore: ctx.m5TrendScore,
          threshold: this.config.shortThreshold
        }
      );
    } else {
      // No clear trend - FLAT signal
      return this.createFlatSignal(ctx.timestamp, 'No clear trend direction');
    }
  }

  /**
   * Calculate confidence based on trend strength
   * Higher deviation from threshold = higher confidence
   */
  private calculateConfidence(
    trendScore: number, 
    isLong: boolean
  ): number {
    const threshold = isLong ? this.config.longThreshold : Math.abs(this.config.shortThreshold);
    const absScore = Math.abs(trendScore);
    
    // Confidence increases as trend score moves further from threshold
    // Scale: threshold = 0.3 confidence, 1.0 = max confidence
    const excess = absScore - threshold;
    const range = 1.0 - threshold;
    
    if (excess <= 0) {
      return 0;
    }

    // Normalize to [0, 1] and apply sigmoid-like curve for smoother confidence
    const normalizedExcess = Math.min(1, excess / range);
    const confidence = threshold + (normalizedExcess * (this.config.maxConfidence - threshold));
    
    return this.clamp(confidence, 0, this.config.maxConfidence);
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<TrendFollowConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Re-normalize weights
    const totalWeight = this.config.m3Weight + this.config.m5Weight;
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      this.config.m3Weight /= totalWeight;
      this.config.m5Weight /= totalWeight;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TrendFollowConfig {
    return { ...this.config };
  }
}
