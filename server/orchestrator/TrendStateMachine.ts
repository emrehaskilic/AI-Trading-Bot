import { TrendState } from './OrderPlan';

export interface TrendConfig {
  upEnter: number;
  upExit: number;
  downEnter: number;
  downExit: number;
  confirmTicks: number;
  reversalConfirmTicks: number;
  dynamicConfirmByVolatility?: boolean;
  highVolatilityThresholdPct?: number;
  mediumVolatilityThresholdPct?: number;
  highVolConfirmTicks?: number;
  mediumVolConfirmTicks?: number;
  lowVolConfirmTicks?: number;
  highVolReversalConfirmTicks?: number;
  mediumVolReversalConfirmTicks?: number;
  lowVolReversalConfirmTicks?: number;
}

export interface TrendSnapshot {
  state: TrendState;
  score: number;
  confirmCount: number;
  confirmThreshold: number;
  candidateState: TrendState;
}

export class TrendStateMachine {
  private state: TrendState = 'CHOP';
  private score = 0;
  private candidateState: TrendState = 'CHOP';
  private candidateCount = 0;
  private confirmCount = 0;
  private confirmThreshold = 1;

  constructor(private readonly cfg: TrendConfig) {}

  update(score: number, volatilityPct?: number | null): TrendSnapshot {
    this.score = score;
    const candidate = this.computeCandidate(score);
    const reversal = this.isReversal(candidate);
    const threshold = this.resolveConfirmThreshold(reversal, volatilityPct);
    if (candidate === this.candidateState) {
      this.candidateCount += 1;
    } else {
      this.candidateState = candidate;
      this.candidateCount = 1;
    }

    if (candidate !== this.state) {
      if (this.candidateCount >= Math.max(1, threshold)) {
        this.state = candidate;
        this.confirmCount = Math.max(1, threshold);
        this.confirmThreshold = Math.max(1, threshold);
      }
    } else {
      this.confirmCount += 1;
      this.confirmThreshold = this.resolveConfirmThreshold(false, volatilityPct);
    }

    return {
      state: this.state,
      score: this.score,
      confirmCount: this.confirmCount,
      confirmThreshold: this.confirmThreshold,
      candidateState: this.candidateState,
    };
  }

  getSnapshot(): TrendSnapshot {
    return {
      state: this.state,
      score: this.score,
      confirmCount: this.confirmCount,
      confirmThreshold: this.confirmThreshold,
      candidateState: this.candidateState,
    };
  }

  private computeCandidate(score: number): TrendState {
    if (this.state === 'CHOP') {
      if (score >= this.cfg.upEnter) return 'UP';
      if (score <= this.cfg.downEnter) return 'DOWN';
      return 'CHOP';
    }

    if (this.state === 'UP') {
      if (score <= this.cfg.downEnter) return 'DOWN';
      if (score <= this.cfg.upExit) return 'CHOP';
      return 'UP';
    }

    if (score >= this.cfg.upEnter) return 'UP';
    if (score >= this.cfg.downExit) return 'CHOP';
    return 'DOWN';
  }

  private isReversal(candidate: TrendState): boolean {
    return (this.state === 'UP' && candidate === 'DOWN') || (this.state === 'DOWN' && candidate === 'UP');
  }

  private resolveConfirmThreshold(isReversal: boolean, volatilityPct?: number | null): number {
    const defaultTicks = Math.max(1, Math.trunc(isReversal ? this.cfg.reversalConfirmTicks : this.cfg.confirmTicks));
    if (!this.cfg.dynamicConfirmByVolatility) return defaultTicks;

    const vol = Number(volatilityPct);
    if (!Number.isFinite(vol)) return defaultTicks;

    const highThreshold = Number.isFinite(this.cfg.highVolatilityThresholdPct as number)
      ? Number(this.cfg.highVolatilityThresholdPct)
      : 90;
    const mediumThreshold = Number.isFinite(this.cfg.mediumVolatilityThresholdPct as number)
      ? Number(this.cfg.mediumVolatilityThresholdPct)
      : 70;

    const highTicks = Math.max(
      1,
      Math.trunc(
        Number(
          isReversal
            ? this.cfg.highVolReversalConfirmTicks ?? this.cfg.highVolConfirmTicks ?? defaultTicks
            : this.cfg.highVolConfirmTicks ?? defaultTicks
        )
      )
    );
    const mediumTicks = Math.max(
      1,
      Math.trunc(
        Number(
          isReversal
            ? this.cfg.mediumVolReversalConfirmTicks ?? this.cfg.mediumVolConfirmTicks ?? defaultTicks
            : this.cfg.mediumVolConfirmTicks ?? defaultTicks
        )
      )
    );
    const lowTicks = Math.max(
      1,
      Math.trunc(
        Number(
          isReversal
            ? this.cfg.lowVolReversalConfirmTicks ?? this.cfg.lowVolConfirmTicks ?? defaultTicks
            : this.cfg.lowVolConfirmTicks ?? defaultTicks
        )
      )
    );

    if (vol >= highThreshold) return highTicks;
    if (vol >= mediumThreshold) return mediumTicks;
    return lowTicks;
  }
}
