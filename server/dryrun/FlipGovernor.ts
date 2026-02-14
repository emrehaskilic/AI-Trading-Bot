export type FlipSide = 'LONG' | 'SHORT';

export interface FlipGovernorConfig {
  minHoldMs: number;
  deadbandPct: number;
  confirmTicks: number;
  flipScoreThreshold: number;
}

export interface FlipEvaluationInput {
  nowMs: number;
  lastEntryOrAddOnTs: number;
  unrealizedPnlPct: number;
  signalScore: number;
  oppositeSide: FlipSide;
}

export interface FlipDecision {
  confirmed: boolean;
  blocked: boolean;
  blockedReason: 'HOLD' | 'DEADBAND' | 'SIGNAL' | 'CONFIRM' | null;
  holdRemainingMs: number;
  confirmTicks: number;
  lastOppositeSide: FlipSide | null;
}

export class FlipGovernor {
  private lastOppositeSide: FlipSide | null = null;
  private confirmTicks = 0;

  evaluate(config: FlipGovernorConfig, input: FlipEvaluationInput): FlipDecision {
    const holdRemainingMs = Math.max(0, config.minHoldMs - Math.max(0, input.nowMs - input.lastEntryOrAddOnTs));
    if (holdRemainingMs > 0) {
      this.reset();
      return {
        confirmed: false,
        blocked: true,
        blockedReason: 'HOLD',
        holdRemainingMs,
        confirmTicks: 0,
        lastOppositeSide: this.lastOppositeSide,
      };
    }

    if (Math.abs(input.unrealizedPnlPct) < config.deadbandPct) {
      this.reset();
      return {
        confirmed: false,
        blocked: true,
        blockedReason: 'DEADBAND',
        holdRemainingMs: 0,
        confirmTicks: 0,
        lastOppositeSide: this.lastOppositeSide,
      };
    }

    if (input.signalScore < config.flipScoreThreshold) {
      this.reset();
      return {
        confirmed: false,
        blocked: true,
        blockedReason: 'SIGNAL',
        holdRemainingMs: 0,
        confirmTicks: 0,
        lastOppositeSide: this.lastOppositeSide,
      };
    }

    if (this.lastOppositeSide === input.oppositeSide) {
      this.confirmTicks += 1;
    } else {
      this.lastOppositeSide = input.oppositeSide;
      this.confirmTicks = 1;
    }

    const confirmed = this.confirmTicks >= config.confirmTicks;
    return {
      confirmed,
      blocked: !confirmed,
      blockedReason: confirmed ? null : 'CONFIRM',
      holdRemainingMs: 0,
      confirmTicks: this.confirmTicks,
      lastOppositeSide: this.lastOppositeSide,
    };
  }

  reset(): void {
    this.lastOppositeSide = null;
    this.confirmTicks = 0;
  }

  getState(): { confirmTicks: number; lastOppositeSide: FlipSide | null } {
    return { confirmTicks: this.confirmTicks, lastOppositeSide: this.lastOppositeSide };
  }
}
