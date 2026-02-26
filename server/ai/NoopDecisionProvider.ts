import { DecisionProvider, DecisionProviderInput, DecisionView } from './DecisionProvider';

const DISABLED_REASON = 'DISABLED_DECISION_ENGINE';

export class NoopDecisionProvider implements DecisionProvider {
  public readonly mode = 'off' as const;

  public isDecisionEnabled(): boolean {
    return false;
  }

  public evaluate(input: DecisionProviderInput): DecisionView {
    return {
      aiTrend: {
        side: 'NONE',
        score: 0,
        intact: false,
        ageMs: 0,
        breakConfirm: 0,
        source: 'disabled',
      },
      aiBias: {
        side: 'NONE',
        confidence: 0,
        source: 'DISABLED',
        lockedByPosition: false,
        breakConfirm: 0,
        reason: DISABLED_REASON,
        timestampMs: Number(input.nowMs || Date.now()),
      },
      signalDisplay: {
        signal: 'NONE',
        score: 0,
        confidence: 'LOW',
        vetoReason: DISABLED_REASON,
        candidate: null,
        regime: 'UNKNOWN',
        dfsPercentile: null,
        actions: [],
        reasons: [DISABLED_REASON],
        gatePassed: false,
      },
      suppressDryRunPosition: true,
    };
  }
}

