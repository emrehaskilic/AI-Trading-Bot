import { ExecutionEvent, OrderType, Side } from '../connectors/executionTypes';

export interface OrchestratorMetricsInput {
  symbol: string;
  strategyRegime?: string | null;
  canonical_time_ms?: number;
  exchange_event_time_ms?: number | null;
  spread_pct?: number | null;
  prints_per_second?: number | null;
  best_bid?: number | null;
  best_ask?: number | null;
  advancedMetrics?: {
    volatilityIndex?: number | null;
  } | null;
  legacyMetrics?: {
    obiDeep?: number | null;
    deltaZ?: number | null;
    cvdSlope?: number | null;
  } | null;
  multiTimeframe?: {
    m1TrendScore?: number | null;
    m3TrendScore?: number | null;
    m5TrendScore?: number | null;
    m15TrendScore?: number | null;
  } | null;
  funding?: {
    rate?: number | null;
    timeToFundingMs?: number | null;
    trend?: 'up' | 'down' | 'flat' | null;
  } | null;
}

export type ExecQualityLevel = 'UNKNOWN' | 'GOOD' | 'BAD';

export const GateMode = {
  V1_NO_LATENCY: 'V1_NO_LATENCY',
  V2_NETWORK_LATENCY: 'V2_NETWORK_LATENCY',
} as const;

export type GateMode = typeof GateMode[keyof typeof GateMode];

export interface GateConfig {
  mode: GateMode;
  maxSpreadPct: number;
  minObiDeep: number;
  v2?: {
    maxNetworkLatencyMs: number;
  };
}

export interface GateResult {
  mode: GateMode;
  passed: boolean;
  reason: string | null;
  network_latency_ms: number | null;
  checks: {
    hasRequiredMetrics: boolean;
    spreadOk: boolean;
    obiDeepOk: boolean;
    networkLatencyOk: boolean | null;
  };
}

export type DecisionActionType =
  | 'NOOP'
  | 'ENTRY_PROBE'
  | 'ADD_POSITION'
  | 'EXIT_MARKET'
  | 'CANCEL_OPEN_ENTRY_ORDERS';

export interface DecisionAction {
  type: DecisionActionType;
  symbol: string;
  event_time_ms: number;
  side?: Side;
  quantity?: number;
  reduceOnly?: boolean;
  expectedPrice?: number | null;
  reason?: string;
}

export interface OpenOrderState {
  orderId: string;
  clientOrderId: string;
  side: Side;
  orderType: OrderType;
  status: string;
  origQty: number;
  executedQty: number;
  price: number;
  reduceOnly: boolean;
  event_time_ms: number;
}

export interface MetricsEventEnvelope {
  kind: 'metrics';
  symbol: string;
  canonical_time_ms: number;
  exchange_event_time_ms: number | null;
  metrics: OrchestratorMetricsInput;
  gate: GateResult;
}

export interface ExecutionEventEnvelope {
  kind: 'execution';
  symbol: string;
  event_time_ms: number;
  execution: ExecutionEvent;
}

export type ActorEnvelope = MetricsEventEnvelope | ExecutionEventEnvelope;

export interface PositionState {
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  unrealizedPnlPct: number;
  addsUsed: number;
  peakPnlPct: number;
  profitLockActivated: boolean;
  hardStopPrice: number | null;
}

export interface ExecQualityState {
  quality: ExecQualityLevel;
  metricsPresent: boolean;
  freezeActive: boolean;
  lastLatencyMs: number | null;
  lastSlippageBps: number | null;
  lastSpreadPct: number | null;
  recentLatencyMs: number[];
  recentSlippageBps: number[];
}

export type RiskScore = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'CRITICAL';

export interface LiquidationRiskStatus {
  score: RiskScore;
  timeToLiquidationMs: number | null;
  fundingRateImpact: number;
  volatilityImpact: number;
  reason: string | null;
  lastCalculatedAt: number;
}

