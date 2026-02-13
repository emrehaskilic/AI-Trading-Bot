import { OrchestratorMetricsInput, RiskScore, LiquidationRiskStatus, SymbolState } from './types';

export interface LiquidationRiskConfig {
  emergencyMarginRatio: number;
  yellowThreshold: number;
  orangeThreshold: number;
  redThreshold: number;
  criticalThreshold: number;
  timeToLiquidationWarningMs: number;
  fundingRateImpactFactor: number;
  volatilityImpactFactor: number;
}

const DEFAULT_CONFIG: LiquidationRiskConfig = {
  emergencyMarginRatio: 0.05,
  yellowThreshold: 0.30,
  orangeThreshold: 0.20,
  redThreshold: 0.10,
  criticalThreshold: 0.05,
  timeToLiquidationWarningMs: 5 * 60 * 1000,
  fundingRateImpactFactor: 2.5,
  volatilityImpactFactor: 1.2,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class LiquidationRiskCalculator {
  private readonly config: LiquidationRiskConfig;

  constructor(config?: Partial<LiquidationRiskConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  calculate(state: SymbolState, metrics?: OrchestratorMetricsInput): LiquidationRiskStatus {
    const now = Date.now();

    if (!state.position || typeof state.marginRatio !== 'number' || !Number.isFinite(state.marginRatio)) {
      return {
        score: 'GREEN',
        timeToLiquidationMs: null,
        fundingRateImpact: 0,
        volatilityImpact: 0,
        reason: state.position ? 'missing_margin_ratio' : 'no_position',
        lastCalculatedAt: now,
      };
    }

    const marginRatio = state.marginRatio;
    let score: RiskScore = 'GREEN';

    if (marginRatio <= this.config.criticalThreshold) {
      score = 'CRITICAL';
    } else if (marginRatio <= this.config.redThreshold) {
      score = 'RED';
    } else if (marginRatio <= this.config.orangeThreshold) {
      score = 'ORANGE';
    } else if (marginRatio <= this.config.yellowThreshold) {
      score = 'YELLOW';
    }

    const fundingRate = metrics?.funding?.rate ?? 0;
    const fundingTrend = metrics?.funding?.trend ?? null;
    const fundingImpact = fundingRate * this.config.fundingRateImpactFactor;

    if (fundingImpact !== 0 && state.position) {
      const isLong = state.position.side === 'LONG';
      const fundingBadForSide = (isLong && fundingRate > 0) || (!isLong && fundingRate < 0);
      if (fundingBadForSide && score !== 'CRITICAL') {
        score = score === 'GREEN' ? 'YELLOW' : score === 'YELLOW' ? 'ORANGE' : score === 'ORANGE' ? 'RED' : score;
      }
    }

    const deltaZ = metrics?.legacyMetrics?.deltaZ ?? 0;
    const printsPerSecond = metrics?.prints_per_second ?? 0;
    const volatilityIndex = clamp(Math.abs(deltaZ) / 3 + printsPerSecond / 25, 0, 3);
    const volatilityImpact = volatilityIndex * this.config.volatilityImpactFactor;

    if (volatilityImpact >= 1.5 && score !== 'CRITICAL') {
      score = score === 'GREEN' ? 'YELLOW' : score === 'YELLOW' ? 'ORANGE' : score === 'ORANGE' ? 'RED' : score;
    }

    const timeToLiquidationMs = this.estimateTimeToLiquidation(marginRatio, volatilityIndex);

    return {
      score,
      timeToLiquidationMs,
      fundingRateImpact: Number(fundingImpact.toFixed(6)),
      volatilityImpact: Number(volatilityImpact.toFixed(3)),
      reason: score === 'CRITICAL' ? 'critical_margin' : null,
      lastCalculatedAt: now,
    };
  }

  private estimateTimeToLiquidation(marginRatio: number, volatilityIndex: number): number | null {
    if (!Number.isFinite(marginRatio) || marginRatio <= 0) {
      return 0;
    }
    const safeVol = Math.max(0.5, volatilityIndex);
    const distance = Math.max(0, marginRatio - this.config.criticalThreshold);
    const normalized = distance / Math.max(0.01, this.config.yellowThreshold);
    const base = this.config.timeToLiquidationWarningMs;
    return Math.max(0, Math.round(base * normalized / safeVol));
  }
}
