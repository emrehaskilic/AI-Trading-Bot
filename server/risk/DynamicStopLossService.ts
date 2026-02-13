export interface DynamicStopLossConfig {
  baseAtrMultiplier: number;
  volatilityAdjustmentFactor: number;
  obiAdjustmentFactor: number;
  minStopDistance: number;
  maxStopDistance: number;
}

export interface DynamicStopLossInput {
  side: 'LONG' | 'SHORT';
  markPrice: number;
  atr: number;
  volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH';
  obiDivergence: number;
  sweepStrength: number;
}

export class DynamicStopLossService {
  private readonly config: DynamicStopLossConfig;

  constructor(config: DynamicStopLossConfig) {
    this.config = config;
  }

  calculateStopPrice(input: DynamicStopLossInput): number {
    if (!Number.isFinite(input.markPrice) || input.markPrice <= 0) {
      return 0;
    }

    let stopDistance = Math.max(0, input.atr) * this.config.baseAtrMultiplier;

    let volMultiplier = 1;
    if (input.volatilityRegime === 'HIGH') {
      volMultiplier += this.config.volatilityAdjustmentFactor;
    } else if (input.volatilityRegime === 'LOW') {
      volMultiplier -= this.config.volatilityAdjustmentFactor * 0.5;
    }
    stopDistance *= Math.max(0.5, volMultiplier);

    const obiAdj = Math.abs(input.obiDivergence) * this.config.obiAdjustmentFactor;
    stopDistance += obiAdj;

    stopDistance += Math.abs(input.sweepStrength) * 0.01;

    stopDistance = Math.max(this.config.minStopDistance, Math.min(this.config.maxStopDistance, stopDistance));

    if (input.side === 'LONG') {
      return input.markPrice - stopDistance;
    }
    return input.markPrice + stopDistance;
  }
}
