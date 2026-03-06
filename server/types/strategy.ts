export const StrategyRegime = {
  EV: 'EV',
  TR: 'TR',
  MR: 'MR',
} as const;

export type StrategyRegime = typeof StrategyRegime[keyof typeof StrategyRegime];

export const StrategySide = {
  LONG: 'LONG',
  SHORT: 'SHORT',
} as const;

export type StrategySide = typeof StrategySide[keyof typeof StrategySide];

export const StrategyActionType = {
  NOOP: 'NOOP',
  ENTRY: 'ENTRY',
  ADD: 'ADD',
  REDUCE: 'REDUCE',
  EXIT: 'EXIT',
} as const;

export type StrategyActionType = typeof StrategyActionType[keyof typeof StrategyActionType];

export type DecisionReason =
  | 'GATE_PAUSED'
  | 'GATE_SOURCE_NOT_REAL'
  | 'GATE_STALE_TRADES'
  | 'GATE_STALE_ORDERBOOK'
  | 'GATE_LOW_PRINTS'
  | 'GATE_WIDE_SPREAD'
  | 'REGIME_LOCKED'
  | 'REGIME_EV_OVERRIDE'
  | 'REGIME_TRMR_LOCK'
  | 'ENTRY_TR'
  | 'ENTRY_MR'
  | 'ENTRY_EV'
  | 'ENTRY_BLOCKED_COOLDOWN'
  | 'ENTRY_BLOCKED_MHT'
  | 'ENTRY_BLOCKED_GATE'
  | 'ENTRY_BLOCKED_FILTERS'
  | 'ADD_WINNER'
  | 'STRAT_ADD'
  | 'ADD_BLOCKED'
  | 'REDUCE_SOFT'
  | 'REDUCE_EXHAUSTION'
  | 'EXIT_HARD'
  | 'EXIT_STOP_LOSS'
  | 'EXIT_HARD_REVERSAL'
  | 'HARD_REVERSAL_ENTRY'
  | 'HARD_REVERSAL_REJECTED'
  | 'NO_SIGNAL'
  | 'NOOP';

export interface StrategyAction {
  type: StrategyActionType;
  side?: StrategySide;
  reason: DecisionReason;
  expectedPrice?: number | null;
  sizeMultiplier?: number;
  reducePct?: number;
  metadata?: Record<string, unknown>;
}

export interface StrategyDecisionLog {
  timestampMs: number;
  symbol: string;
  regime: StrategyRegime;
  gate: {
    passed: boolean;
    reason: DecisionReason | null;
    details: Record<string, unknown>;
  };
  dfs: number;
  dfsPercentile: number;
  volLevel: number;
  thresholds: {
    longEntry: number;
    longBreak: number;
    shortEntry: number;
    shortBreak: number;
  };
  reasons: DecisionReason[];
  actions: StrategyAction[];
  stats: Record<string, number | null>;
  replayInput?: StrategyInput;
}

export interface StrategyDecision {
  symbol: string;
  timestampMs: number;
  regime: StrategyRegime;
  dfs: number;
  dfsPercentile: number;
  volLevel: number;
  gatePassed: boolean;
  actions: StrategyAction[];
  reasons: DecisionReason[];
  log: StrategyDecisionLog;
}

export interface StrategyPositionState {
  side: StrategySide;
  qty: number;
  entryPrice: number;
  unrealizedPnlPct: number;
  addsUsed: number;
  sizePct?: number;
  timeInPositionMs?: number;
  peakPnlPct?: number;
}

export interface StrategyInput {
  symbol: string;
  nowMs: number;
  source: 'real' | 'mock' | 'synthetic' | 'unknown';
  orderbook: {
    lastUpdatedMs: number;
    spreadPct?: number | null;
    bestBid?: number | null;
    bestAsk?: number | null;
  };
  trades: {
    lastUpdatedMs: number;
    printsPerSecond: number;
    tradeCount: number;
    aggressiveBuyVolume: number;
    aggressiveSellVolume: number;
    consecutiveBurst: { side: 'buy' | 'sell' | null; count: number };
  };
  market: {
    price: number;
    vwap: number;
    delta1s: number;
    delta5s: number;
    deltaZ: number;
    cvdSlope: number;
    obiWeighted: number;
    obiDeep: number;
    obiDivergence: number;
  };
  openInterest?: {
    oiChangePct: number;
    lastUpdatedMs: number;
    source: 'real' | 'mock' | 'unknown';
  } | null;
  absorption?: {
    value: number; // 0 or 1
    side: 'buy' | 'sell' | null;
  } | null;
  bootstrap?: {
    backfillDone: boolean;
    barsLoaded1m: number;
  } | null;
  htf?: {
    m15?: {
      close: number | null;
      atr: number | null;
      lastSwingHigh: number | null;
      lastSwingLow: number | null;
      structureBreakUp: boolean;
      structureBreakDn: boolean;
    } | null;
    h1?: {
      close: number | null;
      atr: number | null;
      lastSwingHigh: number | null;
      lastSwingLow: number | null;
      structureBreakUp: boolean;
      structureBreakDn: boolean;
    } | null;
  } | null;
  execution?: {
    tradeReady: boolean;
    addonReady: boolean;
    vetoReason: string | null;
    orderbookTrusted?: boolean;
    integrityLevel?: 'OK' | 'DEGRADED' | 'CRITICAL' | null;
  } | null;
  volatility: number;
  position: StrategyPositionState | null;
}

