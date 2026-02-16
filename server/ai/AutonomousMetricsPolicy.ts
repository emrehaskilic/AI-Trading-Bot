import { AIAction, AIMetricsSnapshot } from './types';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const tanhNorm = (value: number, scale: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 0;
  return Math.tanh(value / scale);
};

const roundTo = (value: number, decimals: number): number => {
  const m = Math.pow(10, Math.max(0, decimals));
  return Math.round(value * m) / m;
};

export type AutonomousPolicyDecision = {
  action: AIAction;
  confidence: number;
  diagnostics: {
    directionalScore: number;
    trendScore: number;
    flowScore: number;
    activityScore: number;
    riskPenalty: number;
  };
};

/**
 * Deterministic fallback policy used when AI output is missing/invalid
 * and as a guardrail when AI stays on HOLD despite strong metrics.
 */
export class AutonomousMetricsPolicy {
  decide(snapshot: AIMetricsSnapshot): AutonomousPolicyDecision {
    const directionalScore = this.computeDirectionalScore(snapshot);
    const confidence = clamp(Math.abs(directionalScore), 0, 2);
    const side = directionalScore >= 0 ? 'LONG' : 'SHORT';

    const marketSpread = Number(snapshot.market.spreadPct ?? 0);
    const spreadBlocked = Number.isFinite(marketSpread) && marketSpread > 0.6;
    const weakActivity = snapshot.trades.printsPerSecond < 0.25 || snapshot.trades.tradeCount < 4;

    const riskPenalty = (spreadBlocked ? 0.35 : 0) + (weakActivity ? 0.2 : 0);
    const effectiveConfidence = Math.max(0, confidence - riskPenalty);

    const diagnostics = {
      directionalScore: roundTo(directionalScore, 6),
      trendScore: roundTo(this.computeTrendScore(snapshot), 6),
      flowScore: roundTo(this.computeFlowScore(snapshot), 6),
      activityScore: roundTo(this.computeActivityScore(snapshot), 6),
      riskPenalty: roundTo(riskPenalty, 6),
    };

    if (!snapshot.position) {
      if (effectiveConfidence >= 0.72 && !spreadBlocked && !weakActivity) {
        const sizeMultiplier = clamp(0.35 + (effectiveConfidence * 0.45), 0.35, 1.2);
        return {
          action: {
            action: 'ENTRY',
            side,
            sizeMultiplier: roundTo(sizeMultiplier, 4),
            reason: `policy_entry_score_${roundTo(effectiveConfidence, 3)}`,
          },
          confidence: roundTo(effectiveConfidence, 6),
          diagnostics,
        };
      }
      return {
        action: { action: 'HOLD', reason: `policy_hold_flat_${roundTo(effectiveConfidence, 3)}` },
        confidence: roundTo(effectiveConfidence, 6),
        diagnostics,
      };
    }

    const positionSign = snapshot.position.side === 'LONG' ? 1 : -1;
    const alignment = directionalScore * positionSign;
    const pnl = Number(snapshot.position.unrealizedPnlPct || 0);
    const addsUsed = Number(snapshot.position.addsUsed || 0);

    if (pnl <= -0.008 || alignment <= -0.95) {
      return {
        action: {
          action: 'EXIT',
          reason: `policy_exit_alignment_${roundTo(alignment, 3)}_pnl_${roundTo(pnl, 4)}`,
        },
        confidence: roundTo(effectiveConfidence, 6),
        diagnostics,
      };
    }

    if (pnl <= -0.004 || alignment <= -0.55) {
      const reducePct = clamp(0.3 + Math.abs(Math.min(alignment, 0)) * 0.45, 0.25, 0.8);
      return {
        action: {
          action: 'REDUCE',
          reducePct: roundTo(reducePct, 4),
          reason: `policy_reduce_alignment_${roundTo(alignment, 3)}_pnl_${roundTo(pnl, 4)}`,
        },
        confidence: roundTo(effectiveConfidence, 6),
        diagnostics,
      };
    }

    if (pnl >= 0.002 && alignment >= 0.88 && addsUsed < 3 && !spreadBlocked) {
      const sizeMultiplier = clamp(0.2 + (alignment * 0.25), 0.2, 0.7);
      return {
        action: {
          action: 'ADD',
          sizeMultiplier: roundTo(sizeMultiplier, 4),
          reason: `policy_add_alignment_${roundTo(alignment, 3)}`,
        },
        confidence: roundTo(effectiveConfidence, 6),
        diagnostics,
      };
    }

    return {
      action: { action: 'HOLD', reason: `policy_hold_alignment_${roundTo(alignment, 3)}` },
      confidence: roundTo(effectiveConfidence, 6),
      diagnostics,
    };
  }

  private computeDirectionalScore(snapshot: AIMetricsSnapshot): number {
    const trend = this.computeTrendScore(snapshot);
    const flow = this.computeFlowScore(snapshot);
    const activity = this.computeActivityScore(snapshot);

    return (trend * 0.45) + (flow * 0.4) + (activity * 0.15);
  }

  private computeTrendScore(snapshot: AIMetricsSnapshot): number {
    const deltaZ = tanhNorm(snapshot.market.deltaZ, 2.5);
    const delta5s = tanhNorm(snapshot.market.delta5s, Math.max(10, Math.abs(snapshot.market.price) * 0.0008));
    const vwapDrift = tanhNorm(snapshot.market.price - snapshot.market.vwap, Math.max(10, Math.abs(snapshot.market.price) * 0.0012));
    return (deltaZ * 0.5) + (delta5s * 0.35) + (vwapDrift * 0.15);
  }

  private computeFlowScore(snapshot: AIMetricsSnapshot): number {
    const cvd = tanhNorm(snapshot.market.cvdSlope, 20_000);
    const obiWeighted = clamp(Number(snapshot.market.obiWeighted || 0), -1, 1);
    const obiDeep = clamp(Number(snapshot.market.obiDeep || 0), -1, 1);
    const burst = snapshot.trades.burstSide === 'buy'
      ? clamp(snapshot.trades.burstCount / 10, 0, 1)
      : snapshot.trades.burstSide === 'sell'
        ? -clamp(snapshot.trades.burstCount / 10, 0, 1)
        : 0;
    const oi = tanhNorm(Number(snapshot.openInterest.oiChangePct || 0), 1.2);
    const absorption = snapshot.absorption.value > 0
      ? (snapshot.absorption.side === 'buy' ? 0.25 : snapshot.absorption.side === 'sell' ? -0.25 : 0)
      : 0;
    return (cvd * 0.35) + (obiWeighted * 0.25) + (obiDeep * 0.2) + (burst * 0.15) + (oi * 0.05) + absorption;
  }

  private computeActivityScore(snapshot: AIMetricsSnapshot): number {
    const prints = clamp(snapshot.trades.printsPerSecond / 8, 0, 1);
    const tradeCount = clamp(snapshot.trades.tradeCount / 20, 0, 1);
    const imbalance = tanhNorm(
      snapshot.trades.aggressiveBuyVolume - snapshot.trades.aggressiveSellVolume,
      Math.max(1, snapshot.trades.aggressiveBuyVolume + snapshot.trades.aggressiveSellVolume)
    );
    return (prints * 0.35) + (tradeCount * 0.25) + (imbalance * 0.4);
  }
}
