import { IMetricsCollector } from '../metrics/types';
import { ExecQualityLevel } from './types';

export interface FreezeAssessment {
  freezeActive: boolean;
  reason: 'exec_quality_unknown' | 'exec_quality_bad' | 'max_daily_drawdown_hit' | 'liquidation_risk_high' | null;
}

export function assessFreezeFromExecQuality(quality: ExecQualityLevel): FreezeAssessment {
  if (quality === 'BAD') {
    return { freezeActive: true, reason: 'exec_quality_bad' };
  }
  if (quality === 'UNKNOWN') {
    return { freezeActive: true, reason: 'exec_quality_unknown' };
  }
  return { freezeActive: false, reason: null };
}

export class FreezeController {
  private maxDailyDrawdownRatio: number;
  private liquidationRiskThreshold: number;
  private freezeOnUnknown: boolean;

  constructor(config?: { maxDailyDrawdownRatio?: number; liquidationRiskThreshold?: number; freezeOnUnknown?: boolean }) {
    this.maxDailyDrawdownRatio = config?.maxDailyDrawdownRatio ?? 0.05;
    this.liquidationRiskThreshold = config?.liquidationRiskThreshold ?? 0.8;
    this.freezeOnUnknown = config?.freezeOnUnknown ?? true;
  }

  assessFreeze(quality: ExecQualityLevel, metrics: IMetricsCollector): FreezeAssessment {
    if (quality === 'BAD') {
      return { freezeActive: true, reason: 'exec_quality_bad' };
    }
    if (quality === 'UNKNOWN' && this.freezeOnUnknown) {
      return { freezeActive: true, reason: 'exec_quality_unknown' };
    }

    const initialCapital = metrics.getInitialCapital();
    const dailyPnL = metrics.getDailyPnL();
    if (initialCapital > 0 && dailyPnL / initialCapital < -this.maxDailyDrawdownRatio) {
      return { freezeActive: true, reason: 'max_daily_drawdown_hit' };
    }

    const liquidationRisk = metrics.getLiquidationRisk();
    if (liquidationRisk > this.liquidationRiskThreshold) {
      return { freezeActive: true, reason: 'liquidation_risk_high' };
    }

    return { freezeActive: false, reason: null };
  }
}