// Compatibility signal interface for dry-run engines.
export interface StrategySignal {
  signal: string | null;
  score: number;
  vetoReason: string | null;
  candidate: {
    entryPrice: number;
    tpPrice?: number;
    slPrice?: number;
  } | null;
  boost?: {
    score: number;
    contributions: Record<string, number>;
    timeframeMultipliers: Record<string, number>;
  };
  orderflow?: {
    obiWeighted?: number | null;
    obiDeep?: number | null;
    deltaZ?: number | null;
    cvdSlope?: number | null;
  };
  market?: {
    price?: number | null;
    atr?: number | null;
    avgAtr?: number | null;
    recentHigh?: number | null;
    recentLow?: number | null;
  };
}

export interface StrategyConfig {
  decisionTickMs: number;
  rollingWindowMin: number;
  regimeLockTRMRTicks: number;
  regimeLockEVTicks: number;
  volHighP: number;
  volLowP: number;
  dfsEntryLongBase: number;
  dfsBreakLongBase: number;
  dfsEntryShortBase: number;
  dfsBreakShortBase: number;
  mhtTRs: number;
  mhtMRs: number;
  mhtEVs: number;
  cooldownSameS: number;
  cooldownFlipS: number;
  hardRevTicks: number;
  hardRevDfsP: number;
  hardRevRequireAbsorption: boolean;
  defensiveAddEnabled: boolean;
  dryRun: boolean;
  addSizing: number[];
  maxLossPct?: number;
  maxPositionSizePct?: number;
  hardRevSizeMultiplier?: number;
  mrRequireAbsorption?: boolean;
  softReduceRequireProfit?: boolean;
  freshSoftReduceProtectS?: number;
  softReduceCooldownS?: number;
  freshExitProtectS?: number;
  freshReversalProtectS?: number;
  freshExitOverrideLossPct?: number;
  trendCarryReduceMinPeakPnlPct?: number;
  trendCarryReduceGivebackPct?: number;
  trendCarryHardExitMinPeakPnlPct?: number;
  trendCarryHardExitGivebackPct?: number;
}

export const defaultStrategyConfig: StrategyConfig = {
  decisionTickMs: Number(process.env.DECISION_TICK_MS || 1000),
  rollingWindowMin: Number(process.env.ROLLING_WINDOW_MIN || 60),
  regimeLockTRMRTicks: Number(process.env.REGIME_LOCK_TRMR_TICKS || 20),
  regimeLockEVTicks: Number(process.env.REGIME_LOCK_EV_TICKS || 5),
  volHighP: Number(process.env.VOL_HIGH_P || 0.8),
  volLowP: Number(process.env.VOL_LOW_P || 0.2),
  dfsEntryLongBase: Number(process.env.DFS_ENTRY_LONG_BASE || 0.9),
  dfsBreakLongBase: Number(process.env.DFS_BREAK_LONG_BASE || 0.6),
  dfsEntryShortBase: Number(process.env.DFS_ENTRY_SHORT_BASE || 0.1),
  dfsBreakShortBase: Number(process.env.DFS_BREAK_SHORT_BASE || 0.4),
  mhtTRs: Number(process.env.MHT_TR_S || 180),
  mhtMRs: Number(process.env.MHT_MR_S || 90),
  mhtEVs: Number(process.env.MHT_EV_S || 15),
  cooldownSameS: Number(process.env.COOLDOWN_SAME_S || 45),
  cooldownFlipS: Number(process.env.COOLDOWN_FLIP_S || 180),
  hardRevTicks: Number(process.env.HARDREV_TICKS || 10),
  hardRevDfsP: Number(process.env.HARDREV_DFS_P || 0.08),
  hardRevRequireAbsorption: String(process.env.HARDREV_REQUIRE_ABSORPTION || 'true').toLowerCase() === 'true',
  defensiveAddEnabled: String(process.env.DEFENSIVE_ADD_ENABLED || 'false').toLowerCase() === 'true',
  dryRun: String(process.env.DRY_RUN || 'true').toLowerCase() === 'true',
  addSizing: [1.0, 0.6, 0.4],
  maxLossPct: Number(process.env.STRATEGY_MAX_LOSS_PCT || -0.012),
  hardRevSizeMultiplier: Number(process.env.HARDREV_SIZE_MULTIPLIER || 0.5),
  mrRequireAbsorption: String(process.env.MR_REQUIRE_ABSORPTION || 'true').toLowerCase() === 'true',
  softReduceRequireProfit: String(process.env.SOFT_REDUCE_REQUIRE_PROFIT || 'true').toLowerCase() === 'true',
  freshSoftReduceProtectS: Number(process.env.FRESH_SOFT_REDUCE_PROTECT_S || 180),
  softReduceCooldownS: Number(process.env.SOFT_REDUCE_COOLDOWN_S || 180),
  freshExitProtectS: Number(process.env.FRESH_EXIT_PROTECT_S || 90),
  freshReversalProtectS: Number(process.env.FRESH_REVERSAL_PROTECT_S || 180),
  freshExitOverrideLossPct: Number(process.env.FRESH_EXIT_OVERRIDE_LOSS_PCT || -0.004),
  trendCarryReduceMinPeakPnlPct: Number(process.env.TREND_CARRY_REDUCE_MIN_PEAK_PNL_PCT || 0.006),
  trendCarryReduceGivebackPct: Number(process.env.TREND_CARRY_REDUCE_GIVEBACK_PCT || 0.003),
  trendCarryHardExitMinPeakPnlPct: Number(process.env.TREND_CARRY_HARD_EXIT_MIN_PEAK_PNL_PCT || 0.009),
  trendCarryHardExitGivebackPct: Number(process.env.TREND_CARRY_HARD_EXIT_GIVEBACK_PCT || 0.0045),
};
