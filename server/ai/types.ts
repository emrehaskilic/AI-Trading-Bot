import { StrategyRegime, StrategySide } from '../types/strategy';
import type {
  CrossMarketMetrics,
  DerivativesMetrics,
  LiquidityMetrics,
  PassiveFlowMetrics,
  RegimeMetrics,
  ToxicityMetrics,
} from '../metrics/AdvancedMicrostructureMetrics';

export type AIDecisionIntent = 'HOLD' | 'ENTER' | 'MANAGE' | 'EXIT';
export type AIDecisionSide = 'LONG' | 'SHORT';
export type AIUrgency = 'LOW' | 'MED' | 'HIGH';
export type AIEntryStyle = 'LIMIT' | 'MARKET_SMALL' | 'HYBRID';
export type AIAddRule = 'WINNER_ONLY' | 'TREND_INTACT' | 'NEVER';
export type AIInvalidationHint = 'VWAP' | 'ATR' | 'OBI_FLIP' | 'ABSORPTION_BREAK' | 'NONE';
export type AIExplanationTag =
  | 'OBI_UP'
  | 'OBI_DOWN'
  | 'DELTA_BURST'
  | 'CVD_TREND_UP'
  | 'CVD_TREND_DOWN'
  | 'VWAP_RECLAIM'
  | 'VWAP_REJECT'
  | 'OI_EXPANSION'
  | 'OI_CONTRACTION'
  | 'ABSORPTION_BUY'
  | 'ABSORPTION_SELL'
  | 'SPREAD_WIDE'
  | 'ACTIVITY_WEAK'
  | 'RISK_LOCK'
  | 'COOLDOWN_ACTIVE'
  | 'INTEGRITY_FAIL'
  | 'TREND_INTACT'
  | 'TREND_BROKEN';

export type GuardrailReason =
  | 'SPREAD_TOO_WIDE'
  | 'ACTIVITY_WEAK'
  | 'INTEGRITY_FAIL'
  | 'COOLDOWN_ACTIVE'
  | 'ADD_GAP_ACTIVE'
  | 'FLIP_COOLDOWN_ACTIVE'
  | 'MIN_HOLD_ACTIVE'
  | 'RISK_LOCK'
  | 'MARGIN_CAP'
  | 'GATE_NOT_PASSED'
  | 'EDGE_TOO_WEAK'
  | 'UNDERTRADING_PROBE';

export type AIDryRunConfig = {
  apiKey?: string;
  model?: string;
  decisionIntervalMs: number;
  temperature: number;
  maxOutputTokens: number;
  localOnly?: boolean;
  minHoldMs: number;
  flipCooldownMs: number;
  minAddGapMs: number;
};

export type AIDecisionTelemetry = {
  invalidLLMResponses: number;
  repairCalls: number;
  guardrailBlocks: number;
  forcedExits: number;
  flipsCount: number;
  addsCount: number;
  probeEntries: number;
  edgeFilteredEntries: number;
  holdOverrides: number;
  avgHoldTimeMs: number;
  feePct: number | null;
};

export type AITrendStatus = {
  side: StrategySide | null;
  score: number;
  intact: boolean;
  ageMs: number | null;
  breakConfirm: number;
  source: 'runtime' | 'bootstrap';
};

export type AIBiasStatus = {
  side: StrategySide | 'NEUTRAL';
  confidence: number;
  source: 'POSITION_LOCK' | 'TREND_LOCK' | 'STATE' | 'EXIT_SIGNAL';
  lockedByPosition: boolean;
  breakConfirm: number;
  reason: string | null;
  timestampMs: number;
};

export type AIDryRunStatus = {
  active: boolean;
  model: string | null;
  decisionIntervalMs: number;
  temperature: number;
  maxOutputTokens: number;
  apiKeySet: boolean;
  localOnly: boolean;
  lastError: string | null;
  symbols: string[];
  telemetry: AIDecisionTelemetry;
  performance: {
    samples: number;
    winRate: number;
    avgOutcome: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
  };
};

export type AIMetricsSnapshot = {
  symbol: string;
  timestampMs: number;
  decision: {
    regime: StrategyRegime;
    dfs: number;
    dfsPercentile: number;
    volLevel: number;
    gatePassed: boolean;
    thresholds: {
      longEntry: number;
      longBreak: number;
      shortEntry: number;
      shortBreak: number;
    };
  };
  blockedReasons: string[];
  riskState: {
    equity: number;
    leverage: number;
    startingMarginUser: number;
    marginInUse: number;
    drawdownPct: number;
    dailyLossLock: boolean;
    cooldownMsRemaining: number;
    marginHealth?: number;
    maintenanceMarginRatio?: number;
    liquidationProximityPct?: number;
  };
  executionState: {
    lastAction: AIDecisionIntent | 'NONE';
    holdStreak: number;
    lastAddMsAgo: number | null;
    lastFlipMsAgo: number | null;
    winnerStopArmed?: boolean;
    winnerStopType?: 'TRAIL_STOP' | 'PROFITLOCK' | null;
    winnerStopPrice?: number | null;
    winnerRMultiple?: number | null;
    trendBias?: StrategySide | null;
    trendStrength?: number;
    trendIntact?: boolean;
    trendAgeMs?: number | null;
    trendBreakConfirm?: number;
    lastTrendTakeProfitMsAgo?: number | null;
    bootstrapPhaseMsRemaining?: number;
    bootstrapSeedStrength?: number;
    bootstrapWarmupMsRemaining?: number;
  };
  market: {
    price: number;
    vwap: number;
    spreadPct: number | null;
    delta1s: number;
    delta5s: number;
    deltaZ: number;
    cvdSlope: number;
    obiWeighted: number;
    obiDeep: number;
    obiDivergence: number;
  };
  trades: {
    printsPerSecond: number;
    tradeCount: number;
    aggressiveBuyVolume: number;
    aggressiveSellVolume: number;
    burstCount: number;
    burstSide: 'buy' | 'sell' | null;
  };
  liquidityMetrics: LiquidityMetrics;
  passiveFlowMetrics: PassiveFlowMetrics;
  derivativesMetrics: DerivativesMetrics;
  toxicityMetrics: ToxicityMetrics;
  regimeMetrics: RegimeMetrics;
  crossMarketMetrics: CrossMarketMetrics | null;
  enableCrossMarketConfirmation: boolean;
  openInterest: {
    oiChangePct: number | null;
  };
  absorption: {
    value: number;
    side: 'buy' | 'sell' | null;
  };
  volatility: number;
  position: {
    side: StrategySide;
    qty: number;
    entryPrice: number;
    unrealizedPnlPct: number;
    addsUsed: number;
    timeInPositionMs: number;
  } | null;
};

export type AIAddTrigger = {
  minUnrealizedPnlPct: number;
  trendIntact: boolean;
  obiSupportMin: number;
  deltaConfirm: boolean;
};

export type AIDecisionPlan = {
  version: 1;
  nonce: string;
  intent: AIDecisionIntent;
  side: AIDecisionSide | null;
  urgency: AIUrgency;
  entryStyle: AIEntryStyle;
  sizeMultiplier?: number;
  maxAdds: number;
  addRule: AIAddRule;
  addTrigger: AIAddTrigger;
  reducePct: number | null;
  invalidationHint: AIInvalidationHint;
  explanationTags: AIExplanationTag[];
  confidence: number;
};

export type AIForcedAction = {
  intent: 'HOLD' | 'EXIT' | 'MANAGE';
  reducePct?: number;
  reason: GuardrailReason | 'INVALID_AI_RESPONSE';
};
