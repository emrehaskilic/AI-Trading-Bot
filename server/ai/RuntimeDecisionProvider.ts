import { DecisionProvider, DecisionProviderInput, DecisionView } from './DecisionProvider';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function resolveConfidence(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

export class RuntimeDecisionProvider implements DecisionProvider {
  public readonly mode = 'on' as const;

  public isDecisionEnabled(): boolean {
    return true;
  }

  public evaluate(input: DecisionProviderInput): DecisionView {
    const nowMs = Number(input.nowMs || Date.now());
    const aiTrend = input.aiTrendStatus;
    const aiBias = input.aiBiasStatus;
    const strategyPosition = input.strategyPosition;

    const hasOpenStrategyPosition = Boolean(
      strategyPosition
      && (strategyPosition.side === 'LONG' || strategyPosition.side === 'SHORT')
      && Number(strategyPosition.qty || 0) > 0,
    );
    const biasSide = aiBias?.side === 'LONG' || aiBias?.side === 'SHORT'
      ? aiBias.side
      : null;
    const signal = hasOpenStrategyPosition
      ? `POSITION_${strategyPosition.side}`
      : (biasSide ? `BIAS_${biasSide}` : null);
    const signalScore = hasOpenStrategyPosition
      ? 100
      : (biasSide ? Math.round(clamp(Number(aiBias?.confidence || 0) * 100, 0, 100)) : 0);

    return {
      aiTrend: aiTrend ? {
        side: aiTrend.side ?? null,
        score: Number(Number(aiTrend.score || 0).toFixed(4)),
        intact: Boolean(aiTrend.intact),
        ageMs: Number.isFinite(Number(aiTrend.ageMs)) ? Number(aiTrend.ageMs) : null,
        breakConfirm: Number(aiTrend.breakConfirm || 0),
        source: aiTrend.source,
      } : null,
      aiBias: aiBias ? {
        side: aiBias.side,
        confidence: Number(Number(aiBias.confidence || 0).toFixed(4)),
        source: aiBias.source,
        lockedByPosition: Boolean(aiBias.lockedByPosition),
        breakConfirm: Number(aiBias.breakConfirm || 0),
        reason: aiBias.reason || null,
        timestampMs: Number(aiBias.timestampMs || nowMs),
      } : null,
      signalDisplay: {
        signal,
        score: signalScore,
        confidence: resolveConfidence(signalScore),
        vetoReason: signal ? null : (aiBias?.reason || input.defaultVetoReason || 'BIAS_NEUTRAL'),
        candidate: null,
        regime: input.decision?.regime ?? null,
        dfsPercentile: input.decision?.dfsPercentile ?? null,
        actions: input.decision?.actions ?? [],
        reasons: input.decision?.reasons ?? [],
        gatePassed: Boolean(input.decision?.gatePassed),
      },
      suppressDryRunPosition: false,
    };
  }
}

