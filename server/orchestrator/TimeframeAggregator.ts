import { OrchestratorMetricsInput } from './types';
import { TrendState } from './OrderPlan';

export interface TimeframeAggregatorConfig {
  enabled: boolean;
  minConsensus: number;
  oppositeExitConsensus: number;
  deadband: number;
  weights: {
    m1: number;
    m3: number;
    m5: number;
    m15: number;
  };
  norms: {
    m1: number;
    m3: number;
    m5: number;
    m15: number;
  };
}

export interface MultiTimeframeSignal {
  m1: TrendState;
  m3: TrendState;
  m5: TrendState;
  m15: TrendState;
  direction: TrendState;
  consensus: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class TimeframeAggregator {
  constructor(private readonly cfg: TimeframeAggregatorConfig) {}

  evaluate(metrics: OrchestratorMetricsInput, baseTrendScore: number): MultiTimeframeSignal {
    const m1Raw = this.resolveOrFallback(
      metrics.multiTimeframe?.m1TrendScore,
      metrics.legacyMetrics?.deltaZ,
      baseTrendScore
    );
    const m5Raw = this.resolveOrFallback(
      metrics.multiTimeframe?.m5TrendScore,
      metrics.legacyMetrics?.cvdSlope,
      m1Raw
    );
    const m15Raw = this.resolveOrFallback(
      metrics.multiTimeframe?.m15TrendScore,
      m5Raw
    );
    const m3Raw = this.resolveOrFallback(
      metrics.multiTimeframe?.m3TrendScore,
      (m1Raw + m5Raw) / 2
    );

    const m1Norm = this.normalize(m1Raw, this.cfg.norms.m1);
    const m3Norm = this.normalize(m3Raw, this.cfg.norms.m3);
    const m5Norm = this.normalize(m5Raw, this.cfg.norms.m5);
    const m15Norm = this.normalize(m15Raw, this.cfg.norms.m15);

    const m1 = this.directionFromNormalized(m1Norm);
    const m3 = this.directionFromNormalized(m3Norm);
    const m5 = this.directionFromNormalized(m5Norm);
    const m15 = this.directionFromNormalized(m15Norm);

    const positive = this.weightedStrength(m1Norm, this.cfg.weights.m1, 1)
      + this.weightedStrength(m3Norm, this.cfg.weights.m3, 1)
      + this.weightedStrength(m5Norm, this.cfg.weights.m5, 1)
      + this.weightedStrength(m15Norm, this.cfg.weights.m15, 1);
    const negative = this.weightedStrength(m1Norm, this.cfg.weights.m1, -1)
      + this.weightedStrength(m3Norm, this.cfg.weights.m3, -1)
      + this.weightedStrength(m5Norm, this.cfg.weights.m5, -1)
      + this.weightedStrength(m15Norm, this.cfg.weights.m15, -1);

    const total = positive + negative;
    const direction: TrendState = total <= 0
      ? 'CHOP'
      : positive > negative
        ? 'UP'
        : negative > positive
          ? 'DOWN'
          : 'CHOP';
    const consensus = total > 0 ? Math.max(positive, negative) / total : 0;

    return {
      m1,
      m3,
      m5,
      m15,
      direction,
      consensus: Number(clamp(consensus, 0, 1).toFixed(4)),
    };
  }

  isEntryConsensusOk(signal: MultiTimeframeSignal, trendState: TrendState): boolean {
    if (!this.cfg.enabled) return true;
    if (signal.direction === 'CHOP') return false;
    if (signal.consensus < this.cfg.minConsensus) return false;
    return signal.direction === trendState;
  }

  isOppositeExitSignal(signal: MultiTimeframeSignal, positionSide: 'LONG' | 'SHORT'): boolean {
    if (!this.cfg.enabled) return false;
    if (signal.direction === 'CHOP') return false;
    if (signal.consensus < this.cfg.oppositeExitConsensus) return false;
    if (positionSide === 'LONG') return signal.direction === 'DOWN';
    return signal.direction === 'UP';
  }

  private resolveOrFallback(...values: Array<number | null | undefined>): number {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  private normalize(raw: number, norm: number): number {
    const safeNorm = Number.isFinite(norm) && norm > 0 ? norm : 1;
    return Number(raw || 0) / safeNorm;
  }

  private directionFromNormalized(value: number): TrendState {
    if (value > this.cfg.deadband) return 'UP';
    if (value < -this.cfg.deadband) return 'DOWN';
    return 'CHOP';
  }

  private weightedStrength(normalized: number, weight: number, sign: 1 | -1): number {
    const n = Number(normalized || 0);
    if (sign === 1 && n <= this.cfg.deadband) return 0;
    if (sign === -1 && n >= -this.cfg.deadband) return 0;
    const strength = clamp(Math.abs(n), 0, 1);
    const safeWeight = Math.max(0, Number(weight || 0));
    return strength * safeWeight;
  }
}

