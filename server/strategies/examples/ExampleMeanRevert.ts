/**
 * ExampleMeanRevert.ts
 * 
 * Example mean-reversion strategy implementation.
 * Demonstrates how to extend BaseStrategy for mean-reversion signals.
 * Part of FAZ-5 Strategy Framework.
 */

import { 
  BaseStrategy, 
  StrategyContext, 
  StrategySignal, 
  SignalSide 
} from '../StrategyInterface';

export interface MeanRevertConfig {
  /** OBI level considered oversold (trigger LONG) */
  oversoldThreshold: number;
  /** OBI level considered overbought (trigger SHORT) */
  overboughtThreshold: number;
  /** Delta Z threshold for confirmation */
  deltaZThreshold: number;
  /** Weight for OBI in confidence calculation */
  obiWeight: number;
  /** Weight for delta Z in confidence calculation */
  deltaZWeight: number;
  /** Maximum confidence cap */
  maxConfidence: number;
}

/** Default configuration */
export const DEFAULT_MEAN_REVERT_CONFIG: MeanRevertConfig = {
  oversoldThreshold: -0.4,
  overboughtThreshold: 0.4,
  deltaZThreshold: 1.5,
  obiWeight: 0.6,
  deltaZWeight: 0.4,
  maxConfidence: 0.9
};

/**
 * Mean-reversion strategy that uses Order Book Imbalance (OBI)
 * and Delta Z-score to identify potential reversal points.
 * 
 * Logic:
 * - LONG when OBI is oversold (negative) and delta Z confirms
 * - SHORT when OBI is overbought (positive) and delta Z confirms
 */
export class ExampleMeanRevertStrategy extends BaseStrategy {
  readonly id = 'mean-revert-v1';
  readonly name = 'Example Mean Revert';
  readonly version = '1.0.0';
  readonly description = 'Mean-reversion strategy using OBI and Delta Z-score';

  private config: MeanRevertConfig;

  constructor(config: Partial<MeanRevertConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MEAN_REVERT_CONFIG, ...config };
    
    // Validate weights sum to 1
    const totalWeight = this.config.obiWeight + this.config.deltaZWeight;
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      this.config.obiWeight /= totalWeight;
      this.config.deltaZWeight /= totalWeight;
    }
  }

  /**
   * Evaluate OBI and delta Z to generate signal
   */
  evaluate(ctx: StrategyContext): StrategySignal {
    const { obiDeep, deltaZ } = ctx;

    // Check for oversold condition (LONG opportunity)
    if (obiDeep <= this.config.oversoldThreshold) {
      const deltaZConfirmation = Math.abs(deltaZ) >= this.config.deltaZThreshold;
      const confidence = this.calculateConfidence(
        obiDeep, 
        deltaZ, 
        true, 
        deltaZConfirmation
      );

      if (confidence > 0) {
        return this.createSignal(
          SignalSide.LONG,
          confidence,
          ctx.timestamp,
          {
            obiDeep,
            deltaZ,
            oversoldThreshold: this.config.oversoldThreshold,
            deltaZConfirmation,
            deviationFromMean: Math.abs(obiDeep)
          }
        );
      }
    }

    // Check for overbought condition (SHORT opportunity)
    if (obiDeep >= this.config.overboughtThreshold) {
      const deltaZConfirmation = Math.abs(deltaZ) >= this.config.deltaZThreshold;
      const confidence = this.calculateConfidence(
        obiDeep, 
        deltaZ, 
        false, 
        deltaZConfirmation
      );

      if (confidence > 0) {
        return this.createSignal(
          SignalSide.SHORT,
          confidence,
          ctx.timestamp,
          {
            obiDeep,
            deltaZ,
            overboughtThreshold: this.config.overboughtThreshold,
            deltaZConfirmation,
            deviationFromMean: Math.abs(obiDeep)
          }
        );
      }
    }

    // No mean-reversion opportunity
    return this.createFlatSignal(ctx.timestamp, 'No significant deviation from mean');
  }

  /**
   * Calculate confidence based on deviation from mean
   * Greater deviation = higher confidence
   */
  private calculateConfidence(
    obi: number,
    deltaZ: number,
    isLong: boolean,
    deltaZConfirmation: boolean
  ): number {
    const threshold = isLong 
      ? Math.abs(this.config.oversoldThreshold) 
      : this.config.overboughtThreshold;
    
    // Calculate OBI-based confidence
    const obiDeviation = Math.abs(obi) - threshold;
    const maxOBIDeviation = 1.0 - threshold; // Assuming OBI range is [-1, 1]
    const obiConfidence = this.normalize(obiDeviation, 0, maxOBIDeviation);

    // Calculate delta Z-based confidence
    const deltaZDeviation = Math.abs(deltaZ) - this.config.deltaZThreshold;
    const maxDeltaZDeviation = 3.0; // Assuming typical max Z-score
    const deltaZConfidence = this.normalize(deltaZDeviation, 0, maxDeltaZDeviation);

    // Weighted combination
    let confidence = 
      obiConfidence * this.config.obiWeight +
      deltaZConfidence * this.config.deltaZWeight;

    // Boost confidence if delta Z confirms
    if (deltaZConfirmation) {
      confidence *= 1.2;
    }

    return this.clamp(confidence, 0, this.config.maxConfidence);
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<MeanRevertConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Re-normalize weights
    const totalWeight = this.config.obiWeight + this.config.deltaZWeight;
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      this.config.obiWeight /= totalWeight;
      this.config.deltaZWeight /= totalWeight;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): MeanRevertConfig {
    return { ...this.config };
  }

  /**
   * Get the current deviation from mean for a given OBI value
   */
  getDeviation(obi: number): number {
    if (obi < this.config.oversoldThreshold) {
      return Math.abs(obi - this.config.oversoldThreshold);
    } else if (obi > this.config.overboughtThreshold) {
      return obi - this.config.overboughtThreshold;
    }
    return 0;
  }
}