export interface SymbolState {
  symbol: string;
  halted: boolean;
  availableBalance: number;
  walletBalance: number;
  position: PositionState | null;
  openOrders: Map<string, OpenOrderState>;
  hasOpenEntryOrder: boolean;
  pendingEntry: boolean;
  cooldown_until_ms: number;
  last_exit_event_time_ms: number;
  marginRatio: number | null;
  execQuality: ExecQualityState;
  liquidationRiskStatus?: LiquidationRiskStatus;
}

export interface OrderPlanConfig {
  planEpochMs: number;
  orderPrefix: string;
  planRebuildCooldownMs: number;
  minMarginUsdt: number;
  limitBufferBps: number;
  defaultTickSize: number;
  orderPriceTolerancePct: number;
  orderQtyTolerancePct: number;
  replaceThrottlePerSecond: number;
  cancelStalePlanOrders: boolean;
  allowedSides?: 'BOTH' | 'LONG' | 'SHORT';
  volatilitySizing?: {
    enabled: boolean;
    referenceSymbol: string;
    minFactor: number;
    maxFactor: number;
  };
  boot: {
    probeMarketPct: number;
    waitReadyMs: number;
    maxSpreadPct: number;
    minObiDeep: number;
    minDeltaZ: number;
    allowMarket: boolean;
    retryMs: number;
  };
  trend: {
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
    obiNorm: number;
    deltaNorm: number;
    cvdNorm: number;
    scoreClamp: number;
  };
  multiTimeframe?: {
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
  };
  scaleIn: {
    levels: number;
    stepPct: number;
    maxAdds: number;
    addOnlyIfTrendConfirmed: boolean;
    addOnlyIfPositive?: boolean;
    addMinUpnlUsdt: number;
    addMinUpnlR: number;
  };
  tp: {
    levels: number;
    stepPcts: number[];
    distribution: number[];
    reduceOnly: boolean;
  };
  stop: {
    distancePct: number;
    reduceOnly: boolean;
    riskPct?: number;
  };
  profitLock: {
    lockTriggerUsdt: number;
    lockTriggerR: number;
    maxDdFromPeakUsdt: number;
    maxDdFromPeakR: number;
  };
  regimeConfigs?: {
    TREND?: {
      profitLockTriggerR?: number;
      scaleInLevels?: number;
      stopDistancePct?: number;
    };
    MR?: {
      profitLockTriggerR?: number;
      scaleInLevels?: number;
      stopDistancePct?: number;
    };
    EV?: {
      profitLockTriggerR?: number;
      scaleInLevels?: number;
      stopDistancePct?: number;
    };
  };
  trailingStop?: {
    enabled: boolean;
    activationR: number;
    trailingRatio: number;
    minDrawdownR: number;
  };
  reversalExitMode: 'MARKET' | 'LIMIT';
  exitLimitBufferBps: number;
  exitRetryMs: number;
  allowFlip: boolean;
  initialMarginUsdt: number;
  maxMarginUsdt: number;
  stepUp: {
    mode: 'UPNL' | 'R_MULTIPLE' | 'TREND_SCORE';
    stepPct: number;
    triggerUsdt: number;
    triggerR: number;
    minTrendScore: number;
    cooldownMs: number;
  };
}

export interface OrchestratorConfig {
  engineMode?: 'PLAN' | 'DECISION';
  maxLeverage: number;
  loggerQueueLimit: number;
  loggerDropHaltThreshold: number;
  gate: GateConfig;
  cooldown: { minMs: number; maxMs: number };
  startingMarginUsdt: number;
  minMarginUsdt: number;
  rampStepPct: number;
  rampDecayPct: number;
  rampMaxMult: number;
  hardStopLossPct: number;
  dailyKillSwitchPct: number;
  liquidationEmergencyMarginRatio: number;
  takerFeeBps: number;
  profitLockBufferBps: number;
  plan: OrderPlanConfig;
}
