export type DecisionMode = 'off' | 'on';

export interface DecisionProviderInput {
  symbol: string;
  nowMs: number;
  decision: any | null;
  aiTrendStatus: any | null;
  aiBiasStatus: any | null;
  strategyPosition: any | null;
  defaultVetoReason: string | null;
}

export interface DecisionView {
  aiTrend: {
    side: 'LONG' | 'SHORT' | 'NONE' | null;
    score: number;
    intact: boolean;
    ageMs: number | null;
    breakConfirm: number;
    source?: 'runtime' | 'bootstrap' | 'disabled';
  } | null;
  aiBias: {
    side: 'LONG' | 'SHORT' | 'NEUTRAL' | 'NONE';
    confidence: number;
    source: 'POSITION_LOCK' | 'TREND_LOCK' | 'STATE' | 'EXIT_SIGNAL' | 'DISABLED';
    lockedByPosition: boolean;
    breakConfirm: number;
    reason: string | null;
    timestampMs: number;
  } | null;
  signalDisplay: {
    signal: string | null;
    score: number;
    confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    vetoReason: string | null;
    candidate: { entryPrice: number; tpPrice: number; slPrice: number } | null;
    regime: string | null;
    dfsPercentile: number | null;
    actions: any[];
    reasons: string[];
    gatePassed: boolean;
  };
  suppressDryRunPosition: boolean;
}

export interface DecisionProvider {
  readonly mode: DecisionMode;
  isDecisionEnabled(): boolean;
  evaluate(input: DecisionProviderInput): DecisionView;
}

