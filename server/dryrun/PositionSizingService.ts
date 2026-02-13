export interface DynamicSizingConfig {
  baseLeverage: number;
  winStreakMultiplier: number;
  lossStreakDivisor: number;
  martingaleFactor: number;
  martingaleMaxSteps: number;
  marginHealthLeverageFactor: number;
  minLeverage: number;
  maxLeverage: number;
  maxPositionNotionalUsdt: number;
}

export interface DynamicSizingInput {
  walletBalanceUsdt: number;
  baseMarginUsdt: number;
  markPrice: number;
  winStreak: number;
  lossStreak: number;
  marginHealth: number;
}

export interface DynamicSizingResult {
  quantity: number;
  leverage: number;
  notional: number;
  blockedReason: string | null;
}

export class PositionSizingService {
  private readonly config: DynamicSizingConfig;

  constructor(config: DynamicSizingConfig) {
    this.config = config;
  }

  compute(input: DynamicSizingInput): DynamicSizingResult {
    const markPrice = input.markPrice;
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      return { quantity: 0, leverage: this.config.baseLeverage, notional: 0, blockedReason: 'invalid_price' };
    }

    const marginHealth = Number.isFinite(input.marginHealth) ? input.marginHealth : 1;
    let leverage = this.config.baseLeverage;

    if (marginHealth < 0.5) {
      leverage = Math.max(this.config.minLeverage, leverage * marginHealth * this.config.marginHealthLeverageFactor);
    } else if (marginHealth > 0.8) {
      leverage = Math.min(this.config.maxLeverage, leverage * (1 + (marginHealth - 0.8) * this.config.marginHealthLeverageFactor));
    }

    const streakBoost = input.winStreak > 0 ? (1 + input.winStreak * this.config.winStreakMultiplier) : 1;
    const lossPenalty = input.lossStreak > 0 ? (1 + input.lossStreak * this.config.lossStreakDivisor) : 1;
    const martingale = input.lossStreak > 0
      ? Math.pow(this.config.martingaleFactor, Math.min(input.lossStreak, this.config.martingaleMaxSteps))
      : 1;

    const budget = Math.max(1, input.baseMarginUsdt) * streakBoost * martingale / lossPenalty;
    const notional = budget * leverage;
    const cappedNotional = Math.min(notional, this.config.maxPositionNotionalUsdt);
    if (!(cappedNotional > 0)) {
      return { quantity: 0, leverage, notional: 0, blockedReason: 'notional_zero' };
    }

    const quantity = cappedNotional / markPrice;
    return {
      quantity,
      leverage,
      notional: cappedNotional,
      blockedReason: notional > this.config.maxPositionNotionalUsdt ? 'max_notional_cap' : null,
    };
  }
}
