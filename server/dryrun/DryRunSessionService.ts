import { DryRunEngine } from './DryRunEngine';
import { DryRunConfig, DryRunEventInput, DryRunEventLog, DryRunOrderBook, DryRunOrderRequest, DryRunReasonCode, DryRunStateSnapshot } from './types';
import { StrategyDecision, StrategyActionType, StrategyPositionState, StrategyRegime, StrategySignal, StrategySide } from '../types/strategy';
import { AlertService } from '../notifications/AlertService';
import { PerformanceCalculator, PerformanceMetrics } from '../metrics/PerformanceCalculator';
import { SessionStore } from './SessionStore';
import { LimitOrderStrategy, LimitStrategyMode } from './LimitOrderStrategy';
import { DryRunLogEvent, DryRunOrderflowMetrics, DryRunTradeLogger } from './DryRunTradeLogger';
import { FlipGovernor } from './FlipGovernor';
import { WinnerManager, WinnerState } from './WinnerManager';
import { AddOnManager } from './AddOnManager';
import { DryRunClock } from './DryRunClock';
import { MaterializedSymbolCapitalConfig, SymbolCapitalConfig, materializeSymbolCapitalConfigs, normalizeSymbolCapitalConfigs } from '../types/capital';
import path from 'path';

export interface DryRunSessionStartInput {
  symbols?: string[];
  symbol?: string;
  runId?: string;
  sharedWalletStartUsdt?: number;
  symbolConfigs?: SymbolCapitalConfig[];
  startupMode?: 'WAIT_MICRO_WARMUP';
  walletBalanceStartUsdt?: number;
  initialMarginUsdt?: number;
  leverage?: number;
  takerFeeRate?: number;
  makerFeeRate?: number;
  maintenanceMarginRate?: number;
  fundingRate?: number;
  fundingRates?: Record<string, number>;
  fundingIntervalMs?: number;
  heartbeatIntervalMs?: number;
  debugAggressiveEntry?: boolean;
}

export interface DryRunConsoleLog {
  seq: number;
  timestampMs: number;
  symbol: string | null;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

export interface DryRunSymbolStatus {
  symbol: string;
  capital: {
    configuredReserveUsdt: number;
    effectiveReserveUsdt: number;
    initialMarginUsdt: number;
    leverage: number;
    reserveScale: number;
  };
  warmup: {
    bootstrapDone: boolean;
    bootstrapBars1m: number;
    htfReady: boolean;
    orderflow1mReady: boolean;
    orderflow5mReady: boolean;
    orderflow15mReady: boolean;
    tradeReady: boolean;
    addonReady: boolean;
    vetoReason: string | null;
  };
  trend: {
    state: 'UPTREND' | 'DOWNTREND' | 'PULLBACK_UP' | 'PULLBACK_DOWN' | 'RANGE' | 'EXHAUSTION_UP' | 'EXHAUSTION_DOWN';
    confidence: number;
    bias15m: 'UP' | 'DOWN' | 'NEUTRAL';
    veto1h: 'NONE' | 'UP' | 'DOWN' | 'EXHAUSTION';
  };
  metrics: {
    markPrice: number;
    totalEquity: number;
    walletBalance: number;
    unrealizedPnl: number;
    realizedPnl: number;
    feePaid: number;
    fundingPnl: number;
    marginHealth: number;
  };
  performance?: PerformanceMetrics;
  risk?: {
    winStreak: number;
    lossStreak: number;
    dynamicLeverage: number;
    stopLossPrice: number | null;
    liquidationRisk?: {
      score: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'CRITICAL';
      timeToLiquidationMs: number | null;
      fundingRateImpact: number;
    };
  };
  position: {
    side: 'LONG' | 'SHORT';
    qty: number;
    notionalUsdt: number;
    entryPrice: number;
    peakPnlPct?: number;
    breakEvenPrice: number | null;
    markPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    netPnl: number;
    liqPrice: null;
  } | null;
  openLimitOrders: DryRunStateSnapshot['openLimitOrders'];
  lastEventTimestampMs: number;
  eventCount: number;
  warnings?: string[];
}

export interface DryRunSessionStatus {
  running: boolean;
  runId: string | null;
  symbols: string[];
  config: {
    sharedWalletStartUsdt: number;
    reserveScale: number;
    totalConfiguredReserveUsdt: number;
    totalEffectiveReserveUsdt: number;
    symbolConfigs: SymbolCapitalConfig[];
    sizing?: {
      legacyNotionalCap?: boolean;
      entrySplit?: number[];
      addMode?: 'SPLIT_OF_ENTRY' | 'FIXED_MARGIN';
      maxPositionNotional?: number | null;
    };
    leverage?: number;
    makerFeeRate: number;
    takerFeeRate: number;
    maintenanceMarginRate: number;
    fundingIntervalMs: number;
    heartbeatIntervalMs: number;
    startupMode?: 'WAIT_MICRO_WARMUP';
  } | null;
  summary: {
    totalEquity: number;
    walletBalance: number;
    unrealizedPnl: number;
    realizedPnl: number;
    feePaid: number;
    fundingPnl: number;
    marginHealth: number;
    performance?: PerformanceMetrics;
  };
  perSymbol: Record<string, DryRunSymbolStatus>;
  logTail: DryRunConsoleLog[];
  alphaDecay: Array<{
    signalType: string;
    avgValidityMs: number;
    alphaDecayHalfLife: number;
    optimalEntryWindow: [number, number];
    optimalExitWindow: [number, number];
    sampleCount: number;
  }>;
}

type PendingEntryContext = {
  reason: 'STRATEGY_SIGNAL' | 'MANUAL_TEST' | 'UNKNOWN';
  signalType: string | null;
  signalScore: number | null;
  candidate: StrategySignal['candidate'] | null;
  orderflow: DryRunOrderflowMetrics;
  boost?: StrategySignal['boost'];
  market?: StrategySignal['market'];
  timestampMs: number;
  leverage: number | null;
};

type ActiveTrade = {
  tradeId: string;
  side: 'LONG' | 'SHORT';
  entryTimeMs: number;
  entryPrice: number;
  qty: number;
  maxQtySeen: number;
  notional: number;
  marginUsed: number;
  maxMarginUsed: number;
  leverage: number;
  pnlRealized: number;
  feeAcc: number;
  fundingAcc: number;
  signalType: string | null;
  signalScore: number | null;
  candidate: StrategySignal['candidate'] | null;
  orderflow: DryRunOrderflowMetrics;
};

type SignalSnapshot = {
  side: 'LONG' | 'SHORT';
  signalType: string;
  score: number;
  candidate: StrategySignal['candidate'] | null;
  orderflow: DryRunOrderflowMetrics;
  boost?: StrategySignal['boost'];
  market?: StrategySignal['market'];
  timestampMs: number;
};

type PendingFlipEntry = {
  side: 'BUY' | 'SELL';
  signalType: string;
  signalScore: number;
  candidate: StrategySignal['candidate'] | null;
  orderflow: DryRunOrderflowMetrics;
  boost?: StrategySignal['boost'];
  market?: StrategySignal['market'];
  timestampMs: number;
  leverage: number | null;
};

type AddOnState = {
  count: number;
  lastAddOnTs: number;
  pendingClientOrderId: string | null;
  pendingAddonIndex: number | null;
  pendingAttempt: number;
  filledClientOrderIds: Set<string>;
};

type WorkingOrderLogState = Map<string, string>;

type SymbolSession = {
  symbol: string;
  capital: MaterializedSymbolCapitalConfig;
  startedAtMs: number;
  warmup: {
    bootstrapDone: boolean;
    bootstrapBars1m: number;
    htfReady: boolean;
    orderflow1mReady: boolean;
    orderflow5mReady: boolean;
    orderflow15mReady: boolean;
    tradeReady: boolean;
    addonReady: boolean;
    vetoReason: string | null;
  };
  trend: {
    state: 'UPTREND' | 'DOWNTREND' | 'PULLBACK_UP' | 'PULLBACK_DOWN' | 'RANGE' | 'EXHAUSTION_UP' | 'EXHAUSTION_DOWN';
    confidence: number;
    bias15m: 'UP' | 'DOWN' | 'NEUTRAL';
    veto1h: 'NONE' | 'UP' | 'DOWN' | 'EXHAUSTION';
  };
  engine: DryRunEngine;
  fundingRate: number;
  lastEventTimestampMs: number;
  lastState: DryRunStateSnapshot;
  lastOrderBook: DryRunOrderBook;
  latestMarkPrice: number;
  lastMarkPrice: number;
  atr: number;
  avgAtr: number;
  priceHistory: number[];
  obi: number;
  volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH';
  winStreak: number;
  lossStreak: number;
  dynamicLeverage: number;
  stopLossPrice: number | null;
  winnerState: WinnerState | null;
  flipGovernor: FlipGovernor;
  flipState: { partialReduced: boolean; lastPartialReduceTs: number };
  addOnState: AddOnState;
  lastEntryOrAddOnTs: number;
  lastSignal: SignalSnapshot | null;
  pendingFlipEntry: PendingFlipEntry | null;
  spreadBreachCount: number;
  performance: PerformanceCalculator;
  activeSignal: { type: string; timestampMs: number } | null;
  lastEntryEventTs: number;
  lastHeartbeatTs: number;
  lastDataLogTs: number;
  lastEmptyBookLogTs: number;
  lastPerfTs: number;
  realizedPnl: number;
  feePaid: number;
  fundingPnl: number;
  eventCount: number;
  manualOrders: DryRunOrderRequest[];
  logTail: DryRunEventLog[];
  pendingEntry: PendingEntryContext | null;
  pendingExitReason: string | null;
  pendingCloseAction: { kind: 'EXIT' | 'REVERSAL'; side: 'LONG' | 'SHORT'; expiresAtMs: number } | null;
  tradeSeq: number;
  currentTrade: ActiveTrade | null;
  peakUnrealizedPnlPct: number;
  lastSnapshotLogTs: number;
  lastWinnerSignalLogTs: number;
  aiEntryCancelStreak: number;
  aiEntryCooldownUntilMs: number;
  lastAiEntryCooldownLogTs: number;
  lastExitOrderTs: number;
  lastReduceOrderTs: number;
  workingOrderLogState: WorkingOrderLogState;
};

type AIIntentMetadata = {
  entryStyle?: 'LIMIT' | 'MARKET_SMALL' | 'HYBRID';
  urgency?: 'LOW' | 'MED' | 'HIGH';
  maxAdds?: number;
  addRule?: 'WINNER_ONLY' | 'TREND_INTACT' | 'NEVER';
  addTrigger?: {
    minUnrealizedPnlPct?: number;
    trendIntact?: boolean;
    obiSupportMin?: number;
    deltaConfirm?: boolean;
  };
  reducePct?: number | null;
};

type AIActionMetadata = {
  plan?: AIIntentMetadata;
  incrementalRiskCapPct?: number;
  strictThreeMMode?: boolean;
  strictEntryFullNotional?: boolean;
  strictAddPct?: number;
  maxExposureMultiplier?: number;
  allowReduceBelowNotional?: boolean;
  maxPositionNotional?: number;
  maxExposureNotional?: number;
  governorReasons?: string[];
};

const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;
const DEFAULT_FUNDING_RATE = 0;
const DEFAULT_FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_EVENT_INTERVAL_MS = Number(process.env.DRY_RUN_EVENT_INTERVAL_MS || 250);
const DEFAULT_ORDERBOOK_DEPTH = Number(process.env.DRY_RUN_ORDERBOOK_DEPTH || 20);
const DEFAULT_ENTRY_COOLDOWN_MS = Number(process.env.DRY_RUN_ENTRY_COOLDOWN_MS || 5000);
const DEFAULT_HEARTBEAT_INTERVAL_MS = Number(process.env.DRY_RUN_HEARTBEAT_INTERVAL_MS || 10_000);
const CONSOLE_LOG_TAIL_LIMIT = Number(process.env.DRY_RUN_CONSOLE_TAIL_LIMIT || 500);
const ENGINE_LOG_TAIL_LIMIT = Number(process.env.DRY_RUN_ENGINE_TAIL_LIMIT || 120);
const DEFAULT_WIN_STREAK_MULT = Number(process.env.DRY_RUN_WIN_STREAK_MULT || 0.06);
const DEFAULT_LOSS_STREAK_DIV = Number(process.env.DRY_RUN_LOSS_STREAK_DIV || 0.25);
const DEFAULT_MARTINGALE_FACTOR = Number(process.env.DRY_RUN_MARTINGALE_FACTOR || 1.2);
const DEFAULT_MARTINGALE_MAX = Number(process.env.DRY_RUN_MARTINGALE_MAX || 3);
const DEFAULT_MAX_NOTIONAL = Number(process.env.DRY_RUN_MAX_NOTIONAL_USDT || 5000);
const DEFAULT_STOP_ATR_MULT = Number(process.env.DRY_RUN_STOP_ATR_MULT || 1.4);
const DEFAULT_STOP_MIN_DIST = Number(process.env.DRY_RUN_STOP_MIN_DIST || 0.5);
const DEFAULT_ATR_WINDOW = Number(process.env.DRY_RUN_ATR_WINDOW || 14);
const DEFAULT_LARGE_LOSS_ALERT = Number(process.env.DRY_RUN_LARGE_LOSS_USDT || 500);
const DEFAULT_LIMIT_STRATEGY = String(process.env.DRY_RUN_LIMIT_STRATEGY || 'MARKET').toUpperCase();
const DEFAULT_PERF_SAMPLE_MS = Number(process.env.DRY_RUN_PERF_SAMPLE_MS || 2000);
const DEFAULT_TRADE_LOG_ENABLED = String(process.env.DRY_RUN_TRADE_LOGS || 'true').toLowerCase();
const DEFAULT_SERVER_ROOT = path.basename(process.cwd()).toLowerCase() === 'server'
  ? process.cwd()
  : path.join(process.cwd(), 'server');
const DEFAULT_TRADE_LOG_DIR = String(process.env.DRY_RUN_LOG_DIR || path.join(DEFAULT_SERVER_ROOT, 'logs', 'dryrun'));
const DEFAULT_TRADE_LOG_QUEUE = Number(process.env.DRY_RUN_LOG_QUEUE_LIMIT || 10000);
const DEFAULT_TRADE_LOG_DROP = Number(process.env.DRY_RUN_LOG_DROP_THRESHOLD || 2000);
const DEFAULT_SNAPSHOT_LOG_MS = Number(process.env.DRY_RUN_SNAPSHOT_LOG_MS || 30_000);
const DEFAULT_MAKER_FEE_BPS = clampNumber(process.env.MAKER_FEE_BPS, 2, 0, 50);
const DEFAULT_TAKER_FEE_BPS = clampNumber(process.env.TAKER_FEE_BPS, 4, 0, 50);
const DEFAULT_MAKER_FEE_RATE = DEFAULT_MAKER_FEE_BPS / 10000;
const DEFAULT_TAKER_FEE_RATE = DEFAULT_TAKER_FEE_BPS / 10000;
const DEFAULT_ENTRY_SIGNAL_MIN = clampNumber(process.env.ENTRY_SIGNAL_MIN, 50, 0, 100);
const DEFAULT_MIN_HOLD_MS = clampNumber(process.env.MIN_HOLD_MS, 90_000, 0, 600_000);
const DEFAULT_FLIP_DEADBAND_PCT = clampNumber(process.env.FLIP_DEADBAND_PCT, 0.003, 0, 0.05);
const DEFAULT_FLIP_HYSTERESIS = clampNumber(process.env.FLIP_HYSTERESIS, 0.15, 0, 1);
const DEFAULT_FLIP_CONFIRM_TICKS = Math.max(1, Math.trunc(clampNumber(process.env.FLIP_CONFIRM_TICKS, 3, 1, 20)));
const DEFAULT_ADDON_MIN_UPNL_PCT = clampNumber(process.env.ADDON_MIN_UPNL_PCT, 0.0025, 0, 0.05);
const DEFAULT_ADDON_SIGNAL_MIN = clampNumber(process.env.ADDON_SIGNAL_MIN, 60, 0, 100);
const DEFAULT_ADDON_COOLDOWN_MS = clampNumber(process.env.ADDON_COOLDOWN_MS, 60_000, 0, 600_000);
const DEFAULT_ADDON_MAX_COUNT = Math.max(0, Math.trunc(clampNumber(process.env.ADDON_MAX_COUNT, 3, 0, 10)));
const DEFAULT_ADDON_TTL_MS = Math.max(1000, Math.trunc(clampNumber(process.env.ADDON_TTL_MS, 15_000, 1000, 120_000)));
const DEFAULT_ADDON_REPRICE_MAX = Math.max(0, Math.trunc(clampNumber(process.env.ADDON_REPRICE_MAX, 2, 0, 5)));
const DEFAULT_TRAIL_ATR_MULT = clampNumber(process.env.TRAIL_ATR_MULT, 3.8, 0.5, 10);
const DEFAULT_TRAIL_ACTIVATE_R = clampNumber(process.env.TRAIL_ACTIVATE_R, 3.0, 0.5, 10);
const DEFAULT_TRAIL_CONFIRM_TICKS = Math.max(1, Math.trunc(clampNumber(process.env.TRAIL_CONFIRM_TICKS, 4, 1, 20)));
const DEFAULT_TRAIL_MIN_HOLD_MS = Math.max(0, Math.trunc(clampNumber(process.env.TRAIL_MIN_HOLD_MS, 180_000, 0, 1_800_000)));
const DEFAULT_MAX_SPREAD_PCT = normalizePercentLikeRatio(process.env.MAX_SPREAD_PCT, 0.0008, 0, 0.01);
const DEFAULT_MAX_MARGIN_USAGE_PCT = clampNumber(process.env.MAX_MARGIN_USAGE_PCT, 0.85, 0.3, 0.98);
const DEFAULT_MAX_POSITION_NOTIONAL = clampNumber(process.env.MAX_POSITION_NOTIONAL_USDT, DEFAULT_MAX_NOTIONAL, 10, 10_000_000);
const DEFAULT_DAILY_LOSS_LOCK_PCT = clampNumber(process.env.DAILY_LOSS_LOCK_PCT, 0.05, 0.005, 0.5);
const DEFAULT_DUST_MIN_NOTIONAL_USDT = clampNumber(process.env.DUST_MIN_NOTIONAL_USDT, 5, 0.1, 1_000);
const DEFAULT_DUST_MIN_QTY = clampNumber(process.env.DUST_MIN_QTY, 0.000001, 0.0000001, 0.01);
const DEFAULT_MIN_REDUCE_NOTIONAL_USDT = clampNumber(process.env.MIN_REDUCE_NOTIONAL_USDT, 15, 0.1, 1_000);
const DEFAULT_STRAT_ENTRY_CANCEL_STREAK_TRIGGER = Math.max(1, Math.trunc(clampNumber(process.env.STRAT_ENTRY_CANCEL_STREAK_TRIGGER, 2, 1, 10)));
const DEFAULT_STRAT_ENTRY_CANCEL_BASE_COOLDOWN_MS = Math.max(1000, Math.trunc(clampNumber(process.env.STRAT_ENTRY_CANCEL_BASE_COOLDOWN_MS, 15_000, 1000, 300_000)));
const DEFAULT_STRAT_ENTRY_CANCEL_MAX_COOLDOWN_MS = Math.max(
  DEFAULT_STRAT_ENTRY_CANCEL_BASE_COOLDOWN_MS,
  Math.trunc(clampNumber(process.env.STRAT_ENTRY_CANCEL_MAX_COOLDOWN_MS, 120_000, DEFAULT_STRAT_ENTRY_CANCEL_BASE_COOLDOWN_MS, 900_000))
);
const DEFAULT_STRAT_ENTRY_CANCEL_BACKOFF_MULT = clampNumber(process.env.STRAT_ENTRY_CANCEL_BACKOFF_MULT, 1.75, 1, 4);
const DEFAULT_STRAT_ENTRY_MIN_INTERVAL_MS = Math.max(
  0,
  Math.trunc(clampNumber(process.env.STRAT_ENTRY_MIN_INTERVAL_MS, 3000, 0, 60_000))
);
const DEFAULT_STRAT_EXIT_MIN_INTERVAL_MS = Math.max(
  0,
  Math.trunc(clampNumber(process.env.STRAT_EXIT_MIN_INTERVAL_MS, 4000, 0, 60_000))
);
const DEFAULT_PENDING_CLOSE_GUARD_MS = Math.max(
  1000,
  Math.trunc(clampNumber(process.env.STRAT_PENDING_CLOSE_GUARD_MS, 12_000, 1000, 60_000))
);
const DEFAULT_STRAT_REDUCE_MIN_INTERVAL_MS = Math.max(
  0,
  Math.trunc(clampNumber(process.env.STRAT_REDUCE_MIN_INTERVAL_MS, 180_000, 0, 600_000))
);
const DEFAULT_STRAT_SOFT_REDUCE_FRESH_PROTECT_MS = Math.max(
  0,
  Math.trunc(clampNumber(process.env.STRAT_SOFT_REDUCE_FRESH_PROTECT_MS, 180_000, 0, 600_000))
);
const DEFAULT_MAX_BOOK_MARK_DEVIATION_PCT = normalizePercentLikeRatio(
  process.env.MAX_BOOK_MARK_DEVIATION_PCT,
  0.0015,
  0,
  0.02
);
const DEFAULT_ENTRY_MIN_FILL_RATIO = clampNumber(process.env.LIMIT_MIN_FILL_RATIO, 0.35, 0, 1);

function parseLimitStrategy(input: string): LimitStrategyMode {
  switch (input) {
    case 'PASSIVE':
      return 'PASSIVE';
    case 'SPLIT':
      return 'SPLIT';
    case 'AGGRESSIVE':
      return 'AGGRESSIVE';
    default:
      return 'MARKET';
  }
}

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePercentLikeRatio(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = n > 0.02 ? (n / 100) : n;
  return Math.max(min, Math.min(max, normalized));
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

function roundTo(value: number, decimals: number): number {
  const m = Math.pow(10, Math.max(0, decimals));
  return Math.round(value * m) / m;
}

function normalizeSymbols(input: { symbols?: string[]; symbol?: string }): string[] {
  const out: string[] = [];
  if (Array.isArray(input.symbols)) {
    for (const raw of input.symbols) {
      const s = normalizeSymbol(String(raw || ''));
      if (s && !out.includes(s)) out.push(s);
    }
  }
  if (out.length === 0 && input.symbol) {
    const s = normalizeSymbol(input.symbol);
    if (s) out.push(s);
  }
  return out;
}

function defaultWarmupState(): SymbolSession['warmup'] {
  return {
    bootstrapDone: false,
    bootstrapBars1m: 0,
    htfReady: false,
    orderflow1mReady: false,
    orderflow5mReady: false,
    orderflow15mReady: false,
    tradeReady: false,
    addonReady: false,
    vetoReason: 'BOOTSTRAP_NOT_DONE',
  };
}

function defaultTrendState(): SymbolSession['trend'] {
  return {
    state: 'RANGE',
    confidence: 0,
    bias15m: 'NEUTRAL',
    veto1h: 'NONE',
  };
}

export class DryRunSessionService {
  private running = false;
  private runId: string | null = null;
  private runCounter = 0;
  private consoleSeq = 0;

  private config: DryRunSessionStatus['config'] = null;
  private symbols: string[] = [];
  private sessions = new Map<string, SymbolSession>();
  private logTail: DryRunConsoleLog[] = [];
  private limitStrategy: LimitOrderStrategy;
  private readonly alertService?: AlertService;
  private readonly sessionStore: SessionStore;
  private readonly tradeLogger?: DryRunTradeLogger;
  private readonly tradeLogEnabled: boolean;
  private readonly clock = new DryRunClock();
  private readonly winnerManager: WinnerManager;
  private readonly addOnManager: AddOnManager;

  constructor(alertService?: AlertService) {
    this.limitStrategy = new LimitOrderStrategy({
      mode: parseLimitStrategy(DEFAULT_LIMIT_STRATEGY),
      splitLevels: 3,
      passiveOffsetBps: 2,
      maxSlices: 4,
    });
    this.winnerManager = new WinnerManager({
      trailAtrMult: DEFAULT_TRAIL_ATR_MULT,
      rAtrMult: DEFAULT_STOP_ATR_MULT,
      minRDistance: DEFAULT_STOP_MIN_DIST,
      trailActivateR: DEFAULT_TRAIL_ACTIVATE_R,
      trailConfirmTicks: DEFAULT_TRAIL_CONFIRM_TICKS,
      minHoldMs: DEFAULT_TRAIL_MIN_HOLD_MS,
    });
    this.addOnManager = new AddOnManager({
      minUnrealizedPnlPct: DEFAULT_ADDON_MIN_UPNL_PCT,
      signalMin: DEFAULT_ADDON_SIGNAL_MIN,
      cooldownMs: DEFAULT_ADDON_COOLDOWN_MS,
      maxCount: DEFAULT_ADDON_MAX_COUNT,
      ttlMs: DEFAULT_ADDON_TTL_MS,
      maxSpreadPct: DEFAULT_MAX_SPREAD_PCT,
      maxNotional: DEFAULT_MAX_NOTIONAL,
    });
    this.alertService = alertService;
    this.sessionStore = new SessionStore();
    this.tradeLogEnabled = !['false', '0', 'no'].includes(DEFAULT_TRADE_LOG_ENABLED);
    if (this.tradeLogEnabled) {
      this.tradeLogger = new DryRunTradeLogger({
        dir: DEFAULT_TRADE_LOG_DIR,
        queueLimit: finiteOr(DEFAULT_TRADE_LOG_QUEUE, 10000),
        dropHaltThreshold: finiteOr(DEFAULT_TRADE_LOG_DROP, 2000),
        onDropSpike: (count) => {
          this.addConsoleLog('WARN', null, `Dry Run log backlog dropped ${count} events`, this.clock.now());
        },
      });
    }
  }

  start(input: DryRunSessionStartInput): DryRunSessionStatus {
    const symbols = normalizeSymbols(input);
    if (symbols.length === 0) {
      throw new Error('symbols_required');
    }

    const sharedWalletStartUsdt = finiteOr(input.sharedWalletStartUsdt, finiteOr(input.walletBalanceStartUsdt, 5000));
    const initialMarginUsdt = finiteOr(input.initialMarginUsdt, 200);
    const leverage = finiteOr(input.leverage, 10);

    if (!(sharedWalletStartUsdt > 0)) throw new Error('wallet_balance_start_must_be_positive');
    if (!(initialMarginUsdt > 0)) throw new Error('initial_margin_must_be_positive');
    if (!(leverage > 0)) throw new Error('leverage_must_be_positive');

    this.runCounter += 1;
    const runIdBase = String(input.runId || `dryrun-${this.runCounter}`);
    const makerFeeRate = finiteOr(input.makerFeeRate, DEFAULT_MAKER_FEE_RATE);
    const takerFeeRate = finiteOr(input.takerFeeRate, DEFAULT_TAKER_FEE_RATE);
    const maintenanceMarginRate = finiteOr(input.maintenanceMarginRate, DEFAULT_MAINTENANCE_MARGIN_RATE);
    const fundingIntervalMs = Math.max(1, Math.trunc(finiteOr(input.fundingIntervalMs, DEFAULT_FUNDING_INTERVAL_MS)));
    const heartbeatIntervalMs = Math.max(1_000, Math.trunc(finiteOr(input.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS)));
    const startupMode = input.startupMode || 'WAIT_MICRO_WARMUP';
    const normalizedCapital = materializeSymbolCapitalConfigs({
      configs: normalizeSymbolCapitalConfigs({
        symbols,
        symbolConfigs: input.symbolConfigs,
        defaultInitialMarginUsdt: initialMarginUsdt,
        defaultLeverage: leverage,
        defaultReserveUsdt: sharedWalletStartUsdt / Math.max(1, symbols.length),
      }),
      totalWalletUsdt: sharedWalletStartUsdt,
    });

    this.running = true;
    this.runId = runIdBase;
    this.symbols = normalizedCapital.symbolConfigs.map((row) => row.symbol);
    this.sessions.clear();
    this.logTail = [];
    this.consoleSeq = 0;

    this.config = {
      sharedWalletStartUsdt,
      reserveScale: normalizedCapital.reserveScale,
      totalConfiguredReserveUsdt: normalizedCapital.totalConfiguredReserveUsdt,
      totalEffectiveReserveUsdt: normalizedCapital.totalEffectiveReserveUsdt,
      symbolConfigs: normalizedCapital.symbolConfigs.map((row) => ({
        symbol: row.symbol,
        enabled: row.enabled,
        walletReserveUsdt: row.walletReserveUsdt,
        initialMarginUsdt: row.initialMarginUsdt,
        leverage: row.leverage,
      })),
      leverage,
      makerFeeRate,
      takerFeeRate,
      maintenanceMarginRate,
      fundingIntervalMs,
      heartbeatIntervalMs,
      startupMode,
    };

    const startedAtMs = this.clock.now();

    for (const capital of normalizedCapital.symbolConfigs) {
      const symbol = capital.symbol;
      const fundingRate = Number.isFinite(input.fundingRates?.[symbol] as number)
        ? Number(input.fundingRates?.[symbol])
        : finiteOr(input.fundingRate, DEFAULT_FUNDING_RATE);

      const cfg: DryRunConfig = {
        runId: `${runIdBase}-${symbol}`,
        walletBalanceStartUsdt: capital.effectiveReserveUsdt > 0 ? capital.effectiveReserveUsdt : capital.walletReserveUsdt,
        initialMarginUsdt: capital.effectiveInitialMarginUsdt > 0 ? capital.effectiveInitialMarginUsdt : capital.initialMarginUsdt,
        leverage: capital.leverage,
        makerFeeRate,
        takerFeeRate,
        maintenanceMarginRate,
        fundingRate,
        fundingIntervalMs,
        proxy: {
          mode: 'backend-proxy',
          restBaseUrl: 'https://fapi.binance.com',
          marketWsBaseUrl: 'wss://fstream.binance.com/stream',
        },
      };

      const engine = new DryRunEngine(cfg);
      const lastState = engine.getStateSnapshot();
      this.sessions.set(symbol, {
        symbol,
        capital,
        startedAtMs,
        warmup: defaultWarmupState(),
        trend: defaultTrendState(),
        engine,
        fundingRate,
        lastEventTimestampMs: 0,
        lastState,
        lastOrderBook: { bids: [], asks: [] },
        latestMarkPrice: 0,
        lastMarkPrice: 0,
        atr: 0,
        avgAtr: 0,
        priceHistory: [],
        obi: 0,
        volatilityRegime: 'MEDIUM',
        winStreak: 0,
        lossStreak: 0,
        dynamicLeverage: capital.leverage,
        stopLossPrice: null,
        winnerState: null,
        flipGovernor: new FlipGovernor(),
        flipState: { partialReduced: false, lastPartialReduceTs: 0 },
        addOnState: {
          count: 0,
          lastAddOnTs: 0,
          pendingClientOrderId: null,
          pendingAddonIndex: null,
          pendingAttempt: 0,
          filledClientOrderIds: new Set<string>(),
        },
        lastEntryOrAddOnTs: 0,
        lastSignal: null,
        pendingFlipEntry: null,
        spreadBreachCount: 0,
        performance: new PerformanceCalculator(cfg.walletBalanceStartUsdt),
        activeSignal: null,
        lastEntryEventTs: 0,
        lastHeartbeatTs: 0,
        lastDataLogTs: 0,
        lastEmptyBookLogTs: 0,
        lastPerfTs: 0,
        realizedPnl: 0,
        feePaid: 0,
        fundingPnl: 0,
        eventCount: 0,
        manualOrders: [],
        logTail: [],
        pendingEntry: null,
        pendingExitReason: null,
        pendingCloseAction: null,
        tradeSeq: 0,
        currentTrade: null,
        peakUnrealizedPnlPct: 0,
        lastSnapshotLogTs: 0,
        lastWinnerSignalLogTs: 0,
        aiEntryCancelStreak: 0,
        aiEntryCooldownUntilMs: 0,
        lastAiEntryCooldownLogTs: 0,
        lastExitOrderTs: 0,
        lastReduceOrderTs: 0,
        workingOrderLogState: new Map<string, string>(),
      });
    }

    this.addConsoleLog('INFO', null, `Dry Run Initialized with pairs: [${this.symbols.join(', ')}]`, 0);
    for (const symbol of this.symbols) {
      this.addConsoleLog('INFO', symbol, `Session ready. Funding rate=${this.sessions.get(symbol)?.fundingRate ?? 0}`, 0);
    }

    return this.getStatus();
  }

  stop(): DryRunSessionStatus {
    if (this.running) {
      this.addConsoleLog('INFO', null, 'Dry Run stopped by user.', 0);
    }
    this.running = false;
    return this.getStatus();
  }

  reset(): DryRunSessionStatus {
    this.running = false;
    this.runId = null;
    this.symbols = [];
    this.config = null;
    this.sessions.clear();
    this.logTail = [];
    this.consoleSeq = 0;
    return this.getStatus();
  }

  async saveSession(sessionId?: string): Promise<void> {
    if (!this.runId) {
      throw new Error('dry_run_not_initialized');
    }
    const id = sessionId || this.runId;
    const payload = {
      runId: this.runId,
      config: this.config,
      symbols: this.symbols,
      status: this.getStatus(),
      sessions: Array.from(this.sessions.values()).map((session) => ({
        symbol: session.symbol,
        capital: session.capital,
        startedAtMs: session.startedAtMs,
        warmup: session.warmup,
        trend: session.trend,
        lastState: session.lastState,
        latestMarkPrice: session.latestMarkPrice,
        lastMarkPrice: session.lastMarkPrice,
        atr: session.atr,
        avgAtr: session.avgAtr,
        priceHistory: session.priceHistory,
        obi: session.obi,
        volatilityRegime: session.volatilityRegime,
        winStreak: session.winStreak,
        lossStreak: session.lossStreak,
        dynamicLeverage: session.dynamicLeverage,
        stopLossPrice: session.stopLossPrice,
        activeSignal: session.activeSignal,
        performance: session.performance.getMetrics(),
        realizedPnl: session.realizedPnl,
        feePaid: session.feePaid,
        fundingPnl: session.fundingPnl,
        eventCount: session.eventCount,
        lastEventTimestampMs: session.lastEventTimestampMs,
        peakUnrealizedPnlPct: session.peakUnrealizedPnlPct,
      })),
    };
    await this.sessionStore.save(id, payload);
  }

  async loadSession(sessionId: string): Promise<DryRunSessionStatus> {
    const stored = await this.sessionStore.load(sessionId);
    if (!stored) {
      throw new Error('dry_run_session_not_found');
    }
    const payload: any = stored.payload;
    if (!payload?.config || !Array.isArray(payload?.symbols)) {
      throw new Error('dry_run_session_invalid');
    }

    this.running = false;
    const config = payload.config as NonNullable<DryRunSessionStatus['config']>;
    this.runId = payload.runId || sessionId;
    this.symbols = [...payload.symbols];
    this.config = config;
    this.sessions.clear();

    for (const symbol of this.symbols) {
      const sessionSnapshot = payload.sessions?.find((s: any) => s.symbol === symbol);
      const snapshotCapital = sessionSnapshot?.capital;
      const fallbackCapital = {
        symbol,
        enabled: true,
        walletReserveUsdt: Number(snapshotCapital?.walletReserveUsdt || snapshotCapital?.configuredReserveUsdt || config.sharedWalletStartUsdt / Math.max(1, this.symbols.length)),
        initialMarginUsdt: Number(snapshotCapital?.initialMarginUsdt || config.symbolConfigs?.find((row) => row.symbol === symbol)?.initialMarginUsdt || 0),
        leverage: Number(snapshotCapital?.leverage || config.symbolConfigs?.find((row) => row.symbol === symbol)?.leverage || config.leverage || 1),
      };
      const capital = materializeSymbolCapitalConfigs({
        configs: [fallbackCapital],
        totalWalletUsdt: Number(snapshotCapital?.effectiveReserveUsdt || fallbackCapital.walletReserveUsdt || 0),
      }).symbolConfigs[0];
      const cfg: DryRunConfig = {
        runId: `${this.runId}-${symbol}`,
        walletBalanceStartUsdt: capital.effectiveReserveUsdt > 0 ? capital.effectiveReserveUsdt : capital.walletReserveUsdt,
        initialMarginUsdt: capital.effectiveInitialMarginUsdt > 0 ? capital.effectiveInitialMarginUsdt : capital.initialMarginUsdt,
        leverage: capital.leverage,
        makerFeeRate: Number.isFinite(config.makerFeeRate) ? config.makerFeeRate : DEFAULT_MAKER_FEE_RATE,
        takerFeeRate: config.takerFeeRate,
        maintenanceMarginRate: config.maintenanceMarginRate,
        fundingRate: 0,
        fundingIntervalMs: config.fundingIntervalMs,
        proxy: {
          mode: 'backend-proxy',
          restBaseUrl: 'https://fapi.binance.com',
          marketWsBaseUrl: 'wss://fstream.binance.com/stream',
        },
      };
      const engine = new DryRunEngine(cfg);
      if (sessionSnapshot?.lastState) {
        engine.restoreState(sessionSnapshot.lastState);
      }
      const perf = new PerformanceCalculator(cfg.walletBalanceStartUsdt);
      if (sessionSnapshot?.performance) {
        perf.restore(sessionSnapshot.performance);
      }
      this.sessions.set(symbol, {
        symbol,
        capital,
        startedAtMs: Number(sessionSnapshot?.startedAtMs || 0),
        warmup: sessionSnapshot?.warmup || defaultWarmupState(),
        trend: sessionSnapshot?.trend || defaultTrendState(),
        engine,
        fundingRate: 0,
        lastEventTimestampMs: sessionSnapshot?.lastEventTimestampMs || 0,
        lastState: sessionSnapshot?.lastState || engine.getStateSnapshot(),
        lastOrderBook: { bids: [], asks: [] },
        latestMarkPrice: sessionSnapshot?.latestMarkPrice || 0,
        lastMarkPrice: sessionSnapshot?.lastMarkPrice || 0,
        atr: sessionSnapshot?.atr || 0,
        avgAtr: sessionSnapshot?.avgAtr || 0,
        priceHistory: sessionSnapshot?.priceHistory || [],
        obi: sessionSnapshot?.obi || 0,
        volatilityRegime: sessionSnapshot?.volatilityRegime || 'MEDIUM',
        winStreak: sessionSnapshot?.winStreak || 0,
        lossStreak: sessionSnapshot?.lossStreak || 0,
        dynamicLeverage: sessionSnapshot?.dynamicLeverage || capital.leverage,
        stopLossPrice: sessionSnapshot?.stopLossPrice ?? null,
        winnerState: null,
        flipGovernor: new FlipGovernor(),
        flipState: { partialReduced: false, lastPartialReduceTs: 0 },
        addOnState: {
          count: 0,
          lastAddOnTs: 0,
          pendingClientOrderId: null,
          pendingAddonIndex: null,
          pendingAttempt: 0,
          filledClientOrderIds: new Set<string>(),
        },
        lastEntryOrAddOnTs: 0,
        lastSignal: null,
        pendingFlipEntry: null,
        spreadBreachCount: 0,
        performance: perf,
        activeSignal: sessionSnapshot?.activeSignal ?? null,
        lastEntryEventTs: 0,
        lastHeartbeatTs: 0,
        lastDataLogTs: 0,
        lastEmptyBookLogTs: 0,
        lastPerfTs: 0,
        realizedPnl: sessionSnapshot?.realizedPnl || 0,
        feePaid: sessionSnapshot?.feePaid || 0,
        fundingPnl: sessionSnapshot?.fundingPnl || 0,
        eventCount: sessionSnapshot?.eventCount || 0,
        manualOrders: [],
        logTail: [],
        pendingEntry: null,
        pendingExitReason: null,
        pendingCloseAction: null,
        tradeSeq: 0,
        currentTrade: null,
        peakUnrealizedPnlPct: Number(sessionSnapshot?.peakUnrealizedPnlPct || 0),
        lastSnapshotLogTs: 0,
        lastWinnerSignalLogTs: 0,
        aiEntryCancelStreak: 0,
        aiEntryCooldownUntilMs: 0,
        lastAiEntryCooldownLogTs: 0,
        lastExitOrderTs: 0,
        lastReduceOrderTs: 0,
        workingOrderLogState: new Map<string, string>(),
      });
    }

    return this.getStatus();
  }

  async listSessions(): Promise<string[]> {
    return this.sessionStore.list();
  }

  getActiveSymbols(): string[] {
    return this.running ? [...this.symbols] : [];
  }

  isTrackingSymbol(symbol: string): boolean {
    const normalized = normalizeSymbol(symbol);
    return this.running && this.sessions.has(normalized);
  }

  updateRuntimeContext(symbol: string, input: {
    timestampMs?: number;
    bootstrapDone?: boolean;
    bootstrapBars1m?: number;
    htfReady?: boolean;
    tradeStreamActive?: boolean;
    spreadPct?: number | null;
    bookMarkDeviationPct?: number | null;
    trendState?: SymbolSession['trend']['state'];
    trendConfidence?: number;
    bias15m?: SymbolSession['trend']['bias15m'];
    veto1h?: SymbolSession['trend']['veto1h'];
    vetoReason?: string | null;
  }): void {
    const session = this.sessions.get(normalizeSymbol(symbol));
    if (!session) return;

    const nowMs = Number.isFinite(input.timestampMs as number) ? Number(input.timestampMs) : this.clock.now();
    const elapsedMs = Math.max(0, nowMs - Math.max(0, session.startedAtMs || nowMs));

    if (typeof input.bootstrapDone === 'boolean') session.warmup.bootstrapDone = input.bootstrapDone;
    if (Number.isFinite(input.bootstrapBars1m as number)) session.warmup.bootstrapBars1m = Math.max(0, Number(input.bootstrapBars1m));
    if (typeof input.htfReady === 'boolean') session.warmup.htfReady = input.htfReady;

    const tradeStreamActive = input.tradeStreamActive !== false;
    session.warmup.orderflow1mReady = tradeStreamActive && elapsedMs >= (2 * 60 * 1000);
    session.warmup.orderflow5mReady = tradeStreamActive && elapsedMs >= (5 * 60 * 1000);
    session.warmup.orderflow15mReady = tradeStreamActive && elapsedMs >= (15 * 60 * 1000);

    const effectiveMaxSpreadPct = this.getEffectiveMaxSpreadPct(session);
    const spreadTooWide = Number.isFinite(input.spreadPct as number) && Number(input.spreadPct) > effectiveMaxSpreadPct;
    const bookMarkDeviationHigh = Number.isFinite(input.bookMarkDeviationPct as number) && Number(input.bookMarkDeviationPct) > 0.5;

    let vetoReason = input.vetoReason ?? null;
    if (!session.warmup.bootstrapDone) vetoReason = 'BOOTSTRAP_NOT_DONE';
    else if (!session.warmup.htfReady) vetoReason = 'HTF_NOT_READY';
    else if (!session.warmup.orderflow15mReady) vetoReason = 'MICRO_WARMUP_NOT_DONE';
    else if (spreadTooWide) vetoReason = 'SPREAD_TOO_WIDE';
    else if (bookMarkDeviationHigh) vetoReason = 'BOOK_MARK_DEVIATION_HIGH';

    session.warmup.vetoReason = vetoReason;
    session.warmup.tradeReady = !vetoReason;
    session.warmup.addonReady = session.warmup.tradeReady && session.warmup.orderflow15mReady;

    if (input.trendState) session.trend.state = input.trendState;
    if (Number.isFinite(input.trendConfidence as number)) session.trend.confidence = clampNumber(Number(input.trendConfidence), 0, 0, 1);
    if (input.bias15m) session.trend.bias15m = input.bias15m;
    if (input.veto1h) session.trend.veto1h = input.veto1h;
  }

  private getSessionInitialMarginUsdt(session: SymbolSession): number {
    return Math.max(0, Number(session.capital.effectiveInitialMarginUsdt || session.capital.initialMarginUsdt || 0));
  }

  private getSessionConfiguredReserveUsdt(session: SymbolSession): number {
    return Math.max(0, Number(session.capital.walletReserveUsdt || 0));
  }

  private getSessionEffectiveReserveUsdt(session: SymbolSession): number {
    return Math.max(0, Number(session.capital.effectiveReserveUsdt || this.getSessionConfiguredReserveUsdt(session)));
  }

  private getSessionBaseLeverage(session: SymbolSession): number {
    return Math.max(1, Math.trunc(Number(session.capital.leverage || this.config?.leverage || 1)));
  }

  private getSessionStartEquityUsdt(session: SymbolSession): number {
    return this.getSessionEffectiveReserveUsdt(session);
  }

  submitManualTestOrder(symbol: string, side: 'BUY' | 'SELL' = 'BUY'): DryRunSessionStatus {
    const normalized = normalizeSymbol(symbol);
    const session = this.sessions.get(normalized);
    if (!this.running || !session || !this.config) {
      throw new Error('dry_run_not_running_for_symbol');
    }

    const referencePrice = session.latestMarkPrice > 0
      ? session.latestMarkPrice
      : (session.lastState.position?.entryPrice || 1);
    const qty = roundTo((this.getSessionInitialMarginUsdt(session) * this.getSessionBaseLeverage(session)) / referencePrice, 6);
    if (!(qty > 0)) {
      throw new Error('manual_test_qty_invalid');
    }

    const nowMs = this.clock.now();
    session.manualOrders.push({
      side,
      type: 'MARKET',
      qty,
      timeInForce: 'IOC',
      reduceOnly: false,
      reasonCode: 'ENTRY_MARKET',
      clientOrderId: `manual-${this.getRunId()}-${normalized}-${nowMs}`,
    });

    session.pendingEntry = {
      reason: 'MANUAL_TEST',
      signalType: null,
      signalScore: null,
      candidate: null,
      orderflow: this.buildOrderflowMetrics(undefined, session),
      market: this.buildMarketMetrics({ price: referencePrice }, session),
      timestampMs: nowMs,
      leverage: this.getSessionBaseLeverage(session),
    };

    this.addConsoleLog('INFO', normalized, `Manual test order queued: ${side} ${qty}`, session.lastEventTimestampMs);
    return this.getStatus();
  }

  submitStrategySignal(symbol: string, signal: StrategySignal, timestampMs?: number): void {
    if (!signal.signal) return;
    const side = signal.signal.includes('LONG') ? 'LONG' : signal.signal.includes('SHORT') ? 'SHORT' : null;
    if (!side) return;
    const ts = Number.isFinite(timestampMs as number) ? Number(timestampMs) : this.clock.now();
    const decision: StrategyDecision = {
      symbol,
      timestampMs: ts,
      regime: 'TR',
      dfs: signal.score,
      dfsPercentile: clampNumber(signal.score / 100, 0, 0, 1),
      volLevel: 0.5,
      gatePassed: true,
      reasons: ['ENTRY_TR'],
      actions: [{
        type: StrategyActionType.ENTRY,
        side: side as StrategySide,
        reason: 'ENTRY_TR',
        expectedPrice: signal.candidate?.entryPrice ?? signal.market?.price ?? null,
      }],
      log: {
        timestampMs: ts,
        symbol,
        regime: 'TR',
        gate: { passed: true, reason: null, details: {} },
        dfs: signal.score,
        dfsPercentile: clampNumber(signal.score / 100, 0, 0, 1),
        volLevel: 0.5,
        thresholds: { longEntry: 0.85, longBreak: 0.55, shortEntry: 0.15, shortBreak: 0.45 },
        reasons: ['ENTRY_TR'],
        actions: [{
          type: StrategyActionType.ENTRY,
          side: side as StrategySide,
          reason: 'ENTRY_TR',
          expectedPrice: signal.candidate?.entryPrice ?? signal.market?.price ?? null,
        }],
        stats: {},
      },
    };
    this.submitStrategyDecision(symbol, decision, ts);
  }

  submitStrategyDecision(symbol: string, decision: StrategyDecision, timestampMs?: number): DryRunOrderRequest[] {
    const normalized = normalizeSymbol(symbol);
    const session = this.sessions.get(normalized);
    if (!this.running || !session || !this.config) return [];

    const decisionTs = Number.isFinite(timestampMs as number) ? Number(timestampMs) : this.clock.now();
    this.clock.set(decisionTs);
    const createdOrders: DryRunOrderRequest[] = [];
    const queuedOrderSignatures = new Set<string>();

    const buildOrderSignature = (order: DryRunOrderRequest): string => {
      const price = Number.isFinite(order.price as number) ? Number(order.price) : 0;
      const ttlMs = Number.isFinite(order.ttlMs as number) ? Number(order.ttlMs) : 0;
      return [
        order.side,
        order.type,
        roundTo(Number(order.qty || 0), 6),
        roundTo(price, 6),
        order.timeInForce || '',
        order.reduceOnly ? '1' : '0',
        order.postOnly ? '1' : '0',
        order.reasonCode || '',
        ttlMs,
      ].join('|');
    };

    const queueOrder = (order: DryRunOrderRequest): boolean => {
      const signature = buildOrderSignature(order);
      if (queuedOrderSignatures.has(signature)) {
        return false;
      }
      queuedOrderSignatures.add(signature);
      session.manualOrders.push(order);
      createdOrders.push(order);
      return true;
    };

    const canQueueExitOrder = (positionSide: StrategySide): boolean => {
      if (positionSide !== 'LONG' && positionSide !== 'SHORT') {
        return false;
      }
      if (this.hasPendingCloseAction(session, positionSide, decisionTs)) {
        return false;
      }
      if (this.hasLiveReduceOnlyOrderForPosition(session, positionSide)) {
        return false;
      }
      if (
        DEFAULT_STRAT_EXIT_MIN_INTERVAL_MS > 0
        && session.lastExitOrderTs > 0
        && (decisionTs - session.lastExitOrderTs) < DEFAULT_STRAT_EXIT_MIN_INTERVAL_MS
      ) {
        return false;
      }
      return true;
    };

    const explicitExitActionIndexBySide = new Map<StrategySide, number>();
    for (let idx = 0; idx < decision.actions.length; idx += 1) {
      const candidate = decision.actions[idx];
      const side = candidate.side;
      if (candidate.type !== StrategyActionType.EXIT || (side !== 'LONG' && side !== 'SHORT')) {
        continue;
      }
      if (!explicitExitActionIndexBySide.has(side)) {
        explicitExitActionIndexBySide.set(side, idx);
      }
    }

    for (let actionIndex = 0; actionIndex < decision.actions.length; actionIndex += 1) {
      const action = decision.actions[actionIndex];
      if (action.type === StrategyActionType.NOOP) continue;

      const position = session.lastState.position;
      const actionSide = action.side || null;
      const desiredOrderSide = actionSide === 'LONG' ? 'BUY' : actionSide === 'SHORT' ? 'SELL' : null;
      const aiPlan = this.extractAIPlan(action.metadata);
      const aiPolicyAction = Boolean((action.metadata as Record<string, unknown> | undefined)?.aiPolicy) || this.isAIAutonomousRun();
      const strictMeta = this.extractStrictThreeMMeta(action.metadata);
      const entryStyle = this.normalizeAIEntryStyle(aiPlan?.entryStyle);
      const urgencyLevel = this.normalizeAIUrgency(aiPlan?.urgency);
      const spreadPct = this.computeSpreadPct(session.lastOrderBook);
      const volatility = session.atr || decision.volLevel || 0;
      const laddersRequested = Math.max(0, Math.min(5, Math.trunc(Number(aiPlan?.maxAdds ?? 2))));
      const tradeReady = Boolean(session.warmup.tradeReady);
      const addonReady = Boolean(session.warmup.addonReady);

      if (action.type === StrategyActionType.ENTRY && desiredOrderSide) {
        if (!tradeReady) {
          continue;
        }
        // Autonomous path must never auto-close just to reverse.
        if (position && position.side !== actionSide) {
          const explicitExitIndex = explicitExitActionIndexBySide.get(position.side);
          const hasPriorExplicitExitInSameDecision =
            explicitExitIndex != null && explicitExitIndex <= actionIndex;
          if (!hasPriorExplicitExitInSameDecision) {
            if (aiPolicyAction) {
              // Throttle: log at most once per 60 seconds per symbol
              const nowMs = Date.now();
              const lastWarnTs = (session as any)._lastReversalWarnTs || 0;
              if (nowMs - lastWarnTs >= 60_000) {
                (session as any)._lastReversalWarnTs = nowMs;
                this.addConsoleLog(
                  'WARN',
                  normalized,
                  `Strategy reversal blocked without direction lock confirmation: ${position.side} -> ${actionSide}`,
                  session.lastEventTimestampMs
                );
              }
              continue;
            }
            const closeQty = roundTo(position.qty, 6);
            if (closeQty > 0) {
              if (!canQueueExitOrder(position.side)) {
                continue;
              }
              const closeOrder = this.buildAiLimitOrder(
                session,
                position.side === 'LONG' ? 'SELL' : 'BUY',
                closeQty,
                true,
                'STRAT_REVERSAL_EXIT'
              );
              if (closeOrder) {
                if (!queueOrder(closeOrder)) {
                  continue;
                }
                session.lastExitOrderTs = decisionTs;
                session.pendingExitReason = 'STRAT_REVERSAL_EXIT';
                this.armPendingCloseAction(session, 'REVERSAL', position.side, decisionTs);
                this.addConsoleLog('INFO', normalized, `Strategy reversal: closing ${position.side} before ${actionSide}`, session.lastEventTimestampMs);
              }
            }
          }
        }

        if (position && position.side === actionSide) {
          const referencePrice = Number(action.expectedPrice) || session.latestMarkPrice || position.entryPrice;
          const sizing = (aiPolicyAction && strictMeta.enabled)
            ? this.computeStrictAISizing(session, referencePrice, {
              mode: 'ADD',
              addPct: strictMeta.addPct,
              maxExposureMultiplier: strictMeta.maxExposureMultiplier,
            })
            : this.computeRiskSizing(session, referencePrice, decision.regime, action.sizeMultiplier || 0.5, {
              mode: 'ADD',
            });
          if (sizing.qty > 0) {
            session.engine.setLeverageOverride(sizing.leverage);
            if (this.hasLiveWorkingOrderForSide(session, desiredOrderSide)) continue;
            if (aiPolicyAction) {
              if (!this.isAiExecutionHealthy(session)) continue;
              const addOrder = this.buildAiPostOnlyEntryOrder(session, desiredOrderSide, sizing.qty, 'STRAT_ADD', strictMeta.enabled);
              if (!addOrder) continue;
              if (!queueOrder(addOrder)) continue;
            } else {
              const addOrders = this.limitStrategy.buildEntryOrders({
                side: desiredOrderSide,
                qty: sizing.qty,
                markPrice: referencePrice,
                orderBook: session.lastOrderBook,
                entryStyle: 'LIMIT',
                urgencyLevel,
                spreadPct,
                volatility,
                ladderCount: laddersRequested,
              });
              for (const order of addOrders) {
                queueOrder({ ...order, reasonCode: 'STRAT_ADD' });
              }
            }
            session.addOnState.count += 1;
            session.addOnState.lastAddOnTs = decisionTs;
            this.addConsoleLog('INFO', normalized, `Strategy add ${actionSide} +${sizing.qty}`, session.lastEventTimestampMs);
          }
          continue;
        }

        const referencePrice = Number(action.expectedPrice) || session.latestMarkPrice || 0;
        if (!(referencePrice > 0)) continue;
        const sizing = (aiPolicyAction && strictMeta.enabled)
          ? this.computeStrictAISizing(session, referencePrice, {
            mode: 'ENTRY',
            maxExposureMultiplier: strictMeta.maxExposureMultiplier,
          })
          : this.computeRiskSizing(session, referencePrice, decision.regime, action.sizeMultiplier || 1, {
            mode: 'ENTRY',
          });
        if (!(sizing.qty > 0)) continue;
        session.engine.setLeverageOverride(sizing.leverage);
        if (
          DEFAULT_STRAT_ENTRY_MIN_INTERVAL_MS > 0
          && session.lastEntryEventTs > 0
          && (decisionTs - session.lastEntryEventTs) < DEFAULT_STRAT_ENTRY_MIN_INTERVAL_MS
        ) {
          continue;
        }
        if (this.hasLiveWorkingOrderForSide(session, desiredOrderSide)) continue;
        let entryQueued = false;
        if (aiPolicyAction) {
          if (!this.isAiExecutionHealthy(session)) continue;
          if (this.shouldBlockAiEntryByCooldown(session, normalized, decisionTs)) continue;
          const entryOrder = this.buildAiPostOnlyEntryOrder(session, desiredOrderSide, sizing.qty, 'STRAT_ENTRY', strictMeta.enabled);
          if (!entryOrder) continue;
          if (!queueOrder(entryOrder)) continue;
          entryQueued = true;
        } else {
          const entryOrders = this.limitStrategy.buildEntryOrders({
            side: desiredOrderSide,
            qty: sizing.qty,
            markPrice: referencePrice,
            orderBook: session.lastOrderBook,
            entryStyle,
            urgencyLevel,
            spreadPct,
            volatility,
            ladderCount: laddersRequested,
          });
          for (const order of entryOrders) {
            entryQueued = queueOrder({ ...order, reasonCode: 'STRAT_ENTRY' }) || entryQueued;
          }
        }
        if (!entryQueued) continue;
        this.stagePendingStrategyEntry(session, action, decision, referencePrice, sizing.leverage, decisionTs);
        session.lastEntryEventTs = decisionTs;
        this.addConsoleLog('INFO', normalized, `Strategy entry ${actionSide} ${sizing.qty} @ ~${referencePrice}`, session.lastEventTimestampMs);
        continue;
      }

      if (action.type === StrategyActionType.ADD) {
        if (!addonReady) continue;
        const currentPosition = session.lastState.position;
        if (!currentPosition) continue;
        const currentSide = currentPosition.side === 'LONG' ? 'BUY' : 'SELL';
        const referencePrice = Number(action.expectedPrice) || session.latestMarkPrice || currentPosition.entryPrice;
        const sizing = (aiPolicyAction && strictMeta.enabled)
          ? this.computeStrictAISizing(session, referencePrice, {
            mode: 'ADD',
            addPct: strictMeta.addPct,
            maxExposureMultiplier: strictMeta.maxExposureMultiplier,
          })
          : this.computeRiskSizing(session, referencePrice, decision.regime, action.sizeMultiplier || 0.5, {
            mode: 'ADD',
          });
        if (!(sizing.qty > 0)) continue;
        session.engine.setLeverageOverride(sizing.leverage);
        if (this.hasLiveWorkingOrderForSide(session, currentSide)) continue;
        if (aiPolicyAction) {
          if (!this.isAiExecutionHealthy(session)) continue;
          const addOrder = this.buildAiPostOnlyEntryOrder(session, currentSide, sizing.qty, 'STRAT_ADD', strictMeta.enabled);
          if (!addOrder) continue;
          if (!queueOrder(addOrder)) continue;
        } else {
          const addOrders = this.limitStrategy.buildEntryOrders({
            side: currentSide,
            qty: sizing.qty,
            markPrice: referencePrice,
            orderBook: session.lastOrderBook,
            entryStyle,
            urgencyLevel,
            spreadPct,
            volatility,
            ladderCount: laddersRequested,
          });
          for (const order of addOrders) {
            queueOrder({ ...order, reasonCode: 'STRAT_ADD' });
          }
        }
        session.addOnState.count += 1;
        session.addOnState.lastAddOnTs = decisionTs;
        this.addConsoleLog('INFO', normalized, `Strategy add to ${currentPosition.side} +${sizing.qty}`, session.lastEventTimestampMs);
        continue;
      }

      if (action.type === StrategyActionType.REDUCE && position) {
        const referencePrice = Number(action.expectedPrice) || session.latestMarkPrice || position.entryPrice || 0;
        const fullQty = roundTo(position.qty, 6);
        if (!(fullQty > 0)) continue;
        if (
          action.reason === 'REDUCE_SOFT'
          && DEFAULT_STRAT_SOFT_REDUCE_FRESH_PROTECT_MS > 0
          && this.computePositionTimeInMs(session, decisionTs) < DEFAULT_STRAT_SOFT_REDUCE_FRESH_PROTECT_MS
        ) {
          continue;
        }
        if (
          DEFAULT_STRAT_REDUCE_MIN_INTERVAL_MS > 0
          && session.lastReduceOrderTs > 0
          && (decisionTs - session.lastReduceOrderTs) < DEFAULT_STRAT_REDUCE_MIN_INTERVAL_MS
        ) {
          continue;
        }
        const reducePct = clampNumber(Number(action.reducePct ?? 0.5), 0.5, 0.1, 1);
        let reduceQty = roundTo(fullQty * reducePct, 6);
        let forceFullClose = false;
        if (aiPolicyAction && strictMeta.enabled) {
          const strictReduce = this.computeStrictReduceQty(session, referencePrice, {
            reducePct,
            allowReduceBelowNotional: strictMeta.allowReduceBelowNotional,
            maxPositionNotional: strictMeta.maxPositionNotional,
          });
          reduceQty = strictReduce.qty;
          forceFullClose = strictMeta.allowReduceBelowNotional && reduceQty >= fullQty;
        } else {
          const residualQty = roundTo(Math.max(0, fullQty - Math.max(0, reduceQty)), 6);
          const reduceNotional = Math.max(0, reduceQty * Math.max(referencePrice, 0));
          const residualNotional = Math.max(0, residualQty * Math.max(referencePrice, 0));
          forceFullClose =
            !(reduceQty > 0)
            || reduceQty >= fullQty
            || residualQty <= DEFAULT_DUST_MIN_QTY
            || (residualNotional > 0 && residualNotional <= DEFAULT_DUST_MIN_NOTIONAL_USDT)
            || (reduceNotional > 0 && reduceNotional < DEFAULT_MIN_REDUCE_NOTIONAL_USDT);
          if (forceFullClose) {
            reduceQty = fullQty;
          }
        }
        if (!(reduceQty > 0)) continue;
        if (!canQueueExitOrder(position.side)) continue;
        const reduceOrder = this.buildAiLimitOrder(
          session,
          position.side === 'LONG' ? 'SELL' : 'BUY',
          reduceQty,
          true,
          forceFullClose ? 'STRAT_EXIT' : 'STRAT_REDUCE'
        );
        if (reduceOrder) {
          if (!queueOrder(reduceOrder)) continue;
          session.lastReduceOrderTs = decisionTs;
          session.lastExitOrderTs = decisionTs;
          if (forceFullClose) {
            session.pendingExitReason = action.reason || session.pendingExitReason || 'STRAT_DUST_FLATTEN';
            this.armPendingCloseAction(session, 'EXIT', position.side, decisionTs);
            this.addConsoleLog('INFO', normalized, `Strategy reduce escalated to full exit for ${position.side} (dust guard)`, session.lastEventTimestampMs);
          } else {
            this.addConsoleLog('INFO', normalized, `Strategy reduce ${position.side} -${reduceQty} (${(reducePct * 100).toFixed(0)}%)`, session.lastEventTimestampMs);
          }
        }
        continue;
      }

      if (action.type === StrategyActionType.EXIT && position) {
        const exitQty = roundTo(position.qty, 6);
        if (!(exitQty > 0)) continue;
        if (!canQueueExitOrder(position.side)) continue;
        const exitOrder = this.buildAiLimitOrder(
          session,
          position.side === 'LONG' ? 'SELL' : 'BUY',
          exitQty,
          true,
          'STRAT_EXIT'
        );
        if (exitOrder) {
          if (!queueOrder(exitOrder)) continue;
          session.lastExitOrderTs = decisionTs;
          this.armPendingCloseAction(session, 'EXIT', position.side, decisionTs);
          this.addConsoleLog('INFO', normalized, `Strategy exit ${position.side} completely`, session.lastEventTimestampMs);
          session.pendingExitReason = action.reason;
        }
      }
    }

    return createdOrders;
  }

  getStrategyPosition(symbol: string): StrategyPositionState | null {
    const normalized = normalizeSymbol(symbol);
    const session = this.sessions.get(normalized);
    if (!session || !session.lastState.position) return null;
    const pos = session.lastState.position;
    const markPrice = session.latestMarkPrice || pos.entryPrice;
    return {
      side: pos.side,
      qty: pos.qty,
      entryPrice: pos.entryPrice,
      unrealizedPnlPct: this.computeUnrealizedPnlPct(session, markPrice),
      addsUsed: session.addOnState?.count ?? 0,
      timeInPositionMs: this.computePositionTimeInMs(session, Number(this.clock.now())),
      peakPnlPct: Number.isFinite(session.peakUnrealizedPnlPct) ? session.peakUnrealizedPnlPct : undefined,
    };
  }

  getSymbolRealizedPnl(symbol: string): number | null {
    const normalized = normalizeSymbol(symbol);
    const session = this.sessions.get(normalized);
    if (!session) return null;
    const value = Number(session.realizedPnl);
    return Number.isFinite(value) ? value : null;
  }

  getStrategyRiskState(symbol: string, timestampMs?: number): {
    equity: number;
    leverage: number;
    startingMarginUser: number;
    marginInUse: number;
    drawdownPct: number;
    dailyLossLock: boolean;
    cooldownMsRemaining: number;
    marginHealth: number;
    maintenanceMarginRatio: number;
    liquidationProximityPct: number;
  } {
    const normalized = normalizeSymbol(symbol);
    const session = this.sessions.get(normalized);
    const nowMs = Number.isFinite(timestampMs as number) ? Number(timestampMs) : this.clock.now();
    if (!session || !this.config) {
      return {
        equity: 0,
        leverage: this.config?.leverage ?? 0,
        startingMarginUser: 0,
        marginInUse: 0,
        drawdownPct: 0,
        dailyLossLock: false,
        cooldownMsRemaining: 0,
        marginHealth: 0,
        maintenanceMarginRatio: 0,
        liquidationProximityPct: 0,
      };
    }

    const markPrice = session.latestMarkPrice || session.lastState.position?.entryPrice || 0;
    const unrealized = this.computeUnrealizedPnl(session);
    const equity = session.lastState.walletBalance + unrealized;
    const leverage = session.dynamicLeverage || this.getSessionBaseLeverage(session) || 1;
    const marginInUse = session.lastState.position && markPrice > 0
      ? Math.abs(session.lastState.position.qty * markPrice) / Math.max(1, leverage)
      : 0;
    const equityStart = this.getSessionStartEquityUsdt(session);
    const drawdownPct = equityStart > 0 ? (equity - equityStart) / equityStart : 0;
    const dailyLossLock = false;
    const cooldownMsRemaining = 0;
    const marginHealth = Number.isFinite(session.lastState.marginHealth) ? Number(session.lastState.marginHealth) : 0;
    const maintenanceMarginRatio = Math.max(0, Math.min(5, 1 - marginHealth));
    const liquidationProximityPct = Math.max(0, Math.min(100, marginHealth * 100));

    return {
      equity: roundTo(equity, 8),
      leverage: roundTo(leverage, 4),
      startingMarginUser: roundTo(this.getSessionInitialMarginUsdt(session), 8),
      marginInUse: roundTo(Math.max(0, marginInUse), 8),
      drawdownPct: roundTo(drawdownPct, 8),
      dailyLossLock,
      cooldownMsRemaining,
      marginHealth: roundTo(marginHealth, 8),
      maintenanceMarginRatio: roundTo(maintenanceMarginRatio, 8),
      liquidationProximityPct: roundTo(liquidationProximityPct, 8),
    };
  }

  getStrategyExecutionState(symbol: string, timestampMs?: number): {
    lastAction: 'NONE' | 'HOLD' | 'ENTER' | 'MANAGE' | 'EXIT';
    holdStreak: number;
    lastAddMsAgo: number | null;
    lastFlipMsAgo: number | null;
    winnerStopArmed?: boolean;
    winnerStopType?: 'TRAIL_STOP' | 'PROFITLOCK' | null;
    winnerStopPrice?: number | null;
    winnerRMultiple?: number | null;
  } {
    const normalized = normalizeSymbol(symbol);
    const session = this.sessions.get(normalized);
    const nowMs = Number.isFinite(timestampMs as number) ? Number(timestampMs) : this.clock.now();
    if (!session) {
      return {
        lastAction: 'NONE',
        holdStreak: 0,
        lastAddMsAgo: null,
        lastFlipMsAgo: null,
        winnerStopArmed: false,
        winnerStopType: null,
        winnerStopPrice: null,
        winnerRMultiple: null,
      };
    }

    let lastAction: 'NONE' | 'HOLD' | 'ENTER' | 'MANAGE' | 'EXIT' = 'NONE';
    if (session.pendingExitReason) {
      lastAction = 'EXIT';
    } else if (session.addOnState.lastAddOnTs > 0 && session.addOnState.lastAddOnTs >= session.lastEntryEventTs) {
      lastAction = 'MANAGE';
    } else if (session.lastEntryEventTs > 0) {
      lastAction = 'ENTER';
    }

    const winnerState = session.winnerState;
    const winnerStopPrice = session.stopLossPrice ? roundTo(session.stopLossPrice, 8) : null;
    const winnerRMultiple = winnerState && winnerState.rDistance > 0 && session.latestMarkPrice > 0
      ? roundTo(
        ((winnerState.side === 'LONG' ? 1 : -1) * (session.latestMarkPrice - winnerState.entryPrice)) / winnerState.rDistance,
        4
      )
      : null;
    const winnerStopType = winnerState?.trailingStop != null ? 'TRAIL_STOP' : winnerState?.profitLockStop != null ? 'PROFITLOCK' : null;

    return {
      lastAction,
      holdStreak: 0,
      lastAddMsAgo: session.addOnState.lastAddOnTs > 0 ? Math.max(0, nowMs - session.addOnState.lastAddOnTs) : null,
      lastFlipMsAgo: session.flipState.lastPartialReduceTs > 0 ? Math.max(0, nowMs - session.flipState.lastPartialReduceTs) : null,
      winnerStopArmed: Boolean(winnerStopPrice != null),
      winnerStopType,
      winnerStopPrice,
      winnerRMultiple,
    };
  }

  ingestDepthEvent(input: {
    symbol: string;
    eventTimestampMs: number;
    orderBook: DryRunOrderBook;
    markPrice?: number;
  }): DryRunSessionStatus | null {
    if (!this.running || !this.config) return null;

    const symbol = normalizeSymbol(input.symbol);
    const session = this.sessions.get(symbol);
    if (!session) return null;

    const eventTimestampMs = Number(input.eventTimestampMs);
    if (!Number.isFinite(eventTimestampMs) || eventTimestampMs <= 0) return null;
    if (session.lastEventTimestampMs > 0 && eventTimestampMs <= session.lastEventTimestampMs) return null;
    if (session.lastEventTimestampMs > 0 && (eventTimestampMs - session.lastEventTimestampMs) < DEFAULT_EVENT_INTERVAL_MS) {
      return null;
    }
    this.clock.set(eventTimestampMs);

    const book = this.normalizeBook(input.orderBook);
    session.lastOrderBook = book;
    if (book.bids.length === 0 || book.asks.length === 0) {
      if (session.lastEmptyBookLogTs === 0 || (eventTimestampMs - session.lastEmptyBookLogTs) >= this.config.heartbeatIntervalMs) {
        this.addConsoleLog('WARN', symbol, 'Orderbook empty on one side. Waiting for full depth.', eventTimestampMs);
        session.lastEmptyBookLogTs = eventTimestampMs;
      }
      return null;
    }

    const bestBid = book.bids[0].price;
    const bestAsk = book.asks[0].price;
    const resolvedMarkPriceRaw = Number.isFinite(input.markPrice as number) && Number(input.markPrice) > 0
      ? Number(input.markPrice)
      : (bestBid + bestAsk) / 2;
    const markPrice = roundTo(resolvedMarkPriceRaw, 8);
    if (!(markPrice > 0)) return null;

    this.updateDerivedMetrics(session, book, markPrice);
    const spreadPct = this.computeSpreadPct(book);
    const effectiveMaxSpreadPct = this.getEffectiveMaxSpreadPct(session);
    if (spreadPct != null && spreadPct > effectiveMaxSpreadPct) {
      session.spreadBreachCount += 1;
    } else {
      session.spreadBreachCount = 0;
    }

    const prevPosition = session.lastState.position;
    const orders = this.buildDeterministicOrders(session, markPrice, eventTimestampMs);
    const event: DryRunEventInput = {
      timestampMs: eventTimestampMs,
      markPrice,
      orderBook: book,
      orders,
    };

    const out = session.engine.processEvent(event);
    const cleanupOrderResults = this.cleanupWorkingStrategyOrdersAfterEvent(
      session,
      prevPosition,
      out.state.position,
      out.log.orderResults,
      eventTimestampMs
    );
    const nextState = cleanupOrderResults.length > 0
      ? session.engine.getStateSnapshot()
      : out.state;
    if (cleanupOrderResults.length > 0) {
      out.log.orderResults.push(...cleanupOrderResults);
    }

    const lastCheckMs = session.lastHeartbeatTs > 0 ? eventTimestampMs - session.lastHeartbeatTs : eventTimestampMs;
    session.lastEventTimestampMs = eventTimestampMs;
    session.lastState = nextState;
    session.lastMarkPrice = session.latestMarkPrice;
    session.latestMarkPrice = markPrice;
    session.realizedPnl += out.log.realizedPnl;
    session.feePaid += out.log.fee;
    session.fundingPnl += out.log.fundingImpact;
    session.eventCount += 1;
    session.logTail.push(out.log);
    if (session.logTail.length > ENGINE_LOG_TAIL_LIMIT) {
      session.logTail = session.logTail.slice(session.logTail.length - ENGINE_LOG_TAIL_LIMIT);
    }

    if (out.log.realizedPnl !== 0) {
      if (out.log.realizedPnl > 0) {
        session.winStreak += 1;
        session.lossStreak = 0;
      } else {
        session.lossStreak += 1;
        session.winStreak = 0;
      }

      if (this.alertService && out.log.realizedPnl <= -DEFAULT_LARGE_LOSS_ALERT) {
        this.alertService.send('LARGE_LOSS', `${symbol}: realized PnL ${roundTo(out.log.realizedPnl, 2)} USDT`, 'HIGH');
      }
    }

    const equity = session.lastState.walletBalance + this.computeUnrealizedPnl(session);
    if (
      session.lastPerfTs === 0
      || (eventTimestampMs - session.lastPerfTs) >= DEFAULT_PERF_SAMPLE_MS
      || out.log.realizedPnl !== 0
    ) {
      session.performance.recordEquity(equity);
      session.lastPerfTs = eventTimestampMs;
    }

    if (prevPosition && !nextState.position && session.activeSignal) {
      session.activeSignal = null;
    }

    if (session.lastDataLogTs === 0 || (eventTimestampMs - session.lastDataLogTs) >= 2_000) {
      this.addConsoleLog('INFO', symbol, `Market Data Received: ${symbol} @ ${markPrice}`, eventTimestampMs);
      session.lastDataLogTs = eventTimestampMs;
    }

    if (session.lastHeartbeatTs === 0 || (eventTimestampMs - session.lastHeartbeatTs) >= this.config.heartbeatIntervalMs) {
      const seconds = Math.max(1, Math.floor(lastCheckMs / 1000));
      this.addConsoleLog(
        'INFO',
        symbol,
        `Running... Scanning ${symbol}. Current Price: ${markPrice}. Last Check: ${seconds}s ago.`,
        eventTimestampMs
      );
      session.lastHeartbeatTs = eventTimestampMs;
    }

    if (out.log.fundingImpact !== 0) {
      this.addConsoleLog('INFO', symbol, `Funding applied: ${roundTo(out.log.fundingImpact, 8)} USDT`, eventTimestampMs);
    }

    if (out.log.orderResults.length > 0) {
      for (const order of out.log.orderResults) {
        this.logOrderResult(session, symbol, order, eventTimestampMs);
      }
    }
    this.syncWorkingOrderLogState(session);

    if (out.log.liquidationTriggered) {
      this.addConsoleLog('WARN', symbol, 'Liquidation triggered. Position force-closed.', eventTimestampMs);
    }

    this.handleOrderActions(session, out.log.orderResults, markPrice, spreadPct, eventTimestampMs);
    this.handleTradeTransitions(session, prevPosition, out.log, nextState.position, eventTimestampMs);
    this.syncPositionStateAfterEvent(session, prevPosition, nextState.position, eventTimestampMs, markPrice);
    this.maybeLogSnapshot(session, eventTimestampMs);

    return this.getStatus();
  }

  getStatus(): DryRunSessionStatus {
    const perSymbol: Record<string, DryRunSymbolStatus> = {};

    let totalEquity = 0;
    let walletBalance = 0;
    let unrealizedPnl = 0;
    let realizedPnl = 0;
    let feePaid = 0;
    let fundingPnl = 0;
    let marginHealth = 0;
    let marginHealthInit = false;
    let totalWins = 0;
    let totalLosses = 0;
    let totalPnL = 0;
    let maxDrawdown = 0;
    let sharpeSum = 0;
    let sharpeCount = 0;

    for (const symbol of this.symbols) {
      const session = this.sessions.get(symbol);
      if (!session) continue;

      const symbolWallet = session.lastState.walletBalance;
      const symbolUnrealized = this.computeUnrealizedPnl(session);
      const symbolEquity = symbolWallet + symbolUnrealized;
      const symbolMarginHealth = session.lastState.marginHealth;

      totalEquity += symbolEquity;
      walletBalance += symbolWallet;
      unrealizedPnl += symbolUnrealized;
      realizedPnl += session.realizedPnl;
      feePaid += session.feePaid;
      fundingPnl += session.fundingPnl;
      if (!marginHealthInit) {
        marginHealth = symbolMarginHealth;
        marginHealthInit = true;
      } else {
        marginHealth = Math.min(marginHealth, symbolMarginHealth);
      }

      const perf = session.performance.getMetrics();
      totalWins += perf.winCount;
      totalLosses += perf.lossCount;
      totalPnL += perf.totalPnL;
      maxDrawdown = Math.max(maxDrawdown, perf.maxDrawdown);
      if (perf.sharpeRatio !== 0) {
        sharpeSum += perf.sharpeRatio;
        sharpeCount += 1;
      }

      perSymbol[symbol] = {
        symbol,
        capital: {
          configuredReserveUsdt: roundTo(this.getSessionConfiguredReserveUsdt(session), 8),
          effectiveReserveUsdt: roundTo(this.getSessionEffectiveReserveUsdt(session), 8),
          initialMarginUsdt: roundTo(this.getSessionInitialMarginUsdt(session), 8),
          leverage: roundTo(this.getSessionBaseLeverage(session), 4),
          reserveScale: roundTo(Number(session.capital.reserveScale || this.config?.reserveScale || 1), 8),
        },
        warmup: { ...session.warmup },
        trend: { ...session.trend },
        metrics: {
          markPrice: session.latestMarkPrice,
          totalEquity: roundTo(symbolEquity, 8),
          walletBalance: roundTo(symbolWallet, 8),
          unrealizedPnl: roundTo(symbolUnrealized, 8),
          realizedPnl: roundTo(session.realizedPnl, 8),
          feePaid: roundTo(session.feePaid, 8),
          fundingPnl: roundTo(session.fundingPnl, 8),
          marginHealth: roundTo(symbolMarginHealth, 8),
        },
        performance: perf,
        risk: {
          winStreak: session.winStreak,
          lossStreak: session.lossStreak,
          dynamicLeverage: roundTo(session.dynamicLeverage, 2),
          stopLossPrice: session.stopLossPrice ? roundTo(session.stopLossPrice, 6) : null,
          liquidationRisk: this.computeLiquidationRisk(session, symbolMarginHealth),
        },
        position: session.lastState.position
          ? {
            side: session.lastState.position.side,
            qty: session.lastState.position.qty,
            notionalUsdt: roundTo(Math.abs(session.lastState.position.qty * session.latestMarkPrice), 8),
            entryPrice: session.lastState.position.entryPrice,
            peakPnlPct: Number.isFinite(session.peakUnrealizedPnlPct) ? roundTo(session.peakUnrealizedPnlPct, 6) : undefined,
            breakEvenPrice: (() => {
              const value = this.computeBreakEvenPrice(session);
              return value == null ? null : roundTo(value, 8);
            })(),
            markPrice: session.latestMarkPrice,
            unrealizedPnl: roundTo(symbolUnrealized, 8),
            realizedPnl: roundTo(session.realizedPnl, 8),
            netPnl: roundTo(symbolUnrealized + session.realizedPnl - session.feePaid + session.fundingPnl, 8),
            liqPrice: null,
          }
          : null,
        openLimitOrders: session.lastState.openLimitOrders,
        lastEventTimestampMs: session.lastEventTimestampMs,
        eventCount: session.eventCount,
        warnings: session.warmup.vetoReason ? [session.warmup.vetoReason] : [],
      };
    }

    return {
      running: this.running,
      runId: this.runId,
      symbols: [...this.symbols],
      config: this.config,
      summary: {
        totalEquity: roundTo(totalEquity, 8),
        walletBalance: roundTo(walletBalance, 8),
        unrealizedPnl: roundTo(unrealizedPnl, 8),
        realizedPnl: roundTo(realizedPnl, 8),
        feePaid: roundTo(feePaid, 8),
        fundingPnl: roundTo(fundingPnl, 8),
        marginHealth: roundTo(marginHealthInit ? marginHealth : 0, 8),
        performance: {
          totalPnL: roundTo(totalPnL, 8),
          winCount: totalWins,
          lossCount: totalLosses,
          totalTrades: totalWins + totalLosses,
          winRate: totalWins + totalLosses > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0,
          maxDrawdown,
          sharpeRatio: sharpeCount > 0 ? sharpeSum / sharpeCount : 0,
          pnlCurve: [],
        },
      },
      perSymbol,
      logTail: [...this.logTail],
      alphaDecay: [],
    };
  }

  private normalizeBook(orderBook: DryRunOrderBook): DryRunOrderBook {
    const depth = Math.max(1, Math.trunc(DEFAULT_ORDERBOOK_DEPTH));
    const normalize = (levels: Array<{ price: number; qty: number }>, asc: boolean) => {
      const sorted = levels
        .filter((l) => Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.qty) && l.qty > 0)
        .map((l) => ({ price: Number(l.price), qty: Number(l.qty) }))
        .sort((a, b) => asc ? a.price - b.price : b.price - a.price);
      return sorted.slice(0, depth);
    };

    return {
      bids: normalize(orderBook.bids || [], false),
      asks: normalize(orderBook.asks || [], true),
    };
  }

  private buildDeterministicOrders(session: SymbolSession, markPrice: number, eventTimestampMs: number): DryRunOrderRequest[] {
    if (!this.config) {
      return [];
    }

    if (session.manualOrders.length > 0) {
      return [session.manualOrders.shift() as DryRunOrderRequest];
    }

    const state = session.lastState;
    const orders: DryRunOrderRequest[] = [];

    const entryCooldownMs = Math.max(0, Math.trunc(DEFAULT_ENTRY_COOLDOWN_MS));
    const hasOpenLimits = state.openLimitOrders.length > 0;

    if (!state.position && !hasOpenLimits) {
      if (session.lastEntryEventTs === 0 || (eventTimestampMs - session.lastEntryEventTs) >= entryCooldownMs) {
        if (session.pendingFlipEntry) {
          const pending = session.pendingFlipEntry;
          const referencePrice = pending.candidate?.entryPrice ?? markPrice;
          if (referencePrice > 0) {
            const sizing = this.computeRiskSizing(session, referencePrice, 'TR');
            const qty = roundTo(Math.max(0, sizing.qty), 6);
            session.engine.setLeverageOverride(sizing.leverage);
            if (qty > 0) {
              const entryOrders = this.limitStrategy.buildEntryOrders({
                side: pending.side,
                qty,
                markPrice: referencePrice,
                orderBook: session.lastOrderBook,
                urgency: Math.min(1, (pending.signalScore || 0) / 100),
              });
              for (const order of entryOrders) {
                orders.push({ ...order, reasonCode: 'ENTRY_MARKET' });
              }
              session.lastEntryEventTs = eventTimestampMs;
              session.pendingEntry = {
                reason: 'STRATEGY_SIGNAL',
                signalType: pending.signalType,
                signalScore: pending.signalScore,
                candidate: pending.candidate,
                orderflow: pending.orderflow,
                boost: pending.boost,
                market: pending.market,
                timestampMs: pending.timestampMs,
                leverage: sizing.leverage,
              };
            }
          }
          session.pendingFlipEntry = null;
          return orders;
        }

      }
      return orders;
    }

    if (!state.position) {
      return orders;
    }

    const position = state.position;
    if (this.shouldForceAIDustCleanup(session, position, markPrice)) {
      const closeQty = roundTo(position.qty, 6);
      if (closeQty > 0) {
        const closeOrder = this.buildAiLimitOrder(
          session,
          position.side === 'LONG' ? 'SELL' : 'BUY',
          closeQty,
          true,
          'STRAT_EXIT'
        );
        if (closeOrder) {
          orders.push(closeOrder);
          session.pendingExitReason = 'STRAT_DUST_FLATTEN';
          this.addConsoleLog('INFO', session.symbol, `Dust cleanup queued (${position.side} ${closeQty})`, eventTimestampMs);
          return orders;
        }
      }
    }
    this.ensureWinnerState(session, position, markPrice);
    const positionHoldMs = this.computePositionTimeInMs(session, eventTimestampMs);
    const winnerDecision = this.winnerManager.update(session.winnerState as WinnerState, {
      markPrice,
      atr: session.atr || Math.abs(markPrice - position.entryPrice) * 0.01,
      holdMs: positionHoldMs,
    });
    session.winnerState = winnerDecision.nextState;
    session.stopLossPrice = this.resolveActiveStop(session.winnerState);

    if (winnerDecision.action && position.qty > 0) {
      if (!this.isAIAutonomousRun()) {
        const closeSide: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY';
        orders.push({
          side: closeSide,
          type: 'MARKET',
          qty: roundTo(position.qty, 6),
          timeInForce: 'IOC',
          reduceOnly: true,
          reasonCode: winnerDecision.action === 'TRAIL_STOP' ? 'TRAIL_STOP' : 'PROFITLOCK',
        });
        session.pendingExitReason = winnerDecision.action === 'TRAIL_STOP' ? 'TRAIL_STOP' : 'PROFITLOCK_STOP';
        return orders;
      }

      if (
        session.lastWinnerSignalLogTs === 0
        || (eventTimestampMs - session.lastWinnerSignalLogTs) >= this.config.heartbeatIntervalMs
      ) {
        this.addConsoleLog(
          'INFO',
          session.symbol,
          `Winner stop armed (${winnerDecision.action}) at ${roundTo(winnerDecision.stopPrice ?? markPrice, 4)}; waiting strategy decision.`,
          eventTimestampMs
        );
        session.lastWinnerSignalLogTs = eventTimestampMs;
      }
    }

    if (!this.isAIAutonomousRun() && this.shouldRiskEmergency(session, markPrice, this.computeSpreadPct(session.lastOrderBook))) {
      const closeSide: 'BUY' | 'SELL' = position.side === 'LONG' ? 'SELL' : 'BUY';
      orders.push({
        side: closeSide,
        type: 'MARKET',
        qty: roundTo(position.qty, 6),
        timeInForce: 'IOC',
        reduceOnly: true,
        reasonCode: 'RISK_EMERGENCY',
      });
      session.pendingExitReason = 'RISK_EMERGENCY';
      return orders;
    }

    return orders;
  }

  private updateDerivedMetrics(session: SymbolSession, book: DryRunOrderBook, markPrice: number): void {
    session.priceHistory.push(markPrice);
    if (session.priceHistory.length > Math.max(DEFAULT_ATR_WINDOW * 4, 40)) {
      session.priceHistory = session.priceHistory.slice(session.priceHistory.length - Math.max(DEFAULT_ATR_WINDOW * 4, 40));
    }

    if (session.priceHistory.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < session.priceHistory.length; i += 1) {
        diffs.push(Math.abs(session.priceHistory[i] - session.priceHistory[i - 1]));
      }
      const window = diffs.slice(-DEFAULT_ATR_WINDOW);
      const longWindow = diffs.slice(-Math.max(DEFAULT_ATR_WINDOW * 2, 20));
      session.atr = window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : session.atr;
      session.avgAtr = longWindow.length > 0 ? longWindow.reduce((a, b) => a + b, 0) / longWindow.length : session.avgAtr;
    }

    const topLevels = Math.min(10, book.bids.length, book.asks.length);
    let bidVol = 0;
    let askVol = 0;
    for (let i = 0; i < topLevels; i += 1) {
      bidVol += book.bids[i]?.qty ?? 0;
      askVol += book.asks[i]?.qty ?? 0;
    }
    const denom = bidVol + askVol;
    session.obi = denom > 0 ? (bidVol - askVol) / denom : 0;

    const ratio = session.avgAtr > 0 ? session.atr / session.avgAtr : 1;
    session.volatilityRegime = ratio > 1.5 ? 'HIGH' : ratio < 0.7 ? 'LOW' : 'MEDIUM';
  }

  private resolveEntrySide(session: SymbolSession, markPrice: number): 'BUY' | 'SELL' {
    if (session.lastMarkPrice <= 0) {
      return 'BUY';
    }
    return markPrice >= session.lastMarkPrice ? 'BUY' : 'SELL';
  }

  private computeUnrealizedPnl(session: SymbolSession): number {
    if (!session.lastState.position || !(session.latestMarkPrice > 0)) {
      return 0;
    }
    const pos = session.lastState.position;
    if (pos.side === 'LONG') {
      return (session.latestMarkPrice - pos.entryPrice) * pos.qty;
    }
    return (pos.entryPrice - session.latestMarkPrice) * pos.qty;
  }

  private computeLiquidationRisk(session: SymbolSession, marginHealth: number): {
    score: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'CRITICAL';
    timeToLiquidationMs: number | null;
    fundingRateImpact: number;
  } {
    const thresholds = { yellow: 0.3, orange: 0.2, red: 0.1, critical: 0.05 };
    let score: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'CRITICAL' = 'GREEN';
    if (marginHealth <= thresholds.critical) score = 'CRITICAL';
    else if (marginHealth <= thresholds.red) score = 'RED';
    else if (marginHealth <= thresholds.orange) score = 'ORANGE';
    else if (marginHealth <= thresholds.yellow) score = 'YELLOW';

    const positionNotional = session.lastState.position
      ? session.lastState.position.qty * (session.latestMarkPrice || 0)
      : 0;
    const fundingImpact = session.fundingRate * positionNotional;
    const volFactor = session.volatilityRegime === 'HIGH' ? 1.4 : session.volatilityRegime === 'LOW' ? 0.8 : 1;
    const baseMs = 5 * 60 * 1000;
    const timeToLiquidationMs = marginHealth > 0
      ? Math.max(0, Math.round(baseMs * (marginHealth / thresholds.yellow) / volFactor))
      : 0;

    return {
      score,
      timeToLiquidationMs,
      fundingRateImpact: roundTo(fundingImpact, 4),
    };
  }

  private handleTradeTransitions(
    session: SymbolSession,
    prevPosition: DryRunStateSnapshot['position'],
    log: DryRunEventLog,
    nextPosition: DryRunStateSnapshot['position'],
    eventTimestampMs: number
  ): void {
    if (!this.tradeLogger || !this.tradeLogEnabled) return;

    const prevSide = prevPosition?.side ?? null;
    const nextSide = nextPosition?.side ?? null;
    const orderResults = Array.isArray(log.orderResults) ? log.orderResults : [];

    let closingRealized = 0;
    let closingFee = 0;
    let closingQty = 0;
    let closingNotional = 0;
    let openingFee = 0;

    if (prevSide) {
      for (const order of orderResults) {
        const fee = Number.isFinite(order.fee) ? Number(order.fee) : 0;
        const realized = Number.isFinite(order.realizedPnl) ? Number(order.realizedPnl) : 0;
        const filledQty = Number.isFinite(order.filledQty) ? Number(order.filledQty) : 0;
        const avgPrice = Number.isFinite(order.avgFillPrice) ? Number(order.avgFillPrice) : 0;
        if (this.isClosingOrder(prevSide, order.side)) {
          closingFee += fee;
          closingRealized += realized;
          if (filledQty > 0 && avgPrice > 0) {
            closingQty += filledQty;
            closingNotional += filledQty * avgPrice;
          }
        } else {
          openingFee += fee;
        }
      }
    } else {
      for (const order of orderResults) {
        const fee = Number.isFinite(order.fee) ? Number(order.fee) : 0;
        openingFee += fee;
      }
    }

    const fundingImpact = Number.isFinite(log.fundingImpact) ? Number(log.fundingImpact) : 0;
    const liquidation = log.liquidationTriggered || orderResults.some((o) => o.reason === 'FORCED_LIQUIDATION');

    if (prevSide && prevPosition && !session.currentTrade) {
      session.currentTrade = this.buildFallbackTradeFromPosition(session, prevPosition, eventTimestampMs);
    }

    if (!prevSide && nextSide && nextPosition) {
      this.openTrade(session, nextPosition, eventTimestampMs, openingFee);
      return;
    }

    if (prevSide && !nextSide) {
      this.applyTradeAcc(session, closingRealized, closingFee, fundingImpact);
      const exitPrice = closingQty > 0 ? closingNotional / closingQty : session.latestMarkPrice;
      const reason = this.resolveExitReason(session, liquidation, closingRealized, null);
      this.closeTrade(session, eventTimestampMs, exitPrice, prevPosition?.qty || 0, reason);
      return;
    }

    if (prevSide && nextSide && nextPosition) {
      const flipped = prevSide !== nextSide;
      if (flipped) {
        this.applyTradeAcc(session, closingRealized, closingFee, fundingImpact);
        const exitPrice = closingQty > 0 ? closingNotional / closingQty : session.latestMarkPrice;
        const reason = this.resolveExitReason(session, liquidation, closingRealized, 'HARD_INVALIDATION');
        this.closeTrade(session, eventTimestampMs, exitPrice, prevPosition?.qty || 0, reason);
        this.openTrade(session, nextPosition, eventTimestampMs, openingFee);
        return;
      }

      this.applyTradeAcc(session, closingRealized, closingFee + openingFee, fundingImpact);
      this.updateTradePosition(session, nextPosition);
    }
  }

  private openTrade(
    session: SymbolSession,
    position: NonNullable<DryRunStateSnapshot['position']>,
    eventTimestampMs: number,
    openingFee: number
  ): void {
    const context = session.pendingEntry;
    const leverage = context?.leverage || session.dynamicLeverage || this.config?.leverage || 1;
    const entryPrice = Number(position.entryPrice) || 0;
    const qty = Number(position.qty) || 0;
    const notional = entryPrice * qty;
    const marginUsed = leverage > 0 ? notional / leverage : 0;
    const tradeId = `${this.getRunId()}-${session.symbol}-${++session.tradeSeq}`;
    const orderflow = context?.orderflow || this.buildOrderflowMetrics(undefined, session);

    session.currentTrade = {
      tradeId,
      side: position.side,
      entryTimeMs: eventTimestampMs,
      entryPrice,
      qty,
      maxQtySeen: qty,
      notional,
      marginUsed,
      maxMarginUsed: marginUsed,
      leverage,
      pnlRealized: 0,
      feeAcc: openingFee,
      fundingAcc: 0,
      signalType: context?.signalType ?? null,
      signalScore: context?.signalScore ?? null,
      candidate: context?.candidate ?? null,
      orderflow,
    };

    this.logTradeEvent({
      type: 'ENTRY',
      runId: this.getRunId(),
      symbol: session.symbol,
      timestampMs: eventTimestampMs,
      tradeId,
      side: position.side,
      entryPrice,
      qty,
      notional,
      marginUsed,
      leverage,
      reason: context?.reason || 'UNKNOWN',
      signalType: context?.signalType ?? null,
      signalScore: context?.signalScore ?? null,
      orderflow,
      candidate: context?.candidate ?? null,
    });

    session.pendingEntry = null;
  }

  private closeTrade(
    session: SymbolSession,
    eventTimestampMs: number,
    exitPrice: number,
    qty: number,
    reason: string
  ): void {
    const trade = session.currentTrade || this.buildFallbackTrade(session, eventTimestampMs, qty);
    const realized = trade.pnlRealized;
    const feeUsdt = trade.feeAcc;
    const fundingUsdt = trade.fundingAcc;
    const net = realized - feeUsdt + fundingUsdt;
    const reportedQty = Math.max(0, Number(trade.maxQtySeen || trade.qty || qty));
    const marginBase = Math.max(0, Number(trade.maxMarginUsed || trade.marginUsed || 0));
    const returnPct = marginBase > 0 ? (net / marginBase) * 100 : null;
    const rMultiple = this.computeRMultiple(trade, net);

    this.logTradeEvent({
      type: 'EXIT',
      runId: this.getRunId(),
      symbol: session.symbol,
      timestampMs: eventTimestampMs,
      tradeId: trade.tradeId,
      side: trade.side,
      entryTimeMs: trade.entryTimeMs,
      entryPrice: trade.entryPrice,
      exitPrice,
      qty: reportedQty > 0 ? reportedQty : qty,
      reason,
      durationMs: Math.max(0, eventTimestampMs - trade.entryTimeMs),
      pnl: {
        realizedUsdt: Number(realized.toFixed(8)),
        feeUsdt: Number(feeUsdt.toFixed(8)),
        fundingUsdt: Number(fundingUsdt.toFixed(8)),
        netUsdt: Number(net.toFixed(8)),
        returnPct: returnPct === null ? null : Number(returnPct.toFixed(4)),
        rMultiple: rMultiple === null ? null : Number(rMultiple.toFixed(4)),
      },
      cumulative: this.buildCumulativeSummary(),
      orderflow: trade.orderflow,
      candidate: trade.candidate ?? null,
    });

    const equity = session.lastState.walletBalance + this.computeUnrealizedPnl(session);
    session.performance.recordTrade({
      realizedPnl: net,
      equity,
    });
    session.lastPerfTs = eventTimestampMs;

    session.currentTrade = null;
    session.pendingExitReason = null;
  }

  private updateTradePosition(session: SymbolSession, position: NonNullable<DryRunStateSnapshot['position']>): void {
    if (!session.currentTrade) return;
    const leverage = session.dynamicLeverage || session.currentTrade.leverage || this.config?.leverage || 1;
    const entryPrice = Number(position.entryPrice) || session.currentTrade.entryPrice;
    const qty = Number(position.qty) || session.currentTrade.qty;
    const notional = entryPrice * qty;
    const marginUsed = leverage > 0 ? notional / leverage : session.currentTrade.marginUsed;

    session.currentTrade.side = position.side;
    session.currentTrade.entryPrice = entryPrice;
    session.currentTrade.qty = qty;
    session.currentTrade.maxQtySeen = Math.max(Number(session.currentTrade.maxQtySeen || 0), qty);
    session.currentTrade.notional = notional;
    session.currentTrade.marginUsed = marginUsed;
    session.currentTrade.maxMarginUsed = Math.max(Number(session.currentTrade.maxMarginUsed || 0), marginUsed);
    session.currentTrade.leverage = leverage;
  }

  private applyTradeAcc(session: SymbolSession, realized: number, fee: number, funding: number): void {
    const trade = session.currentTrade;
    if (!trade) return;
    trade.pnlRealized += realized;
    trade.feeAcc += fee;
    trade.fundingAcc += funding;
  }

  private resolveExitReason(
    session: SymbolSession,
    liquidation: boolean,
    realized: number,
    fallback: string | null
  ): string {
    if (liquidation) return 'RISK_EMERGENCY';
    if (fallback) return fallback;
    if (session.pendingExitReason) return session.pendingExitReason;
    if (realized > 0) return 'PROFITLOCK_STOP';
    if (realized < 0) return 'RISK_EMERGENCY';
    return 'HARD_INVALIDATION';
  }

  private computeRMultiple(trade: ActiveTrade, net: number): number | null {
    const sl = trade.candidate?.slPrice;
    const qty = Math.max(Number(trade.maxQtySeen || 0), Number(trade.qty || 0));
    if (!Number.isFinite(sl) || !(qty > 0)) return null;
    const risk = Math.abs(trade.entryPrice - Number(sl)) * qty;
    if (!(risk > 0)) return null;
    return net / risk;
  }

  private buildFallbackTradeFromPosition(
    session: SymbolSession,
    position: NonNullable<DryRunStateSnapshot['position']>,
    eventTimestampMs: number
  ): ActiveTrade {
    const leverage = session.dynamicLeverage || this.config?.leverage || 1;
    const entryPrice = Number(position.entryPrice) || session.latestMarkPrice || 0;
    const size = Number(position.qty) || 0;
    const notional = entryPrice * size;
    const marginUsed = leverage > 0 ? notional / leverage : 0;
    const tradeId = `${this.getRunId()}-${session.symbol}-${++session.tradeSeq}`;
    return {
      tradeId,
      side: position.side,
      entryTimeMs: eventTimestampMs,
      entryPrice,
      qty: size,
      maxQtySeen: size,
      notional,
      marginUsed,
      maxMarginUsed: marginUsed,
      leverage,
      pnlRealized: 0,
      feeAcc: 0,
      fundingAcc: 0,
      signalType: null,
      signalScore: null,
      candidate: null,
      orderflow: this.buildOrderflowMetrics(undefined, session),
    };
  }

  private buildFallbackTrade(session: SymbolSession, eventTimestampMs: number, qty: number): ActiveTrade {
    if (session.lastState.position) {
      return this.buildFallbackTradeFromPosition(session, session.lastState.position, eventTimestampMs);
    }
    const leverage = session.dynamicLeverage || this.config?.leverage || 1;
    const entryPrice = session.latestMarkPrice || 0;
    const size = qty || 0;
    const notional = entryPrice * size;
    const marginUsed = leverage > 0 ? notional / leverage : 0;
    const tradeId = `${this.getRunId()}-${session.symbol}-${++session.tradeSeq}`;
    return {
      tradeId,
      side: 'LONG',
      entryTimeMs: eventTimestampMs,
      entryPrice,
      qty: size,
      maxQtySeen: size,
      notional,
      marginUsed,
      maxMarginUsed: marginUsed,
      leverage,
      pnlRealized: 0,
      feeAcc: 0,
      fundingAcc: 0,
      signalType: null,
      signalScore: null,
      candidate: null,
      orderflow: this.buildOrderflowMetrics(undefined, session),
    };
  }

  private buildCumulativeSummary(): { totalPnL: number; totalTrades: number; winCount: number; winRate: number } {
    const perf = this.getStatus().summary.performance;
    if (!perf) {
      return { totalPnL: 0, totalTrades: 0, winCount: 0, winRate: 0 };
    }
    return {
      totalPnL: Number(perf.totalPnL.toFixed(8)),
      totalTrades: perf.totalTrades,
      winCount: perf.winCount,
      winRate: perf.winRate,
    };
  }

  private maybeLogSnapshot(session: SymbolSession, eventTimestampMs: number): void {
    if (!this.tradeLogger || !this.tradeLogEnabled) return;
    const intervalMs = Math.max(0, Math.trunc(DEFAULT_SNAPSHOT_LOG_MS));
    if (intervalMs === 0) return;
    if (session.lastSnapshotLogTs > 0 && (eventTimestampMs - session.lastSnapshotLogTs) < intervalMs) return;

    const unrealized = this.computeUnrealizedPnl(session);
    const totalEquity = session.lastState.walletBalance + unrealized;
    this.logTradeEvent({
      type: 'SNAPSHOT',
      runId: this.getRunId(),
      symbol: session.symbol,
      timestampMs: eventTimestampMs,
      markPrice: session.latestMarkPrice,
      walletBalance: roundTo(session.lastState.walletBalance, 8),
      totalEquity: roundTo(totalEquity, 8),
      unrealizedPnl: roundTo(unrealized, 8),
      realizedPnl: roundTo(session.realizedPnl, 8),
      feePaid: roundTo(session.feePaid, 8),
      fundingPnl: roundTo(session.fundingPnl, 8),
      marginHealth: roundTo(session.lastState.marginHealth, 8),
      position: session.lastState.position
        ? {
          side: session.lastState.position.side,
          qty: roundTo(session.lastState.position.qty, 6),
          entryPrice: roundTo(session.lastState.position.entryPrice, 8),
        }
        : null,
    });

    session.lastSnapshotLogTs = eventTimestampMs;
  }

  private buildOrderflowMetrics(
    input?: StrategySignal['orderflow'],
    session?: SymbolSession
  ): DryRunOrderflowMetrics {
    const norm = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    return {
      obiWeighted: norm(input?.obiWeighted),
      obiDeep: norm(input?.obiDeep ?? session?.obi),
      deltaZ: norm(input?.deltaZ),
      cvdSlope: norm(input?.cvdSlope),
    };
  }

  private buildMarketMetrics(
    input?: StrategySignal['market'] & { price?: number | null },
    session?: SymbolSession
  ): { price: number | null; atr: number | null; avgAtr: number | null; recentHigh: number | null; recentLow: number | null } {
    const norm = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    return {
      price: norm(input?.price ?? session?.latestMarkPrice),
      atr: norm(input?.atr ?? session?.atr),
      avgAtr: norm(input?.avgAtr ?? session?.avgAtr),
      recentHigh: norm(input?.recentHigh),
      recentLow: norm(input?.recentLow),
    };
  }

  private computeUnrealizedPnlPct(session: SymbolSession, markPrice: number): number {
    const pos = session.lastState.position;
    if (!pos || !(markPrice > 0) || !(pos.entryPrice > 0)) return 0;
    if (pos.side === 'LONG') return (markPrice - pos.entryPrice) / pos.entryPrice;
    return (pos.entryPrice - markPrice) / pos.entryPrice;
  }

  private computeBreakEvenPrice(session: SymbolSession): number | null {
    const position = session.lastState.position;
    if (!position) return null;
    const qty = Math.abs(Number(position.qty) || 0);
    const entryPrice = Number(position.entryPrice) || 0;
    if (!(qty > 0) || !(entryPrice > 0)) return null;

    const trade = session.currentTrade;
    const netCarry = trade
      ? Number(trade.pnlRealized || 0) - Number(trade.feeAcc || 0) + Number(trade.fundingAcc || 0)
      : 0;
    const configuredFeeRate = Number(this.config?.takerFeeRate ?? DEFAULT_TAKER_FEE_RATE);
    const feeRate = Number.isFinite(configuredFeeRate)
      ? clampNumber(configuredFeeRate, DEFAULT_TAKER_FEE_RATE, 0, 0.1)
      : DEFAULT_TAKER_FEE_RATE;

    let breakEven = entryPrice;
    if (position.side === 'LONG') {
      const denom = qty * Math.max(1e-6, 1 - feeRate);
      breakEven = ((qty * entryPrice) - netCarry) / denom;
    } else {
      const denom = qty * (1 + feeRate);
      breakEven = ((qty * entryPrice) + netCarry) / denom;
    }

    if (!Number.isFinite(breakEven) || !(breakEven > 0)) return entryPrice;
    return breakEven;
  }

  private computeSpreadPct(book: DryRunOrderBook): number | null {
    const bestBid = book.bids?.[0]?.price ?? 0;
    const bestAsk = book.asks?.[0]?.price ?? 0;
    if (!(bestBid > 0) || !(bestAsk > 0)) return null;
    const mid = (bestBid + bestAsk) / 2;
    return mid > 0 ? (bestAsk - bestBid) / mid : null;
  }

  private computeBookMidPrice(book: DryRunOrderBook): number | null {
    const bestBid = book.bids?.[0]?.price ?? 0;
    const bestAsk = book.asks?.[0]?.price ?? 0;
    if (!(bestBid > 0) || !(bestAsk > 0)) return null;
    const mid = (bestBid + bestAsk) / 2;
    return mid > 0 ? mid : null;
  }

  private computeBookMarkDeviationPct(book: DryRunOrderBook, markPrice: number | null | undefined): number | null {
    if (!(Number(markPrice) > 0)) return null;
    const mid = this.computeBookMidPrice(book);
    if (!(mid && mid > 0)) return null;
    return Math.abs(mid - Number(markPrice)) / Number(markPrice);
  }

  private buildAiLimitOrder(
    session: SymbolSession,
    side: 'BUY' | 'SELL',
    qty: number,
    reduceOnly: boolean,
    reasonCode: DryRunReasonCode
  ): DryRunOrderRequest | null {
    if (!(qty > 0)) return null;
    const bestBid = Number(session.lastOrderBook.bids?.[0]?.price || 0);
    const bestAsk = Number(session.lastOrderBook.asks?.[0]?.price || 0);
    const mark = Number(session.latestMarkPrice || 0);
    let price = side === 'BUY' ? bestAsk : bestBid;
    if (!(price > 0)) {
      price = mark;
    }
    if (!(price > 0)) {
      return null;
    }
    return {
      side,
      type: 'LIMIT',
      qty: roundTo(qty, 6),
      price: roundTo(price, 6),
      timeInForce: 'IOC',
      reduceOnly,
      postOnly: false,
      reasonCode,
    };
  }

  private buildAiPostOnlyEntryOrder(
    session: SymbolSession,
    side: 'BUY' | 'SELL',
    qty: number,
    reasonCode: DryRunReasonCode,
    forcePostOnlyFromPolicy = false
  ): DryRunOrderRequest | null {
    if (!(qty > 0)) return null;
    if (!this.isAiExecutionHealthy(session)) return null;

    const bestBid = Number(session.lastOrderBook.bids?.[0]?.price || 0);
    const bestAsk = Number(session.lastOrderBook.asks?.[0]?.price || 0);
    const bidQty = Number(session.lastOrderBook.bids?.[0]?.qty || 0);
    const askQty = Number(session.lastOrderBook.asks?.[0]?.qty || 0);
    if (!(bestBid > 0) || !(bestAsk > 0)) return null;

    const forcePostOnlyEnv = ['1', 'true', 'yes', 'on'].includes(
      String(process.env.STRAT_ENTRY_POST_ONLY || 'false').trim().toLowerCase()
    );
    const entryCancelStreak = Math.max(0, Number(session.aiEntryCancelStreak || 0));
    const isSeedEntry = reasonCode === 'STRAT_ENTRY';
    const forcePostOnly = !isSeedEntry && (forcePostOnlyFromPolicy || forcePostOnlyEnv);
    if (isSeedEntry && entryCancelStreak >= DEFAULT_STRAT_ENTRY_CANCEL_STREAK_TRIGGER) {
      return {
        side,
        type: 'MARKET',
        qty: roundTo(qty, 6),
        timeInForce: 'IOC',
        reduceOnly: false,
        postOnly: false,
        reasonCode,
      };
    }
    if (!forcePostOnly) {
      const aggressiveLimit = side === 'BUY' ? bestAsk : bestBid;
      return {
        side,
        type: 'LIMIT',
        qty: roundTo(qty, 6),
        price: roundTo(aggressiveLimit, 6),
        timeInForce: 'IOC',
        reduceOnly: false,
        postOnly: false,
        reasonCode,
        minFillRatio: isSeedEntry ? Math.min(DEFAULT_ENTRY_MIN_FILL_RATIO, 0.1) : DEFAULT_ENTRY_MIN_FILL_RATIO,
        cancelOnMinFillMiss: true,
      };
    }

    const microprice = (bidQty > 0 && askQty > 0)
      ? ((bestAsk * bidQty) + (bestBid * askQty)) / (bidQty + askQty)
      : ((bestBid + bestAsk) / 2);
    const offsetBps = clampNumber(process.env.MICROPRICE_OFFSET_BPS, 1.5, 0.1, 25);
    const offset = offsetBps / 10_000;

    // Use touch maker price (best bid/ask) for quicker fills while staying post-only.
    const passiveTouch = side === 'BUY' ? bestBid : bestAsk;
    const microBiased = side === 'BUY'
      ? microprice * (1 - offset)
      : microprice * (1 + offset);
    const rawPrice = side === 'BUY'
      ? Math.max(passiveTouch, Math.min(bestAsk * (1 - 1e-8), microBiased))
      : Math.min(passiveTouch, Math.max(bestBid * (1 + 1e-8), microBiased));
    const price = roundTo(rawPrice, 6);
    if (!(price > 0)) return null;

    const ttlMs = Math.max(250, Math.trunc(clampNumber(process.env.LIMIT_TTL_MS, 4000, 250, 10_000)));
    return {
      side,
      type: 'LIMIT',
      qty: roundTo(qty, 6),
      price,
      timeInForce: 'GTC',
      reduceOnly: false,
      postOnly: true,
      ttlMs,
      reasonCode,
      minFillRatio: DEFAULT_ENTRY_MIN_FILL_RATIO,
      cancelOnMinFillMiss: true,
    };
  }

  private stagePendingStrategyEntry(
    session: SymbolSession,
    action: StrategyDecision['actions'][number],
    decision: StrategyDecision,
    referencePrice: number,
    leverage: number | null,
    timestampMs: number
  ): void {
    session.pendingEntry = {
      reason: 'STRATEGY_SIGNAL',
      signalType: action.reason || decision.regime || null,
      signalScore: Number.isFinite(decision.dfs) ? Number(decision.dfs) : null,
      candidate: session.lastSignal?.candidate ?? null,
      orderflow: session.lastSignal?.orderflow ?? this.buildOrderflowMetrics(undefined, session),
      boost: session.lastSignal?.boost,
      market: session.lastSignal?.market ?? this.buildMarketMetrics({ price: referencePrice, atr: session.atr, avgAtr: session.avgAtr }, session),
      timestampMs,
      leverage,
    };
  }

  private shouldForceAIDustCleanup(
    session: SymbolSession,
    position: NonNullable<DryRunStateSnapshot['position']>,
    markPrice: number
  ): boolean {
    if (!this.isAIAutonomousRun()) return false;
    const hasOpenReduceOnly = session.lastState.openLimitOrders.some((o) => Boolean(o.reduceOnly));
    const hasQueuedReduceOnly = session.manualOrders.some((o) => Boolean(o.reduceOnly));
    if (hasOpenReduceOnly || hasQueuedReduceOnly) return false;

    const qty = Math.max(0, Number(position.qty || 0));
    if (!(qty > 0)) return false;
    const priceRef = Math.max(0, Number(markPrice || 0), Number(position.entryPrice || 0));
    const notional = qty * priceRef;
    if (qty <= DEFAULT_DUST_MIN_QTY) return true;
    if (notional > 0 && notional <= DEFAULT_DUST_MIN_NOTIONAL_USDT) return true;
    return false;
  }

  private isAiExecutionHealthy(session: SymbolSession): boolean {
    const spreadPct = this.computeSpreadPct(session.lastOrderBook);
    if (spreadPct == null) return false;
    if (spreadPct > this.getEffectiveMaxSpreadPct(session)) return false;
    const bookMarkDeviationPct = this.computeBookMarkDeviationPct(session.lastOrderBook, session.latestMarkPrice || session.lastMarkPrice || 0);
    if (bookMarkDeviationPct != null && bookMarkDeviationPct > DEFAULT_MAX_BOOK_MARK_DEVIATION_PCT) {
      return false;
    }
    const bestBidQty = Number(session.lastOrderBook.bids?.[0]?.qty || 0);
    const bestAskQty = Number(session.lastOrderBook.asks?.[0]?.qty || 0);
    if (!(bestBidQty > 0) || !(bestAskQty > 0)) return false;
    return true;
  }

  private isOrderCleanupReason(reason: string | null | undefined): boolean {
    return reason === 'ENTRY_REMAINDER_CANCELED' || reason === 'ENTRY_CLEANUP_AFTER_EXIT';
  }

  private isExitLikeReasonCode(reasonCode: DryRunReasonCode | null | undefined): boolean {
    return reasonCode === 'STRAT_EXIT'
      || reasonCode === 'STRAT_REVERSAL_EXIT'
      || reasonCode === 'STRAT_REDUCE'
      || reasonCode === 'REDUCE_SOFT'
      || reasonCode === 'REDUCE_EXHAUSTION'
      || reasonCode === 'REDUCE_PARTIAL'
      || reasonCode === 'PROFITLOCK'
      || reasonCode === 'TRAIL_STOP'
      || reasonCode === 'RISK_EMERGENCY'
      || reasonCode === 'HARD_REVERSAL_EXIT';
  }

  private cleanupWorkingStrategyOrdersAfterEvent(
    session: SymbolSession,
    prevPosition: DryRunStateSnapshot['position'],
    nextPosition: DryRunStateSnapshot['position'],
    orderResults: DryRunEventLog['orderResults'],
    eventTimestampMs: number
  ): DryRunEventLog['orderResults'] {
    const filledEntry = orderResults.some((order) => order.reasonCode === 'STRAT_ENTRY' && Number(order.filledQty) > 0);
    const filledExit = orderResults.some((order) => this.isExitLikeReasonCode(order.reasonCode ?? null) && Number(order.filledQty) > 0);
    const flipped = Boolean(prevPosition && nextPosition && prevPosition.side !== nextPosition.side);
    const closed = Boolean(prevPosition && !nextPosition);
    const cancelReason = (filledExit || flipped || closed) ? 'ENTRY_CLEANUP_AFTER_EXIT' : 'ENTRY_REMAINDER_CANCELED';

    const shouldCancelEntryRemainders = Boolean(nextPosition && filledEntry);
    const shouldCancelOpenAdds = filledExit || flipped || closed;
    if (!shouldCancelEntryRemainders && !shouldCancelOpenAdds) {
      return [];
    }

    return session.engine.cancelPendingLimits(
      eventTimestampMs,
      (order) => {
        if (order.reduceOnly) return false;
        if (order.reasonCode === 'STRAT_ENTRY') return shouldCancelEntryRemainders || shouldCancelOpenAdds;
        if (order.reasonCode === 'STRAT_ADD') return shouldCancelOpenAdds;
        return false;
      },
      cancelReason
    );
  }

  private syncWorkingOrderLogState(session: SymbolSession): void {
    const liveOrderIds = new Set((session.lastState.openLimitOrders || []).map((order) => order.orderId));
    for (const orderId of Array.from(session.workingOrderLogState.keys())) {
      if (!liveOrderIds.has(orderId)) {
        session.workingOrderLogState.delete(orderId);
      }
    }
  }

  private logOrderResult(
    session: SymbolSession,
    symbol: string,
    order: DryRunEventLog['orderResults'][number],
    eventTimestampMs: number
  ): void {
    const filledQty = roundTo(Number(order.filledQty || 0), 6);
    const requestedQty = roundTo(Number(order.requestedQty || 0), 6);
    const remainingQty = roundTo(Number(order.remainingQty || 0), 6);
    const avgFillPrice = roundTo(Number(order.avgFillPrice || 0), 4);

    if (order.status === 'NEW' && filledQty <= 0) {
      const fingerprint = [order.status, requestedQty, remainingQty, order.reasonCode || '', order.postOnly ? '1' : '0'].join('|');
      if (session.workingOrderLogState.get(order.orderId) === fingerprint) {
        return;
      }
      session.workingOrderLogState.set(order.orderId, fingerprint);
      const workingLabel = order.postOnly ? 'Working maker order' : 'Working limit order';
      this.addConsoleLog(
        'INFO',
        symbol,
        `${workingLabel}: ${order.side} pending=${remainingQty}/${requestedQty} reason=${order.reasonCode || 'n/a'}`,
        eventTimestampMs
      );
      return;
    }

    session.workingOrderLogState.delete(order.orderId);
    this.addConsoleLog(
      'INFO',
      symbol,
      `Order ${order.type}/${order.side} ${order.status} fill=${filledQty}/${requestedQty} remaining=${remainingQty} avg=${avgFillPrice}`,
      eventTimestampMs
    );
  }

  private hasLiveWorkingOrderForSide(session: SymbolSession, side: 'BUY' | 'SELL'): boolean {
    const hasOpen = session.lastState.openLimitOrders.some((o) => o.side === side && !o.reduceOnly);
    if (hasOpen) return true;
    return session.manualOrders.some((o) => o.side === side && o.type === 'LIMIT' && !o.reduceOnly);
  }

  private hasLiveReduceOnlyOrderForPosition(session: SymbolSession, positionSide: 'LONG' | 'SHORT'): boolean {
    const closeSide: 'BUY' | 'SELL' = positionSide === 'LONG' ? 'SELL' : 'BUY';
    const hasOpen = session.lastState.openLimitOrders.some((o) => o.side === closeSide && Boolean(o.reduceOnly));
    if (hasOpen) return true;
    return session.manualOrders.some((o) => o.side === closeSide && Boolean(o.reduceOnly));
  }

  private hasPendingCloseAction(session: SymbolSession, positionSide: 'LONG' | 'SHORT', nowMs: number): boolean {
    const pending = session.pendingCloseAction;
    if (!pending) return false;
    if (pending.side !== positionSide) return false;
    if (nowMs >= pending.expiresAtMs) {
      session.pendingCloseAction = null;
      return false;
    }
    return true;
  }

  private armPendingCloseAction(
    session: SymbolSession,
    kind: 'EXIT' | 'REVERSAL',
    side: 'LONG' | 'SHORT',
    nowMs: number
  ): void {
    session.pendingCloseAction = {
      kind,
      side,
      expiresAtMs: nowMs + DEFAULT_PENDING_CLOSE_GUARD_MS,
    };
  }

  private clearPendingCloseAction(session: SymbolSession, side?: 'LONG' | 'SHORT' | null): void {
    if (!session.pendingCloseAction) return;
    if (!side || session.pendingCloseAction.side === side) {
      session.pendingCloseAction = null;
    }
  }

  private shouldBlockAiEntryByCooldown(session: SymbolSession, symbol: string, nowMs: number): boolean {
    if (session.aiEntryCooldownUntilMs <= nowMs) {
      return false;
    }
    if (nowMs - session.lastAiEntryCooldownLogTs >= 5000) {
      const waitMs = Math.max(0, session.aiEntryCooldownUntilMs - nowMs);
      this.addConsoleLog('WARN', symbol, `Strategy entry cooldown active (${waitMs}ms remaining)`, nowMs);
      session.lastAiEntryCooldownLogTs = nowMs;
    }
    return true;
  }

  private resetAiEntryBackoff(session: SymbolSession): void {
    session.aiEntryCancelStreak = 0;
    session.aiEntryCooldownUntilMs = 0;
    session.lastAiEntryCooldownLogTs = 0;
  }

  private registerAiEntryOrderOutcome(session: SymbolSession, symbol: string, order: DryRunEventLog['orderResults'][number], eventTimestampMs: number): void {
    if (order.reasonCode !== 'STRAT_ENTRY') return;

    const filledQty = Math.max(0, Number(order.filledQty || 0));
    if ((order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED') && filledQty > 0) {
      this.resetAiEntryBackoff(session);
      return;
    }

    const isEntryCancelWithoutFill = order.status === 'CANCELED' && filledQty <= 0 && order.reason === 'LIMIT_TTL_CANCEL';
    if (!isEntryCancelWithoutFill) return;

    session.aiEntryCancelStreak += 1;
    if (session.aiEntryCancelStreak < DEFAULT_STRAT_ENTRY_CANCEL_STREAK_TRIGGER) return;

    const backoffExponent = session.aiEntryCancelStreak - DEFAULT_STRAT_ENTRY_CANCEL_STREAK_TRIGGER;
    const cooldownMs = Math.min(
      DEFAULT_STRAT_ENTRY_CANCEL_MAX_COOLDOWN_MS,
      Math.round(DEFAULT_STRAT_ENTRY_CANCEL_BASE_COOLDOWN_MS * Math.pow(DEFAULT_STRAT_ENTRY_CANCEL_BACKOFF_MULT, Math.max(0, backoffExponent)))
    );
    const nextAllowedTs = eventTimestampMs + cooldownMs;
    if (nextAllowedTs > session.aiEntryCooldownUntilMs) {
      session.aiEntryCooldownUntilMs = nextAllowedTs;
      this.addConsoleLog(
        'WARN',
        symbol,
        `Strategy entry paused for ${cooldownMs}ms after ${session.aiEntryCancelStreak} consecutive unfilled TTL cancels`,
        eventTimestampMs
      );
      session.lastAiEntryCooldownLogTs = eventTimestampMs;
    }
  }

  private extractAIPlan(metadata?: Record<string, unknown>): AIIntentMetadata | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const candidate = (metadata as AIActionMetadata).plan;
    if (!candidate || typeof candidate !== 'object') return null;
    return candidate;
  }

  private extractStrictThreeMMeta(metadata?: Record<string, unknown>): {
    enabled: boolean;
    addPct: number;
    maxExposureMultiplier: number;
    allowReduceBelowNotional: boolean;
    maxPositionNotional: number | null;
  } {
    const raw = (metadata || {}) as AIActionMetadata;
    const enabled = Boolean(raw.strictThreeMMode);
    const addPct = clampNumber(raw.strictAddPct, 0.2, 0.01, 1);
    const maxExposureMultiplier = clampNumber(raw.maxExposureMultiplier, 1.5, 1, 3);
    const allowReduceBelowNotional = Boolean(raw.allowReduceBelowNotional);
    const maxPositionNotional = Number.isFinite(raw.maxPositionNotional as number)
      ? Math.max(0, Number(raw.maxPositionNotional))
      : null;
    return {
      enabled,
      addPct,
      maxExposureMultiplier,
      allowReduceBelowNotional,
      maxPositionNotional,
    };
  }

  private computeStrictAISizing(
    session: SymbolSession,
    price: number,
    input: {
      mode: 'ENTRY' | 'ADD';
      addPct?: number;
      maxExposureMultiplier?: number;
    }
  ): { qty: number; leverage: number } {
    if (!this.config || !(price > 0)) return { qty: 0, leverage: session.dynamicLeverage || 1 };

    const leverage = session.dynamicLeverage || this.getSessionBaseLeverage(session) || 1;
    const initialMarginUsdt = Number(this.getSessionInitialMarginUsdt(session) || 0);
    const seedNotional = Math.max(0, initialMarginUsdt * Math.max(1, leverage));
    const reserveBasisUsdt = Math.max(
      initialMarginUsdt,
      Number(this.getSessionEffectiveReserveUsdt(session) || 0),
      Number(this.getSessionConfiguredReserveUsdt(session) || 0),
    );
    const reserveNotionalCap = Math.max(0, reserveBasisUsdt * Math.max(1, leverage));

    if (!(seedNotional > 0)) return { qty: 0, leverage };

    const sizingParams = this.config.sizing || {};
    const legacyCap = Boolean(sizingParams.legacyNotionalCap);
    const maxPositionNotional = sizingParams.maxPositionNotional ?? reserveNotionalCap;
    const entrySplit = sizingParams.entrySplit ?? [0.60, 0.40];
    const addMode = sizingParams.addMode ?? 'SPLIT_OF_ENTRY';

    const currentNotional = session.lastState.position
      ? Math.max(0, Number(session.lastState.position.qty || 0) * price)
      : 0;

    let openNotional = 0;

    if (legacyCap) {
      const maxExposureNotional = seedNotional * clampNumber(input.maxExposureMultiplier, 1.5, 1, 3);
      const remainingExposure = Math.max(0, maxExposureNotional - currentNotional);
      if (!(remainingExposure > 0)) return { qty: 0, leverage };

      if (input.mode === 'ENTRY') {
        openNotional = Math.max(0, Math.min(seedNotional - currentNotional, remainingExposure));
      } else {
        const addPct = clampNumber(input.addPct, 0.2, 0.01, 1);
        const desired = currentNotional * addPct;
        openNotional = Math.max(0, Math.min(desired, remainingExposure));
      }
    } else {
      if (input.mode === 'ADD') {
        let addNotional = 0;
        if (input.addPct != null && input.addPct > 0) {
          addNotional = currentNotional * clampNumber(input.addPct, 0.2, 0.01, 1);
        } else {
          if (addMode === 'SPLIT_OF_ENTRY') {
            const addsUsed = session.addOnState?.count ?? 0;
            const splitIndex = addsUsed + 1;
            if (splitIndex < entrySplit.length) {
              addNotional = seedNotional * (entrySplit[splitIndex] ?? 0);
            } else {
              addNotional = 0;
            }
          } else {
            addNotional = seedNotional; // FIXED_MARGIN (addMargin defaults to seed basis)
          }
        }

        if (maxPositionNotional !== Number.POSITIVE_INFINITY && maxPositionNotional != null) {
          const remaining = maxPositionNotional - currentNotional;
          if (remaining <= 0) {
            addNotional = 0;
          } else {
            addNotional = Math.min(addNotional, remaining);
          }
        }
        openNotional = Math.max(0, addNotional);
      } else {
        // Initial margin is the seed budget and should map 1:1 to the first entry.
        const remaining = maxPositionNotional - currentNotional;
        openNotional = remaining <= 0 ? 0 : Math.max(0, Math.min(seedNotional, remaining));
      }
    }

    const qty = roundTo(Math.max(0, openNotional / price), 6);
    return { qty, leverage };
  }

  private computeStrictReduceQty(
    session: SymbolSession,
    referencePrice: number,
    input: {
      reducePct: number;
      allowReduceBelowNotional: boolean;
      maxPositionNotional: number | null;
    }
  ): { qty: number } {
    if (!this.config || !(referencePrice > 0) || !session.lastState.position) return { qty: 0 };
    const fullQty = Math.max(0, Number(session.lastState.position.qty || 0));
    if (!(fullQty > 0)) return { qty: 0 };

    const leverage = session.dynamicLeverage || this.getSessionBaseLeverage(session) || 1;
    const defaultMaxNotional = Math.max(0, Number(this.getSessionInitialMarginUsdt(session) || 0) * Math.max(1, leverage));
    const maxPositionNotional = input.maxPositionNotional != null ? input.maxPositionNotional : defaultMaxNotional;
    const currentNotional = fullQty * referencePrice;
    const desiredNotional = Math.max(0, currentNotional * clampNumber(input.reducePct, 0.5, 0.1, 1));

    let reducibleNotional = desiredNotional;
    if (!input.allowReduceBelowNotional) {
      const floorNotional = Math.max(0, maxPositionNotional);
      const maxReducible = Math.max(0, currentNotional - floorNotional);
      reducibleNotional = Math.min(desiredNotional, maxReducible);
    }

    const qty = roundTo(Math.max(0, reducibleNotional / referencePrice), 6);
    return { qty };
  }

  private normalizeAIEntryStyle(value?: string): 'LIMIT' | 'MARKET_SMALL' | 'HYBRID' {
    return 'LIMIT';
  }

  private normalizeAIUrgency(value?: string): 'LOW' | 'MED' | 'HIGH' {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'LOW' || normalized === 'MED' || normalized === 'HIGH') {
      return normalized;
    }
    return 'MED';
  }

  private computePositionTimeInMs(session: SymbolSession, nowMs: number): number {
    const position = session.lastState.position;
    if (!position) return 0;
    const entryTsRaw = Number(position.entryTimestampMs);
    const fallbackTs = Number(session.lastEntryOrAddOnTs || session.lastEventTimestampMs || 0);
    const entryTs = Number.isFinite(entryTsRaw) && entryTsRaw > 0 ? entryTsRaw : fallbackTs;
    if (!(entryTs > 0) || !(nowMs > 0)) return 0;
    return Math.max(0, nowMs - entryTs);
  }

  private isAIAutonomousRun(): boolean {
    // RunId must not decide whether the 3m trend strategy uses autonomous execution.
    // All dry-run strategy sessions should follow the same execution path.
    return Boolean(this.config);
  }

  private computeRiskSizing(
    session: SymbolSession,
    price: number,
    regime: StrategyRegime,
    sizeMultiplier = 1,
    options?: { mode?: 'ENTRY' | 'ADD'; incrementalRiskCapPct?: number }
  ): { qty: number; leverage: number } {
    if (!this.config || !(price > 0)) return { qty: 0, leverage: session.dynamicLeverage || 1 };

    const leverage = session.dynamicLeverage || this.getSessionBaseLeverage(session) || 1;
    const initialMarginUsdt = Number(this.getSessionInitialMarginUsdt(session) || 0);
    const seedNotional = Math.max(0, initialMarginUsdt * Math.max(1, leverage));
    const reserveBasisUsdt = Math.max(
      initialMarginUsdt,
      Number(this.getSessionEffectiveReserveUsdt(session) || 0),
      Number(this.getSessionConfiguredReserveUsdt(session) || 0),
    );
    const reserveNotionalCap = Math.max(0, reserveBasisUsdt * Math.max(1, leverage));

    if (!(seedNotional > 0)) return { qty: 0, leverage };

    const sizingParams = this.config.sizing || {};
    const legacyCap = Boolean(sizingParams.legacyNotionalCap);
    // MODEL A Default Split Array: [ENTRY, ADD1, ADD2] -> [0.50, 0.30, 0.20]
    const entrySplit = sizingParams.entrySplit ?? [0.50, 0.30, 0.20];
    const addMode = sizingParams.addMode ?? 'SPLIT_OF_ENTRY';
    const maxPositionNotional = sizingParams.maxPositionNotional ?? reserveNotionalCap;

    const rawMultiplier = Number(sizeMultiplier || 1);
    const normalizedMultiplier = this.isAIAutonomousRun()
      ? clampNumber(rawMultiplier, 1, 0.05, 4)
      : Math.max(0.05, Math.min(2, rawMultiplier));

    const currentNotional = session.lastState.position
      ? Math.max(0, Number(session.lastState.position.qty || 0) * price)
      : 0;

    let openingNotional = 0;

    if (legacyCap) {
      // Legacy behavior: seed notional is a hard cap for the whole position
      const baseEntryPct = clampNumber(process.env.BASE_ENTRY_PCT, 0.35, 0.25, 0.55);
      const baseNotional = seedNotional * baseEntryPct;
      const requestedNotional = Math.max(0, baseNotional * normalizedMultiplier);

      const availableNotional = options?.mode === 'ADD'
        ? Math.max(0, seedNotional - currentNotional)
        : seedNotional;

      const incrementalCapPct = Number.isFinite(options?.incrementalRiskCapPct as number)
        ? clampNumber(options?.incrementalRiskCapPct, 1, 0.05, 1)
        : 1;
      const cappedByIncremental = seedNotional * incrementalCapPct;

      openingNotional = Math.max(0, Math.min(requestedNotional, availableNotional, cappedByIncremental));
    } else {
      // New behavior: ENTRY and ADD are sized independently
      if (options?.mode === 'ADD') {
        let addNotional = 0;

        if (addMode === 'FIXED_MARGIN') {
          addNotional = seedNotional * normalizedMultiplier;
        } else {
          // 'SPLIT_OF_ENTRY' (Model A) -> Index is bounded by addsUsed
          const addsUsed = session.addOnState?.count ?? 0;
          // Split index relies on maxAdds = 2. So length max is [0], [1], [2]. Since entry is [0], add1 is [1], add2 is [2]
          const splitIndex = addsUsed + 1;

          if (splitIndex < entrySplit.length) {
            const addTarget = seedNotional * (entrySplit[splitIndex] ?? 0);
            addNotional = addTarget * normalizedMultiplier;
          } else {
            // Reached out of bounds, veto the add.
            addNotional = 0;
          }
        }

        if (maxPositionNotional !== Number.POSITIVE_INFINITY && maxPositionNotional != null) {
          const remaining = maxPositionNotional - currentNotional;
          if (remaining <= 0) {
            addNotional = 0; // Veto (skip)
          } else {
            addNotional = Math.min(addNotional, remaining);
          }
        }
        openingNotional = Math.max(0, addNotional);
      } else {
        // Initial margin is the seed budget and should map 1:1 to the first entry.
        const remaining = maxPositionNotional - currentNotional;
        if (remaining <= 0) {
          openingNotional = 0;
        } else {
          const requestedNotional = seedNotional * normalizedMultiplier;
          openingNotional = Math.max(0, Math.min(requestedNotional, seedNotional, remaining));
        }
      }
    }

    const qty = roundTo(Math.max(0, openingNotional / price), 6);
    return { qty, leverage };
  }

  private getHoldRemainingMs(session: SymbolSession, nowMs: number): number {
    if (!session.lastEntryOrAddOnTs || nowMs <= 0) return 0;
    return Math.max(0, DEFAULT_MIN_HOLD_MS - (nowMs - session.lastEntryOrAddOnTs));
  }

  private buildFlipState(session: SymbolSession, confirmTicks?: number, lastOppositeSide?: 'LONG' | 'SHORT' | null) {
    const state = session.flipGovernor.getState();
    return {
      confirmTicks: Number.isFinite(confirmTicks as number) ? Number(confirmTicks) : state.confirmTicks,
      requiredTicks: DEFAULT_FLIP_CONFIRM_TICKS,
      lastOppositeSide: lastOppositeSide ?? state.lastOppositeSide,
      partialReduced: session.flipState.partialReduced,
    };
  }

  private logAction(session: SymbolSession, payload: {
    reasonCode: DryRunReasonCode;
    timestampMs: number;
    signalType: string | null;
    signalScore: number | null;
    signalSide: 'LONG' | 'SHORT' | null;
    unrealizedPnlPct: number;
    feePaidIncrement: number;
    spreadPct: number | null;
    impactEstimate: number | null;
    addonIndex: number | null;
    flipState: {
      confirmTicks: number;
      requiredTicks: number;
      lastOppositeSide: 'LONG' | 'SHORT' | null;
      partialReduced: boolean;
    } | null;
    holdRemainingMs: number;
  }): void {
    if (!this.tradeLogger || !this.tradeLogEnabled) return;
    this.tradeLogger.log({
      type: 'ACTION',
      runId: this.getRunId(),
      symbol: session.symbol,
      timestampMs: payload.timestampMs,
      reason_code: payload.reasonCode,
      signalType: payload.signalType,
      signalScore: payload.signalScore,
      signalSide: payload.signalSide,
      unrealizedPnlPct: Number(payload.unrealizedPnlPct.toFixed(6)),
      feePaid_increment: Number(payload.feePaidIncrement.toFixed(8)),
      spread_pct: payload.spreadPct == null ? null : Number(payload.spreadPct.toFixed(6)),
      impact_estimate: payload.impactEstimate == null ? null : Number(payload.impactEstimate.toFixed(6)),
      addonIndex: payload.addonIndex,
      flipState: payload.flipState,
      holdRemainingMs: payload.holdRemainingMs,
    });
  }

  private hasPendingAddOn(session: SymbolSession): boolean {
    if (session.addOnState.pendingClientOrderId) return true;
    if (session.manualOrders.some((o) => o.reasonCode === 'ADDON_MAKER')) return true;
    return session.lastState.openLimitOrders.some((o) => o.reasonCode === 'ADDON_MAKER');
  }

  private buildAddOnClientOrderId(session: SymbolSession, addonIndex: number, attempt: number): string {
    return `addon-${this.getRunId()}-${session.symbol}-${addonIndex}-${attempt}`;
  }

  private tryQueueAddOn(
    session: SymbolSession,
    signal: StrategySignal,
    signalTs: number,
    side: 'BUY' | 'SELL',
    orderflow: DryRunOrderflowMetrics,
    market: ReturnType<DryRunSessionService['buildMarketMetrics']>
  ): void {
    const position = session.lastState.position;
    if (!position) return;

    const unrealizedPnlPct = this.computeUnrealizedPnlPct(session, session.latestMarkPrice || position.entryPrice);
    const addonIndex = session.addOnState.count + 1;
    const decision = this.addOnManager.buildAddOnOrder({
      side: position.side,
      positionQty: position.qty,
      markPrice: session.latestMarkPrice || position.entryPrice,
      unrealizedPnlPct,
      signalScore: signal.score,
      book: session.lastOrderBook,
      nowMs: signalTs,
      lastAddOnTs: session.addOnState.lastAddOnTs,
      addonCount: session.addOnState.count,
      addonIndex,
      hasPendingAddOn: this.hasPendingAddOn(session),
    });

    if (!decision) return;
    const clientOrderId = this.buildAddOnClientOrderId(session, decision.addonIndex, 0);
    session.manualOrders.push({
      ...decision.order,
      clientOrderId,
      repriceAttempt: 0,
    });
    session.addOnState.pendingClientOrderId = clientOrderId;
    session.addOnState.pendingAddonIndex = decision.addonIndex;
    session.addOnState.pendingAttempt = 0;

    if (!session.pendingEntry) {
      session.pendingEntry = {
        reason: 'STRATEGY_SIGNAL',
        signalType: signal.signal as string,
        signalScore: signal.score,
        candidate: signal.candidate,
        orderflow,
        boost: signal.boost,
        market,
        timestampMs: signalTs,
        leverage: session.dynamicLeverage,
      };
    }
  }

  private tryFlipInvalidation(
    session: SymbolSession,
    signal: StrategySignal,
    signalTs: number,
    side: 'BUY' | 'SELL',
    orderflow: DryRunOrderflowMetrics,
    market: ReturnType<DryRunSessionService['buildMarketMetrics']>
  ): void {
    const position = session.lastState.position;
    if (!position) return;

    const spreadPct = this.computeSpreadPct(session.lastOrderBook);
    const holdRemainingMs = this.getHoldRemainingMs(session, signalTs);
    if (spreadPct != null && spreadPct > this.getEffectiveMaxSpreadPct(session)) {
      this.logAction(session, {
        reasonCode: 'FLIP_BLOCKED',
        timestampMs: signalTs,
        signalType: signal.signal,
        signalScore: signal.score,
        signalSide: side === 'BUY' ? 'LONG' : 'SHORT',
        unrealizedPnlPct: this.computeUnrealizedPnlPct(session, session.latestMarkPrice || position.entryPrice),
        feePaidIncrement: 0,
        spreadPct,
        impactEstimate: null,
        addonIndex: null,
        flipState: this.buildFlipState(session),
        holdRemainingMs,
      });
      return;
    }

    const flipThreshold = DEFAULT_ENTRY_SIGNAL_MIN + (DEFAULT_FLIP_HYSTERESIS * 100);
    const decision = session.flipGovernor.evaluate({
      minHoldMs: DEFAULT_MIN_HOLD_MS,
      deadbandPct: DEFAULT_FLIP_DEADBAND_PCT,
      confirmTicks: DEFAULT_FLIP_CONFIRM_TICKS,
      flipScoreThreshold: flipThreshold,
    }, {
      nowMs: signalTs,
      lastEntryOrAddOnTs: session.lastEntryOrAddOnTs,
      unrealizedPnlPct: this.computeUnrealizedPnlPct(session, session.latestMarkPrice || position.entryPrice),
      signalScore: signal.score,
      oppositeSide: side === 'BUY' ? 'LONG' : 'SHORT',
    });

    const flipState = this.buildFlipState(session, decision.confirmTicks, decision.lastOppositeSide);
    if (!decision.confirmed) {
      this.logAction(session, {
        reasonCode: 'FLIP_BLOCKED',
        timestampMs: signalTs,
        signalType: signal.signal,
        signalScore: signal.score,
        signalSide: side === 'BUY' ? 'LONG' : 'SHORT',
        unrealizedPnlPct: this.computeUnrealizedPnlPct(session, session.latestMarkPrice || position.entryPrice),
        feePaidIncrement: 0,
        spreadPct,
        impactEstimate: null,
        addonIndex: null,
        flipState,
        holdRemainingMs: decision.holdRemainingMs,
      });
      return;
    }

    this.logAction(session, {
      reasonCode: 'FLIP_CONFIRMED',
      timestampMs: signalTs,
      signalType: signal.signal,
      signalScore: signal.score,
      signalSide: side === 'BUY' ? 'LONG' : 'SHORT',
      unrealizedPnlPct: this.computeUnrealizedPnlPct(session, session.latestMarkPrice || position.entryPrice),
      feePaidIncrement: 0,
      spreadPct,
      impactEstimate: null,
      addonIndex: null,
      flipState,
      holdRemainingMs: 0,
    });

    if (!session.flipState.partialReduced) {
      const reduceQty = roundTo(position.qty * 0.4, 6);
      if (reduceQty > 0) {
        session.manualOrders.push({
          side: position.side === 'LONG' ? 'SELL' : 'BUY',
          type: 'MARKET',
          qty: reduceQty,
          timeInForce: 'IOC',
          reduceOnly: true,
          reasonCode: 'REDUCE_PARTIAL',
        });
        session.flipState.partialReduced = true;
        session.flipState.lastPartialReduceTs = signalTs;
      }
      return;
    }

    const closeQty = roundTo(position.qty, 6);
    if (closeQty > 0) {
      session.manualOrders.push({
        side: position.side === 'LONG' ? 'SELL' : 'BUY',
        type: 'MARKET',
        qty: closeQty,
        timeInForce: 'IOC',
        reduceOnly: true,
        reasonCode: 'FLIP_CONFIRMED',
      });
      session.pendingExitReason = 'HARD_INVALIDATION';
      session.pendingFlipEntry = {
        side,
        signalType: signal.signal as string,
        signalScore: signal.score,
        candidate: signal.candidate,
        orderflow,
        boost: signal.boost,
        market,
        timestampMs: signalTs,
        leverage: session.dynamicLeverage,
      };
    }
  }

  private handleOrderActions(
    session: SymbolSession,
    orderResults: DryRunEventLog['orderResults'],
    markPrice: number,
    spreadPct: number | null,
    eventTimestampMs: number
  ): void {
    const holdRemainingMs = this.getHoldRemainingMs(session, eventTimestampMs);
    const unrealizedPnlPct = this.computeUnrealizedPnlPct(session, markPrice);
    const signalType = session.lastSignal?.signalType ?? null;
    const signalScore = session.lastSignal?.score ?? null;
    const signalSide = session.lastSignal?.side ?? null;
    const flipState = this.buildFlipState(session);

    for (const order of orderResults || []) {
      if (order.status === 'NEW') continue;
      this.registerAiEntryOrderOutcome(session, session.symbol, order, eventTimestampMs);
      const reasonCode = order.reasonCode ?? null;
      if (!reasonCode) continue;
      if (
        this.isExitLikeReasonCode(reasonCode)
        && ['CANCELED', 'EXPIRED', 'REJECTED'].includes(String(order.status || ''))
        && Number(order.filledQty || 0) <= 0
      ) {
        this.clearPendingCloseAction(session);
      }
      if (this.isOrderCleanupReason(order.reason)) continue;
      const feePaidIncrement = Number.isFinite(order.fee) ? Number(order.fee) : 0;
      const impactEstimate = Number.isFinite(order.marketImpactBps as number) ? Number(order.marketImpactBps) : null;
      const addonIndex = Number.isFinite(order.addonIndex as number) ? Number(order.addonIndex) : null;

      this.logAction(session, {
        reasonCode,
        timestampMs: eventTimestampMs,
        signalType,
        signalScore,
        signalSide,
        unrealizedPnlPct,
        feePaidIncrement,
        spreadPct,
        impactEstimate,
        addonIndex,
        flipState,
        holdRemainingMs,
      });

      if (reasonCode === 'ENTRY_MARKET' && Number(order.filledQty) > 0) {
        session.lastEntryOrAddOnTs = eventTimestampMs;
      }

      if (reasonCode === 'ADDON_MAKER' && Number(order.filledQty) > 0) {
        session.lastEntryOrAddOnTs = eventTimestampMs;
        session.addOnState.lastAddOnTs = eventTimestampMs;
        if (order.clientOrderId && !session.addOnState.filledClientOrderIds.has(order.clientOrderId)) {
          session.addOnState.filledClientOrderIds.add(order.clientOrderId);
          session.addOnState.count += 1;
        }
      }

      if (reasonCode === 'LIMIT_TTL_CANCEL') {
        this.repriceAddOnIfEligible(session, order, eventTimestampMs);
      }
    }

    this.syncPendingAddOn(session);
  }

  private repriceAddOnIfEligible(session: SymbolSession, order: DryRunEventLog['orderResults'][number], eventTimestampMs: number): void {
    if (!session.lastState.position) return;
    if (!order.clientOrderId || !(Number.isFinite(order.addonIndex as number))) return;
    if (!(Number(order.remainingQty) > 0)) return;
    const attempt = Number.isFinite(order.repriceAttempt as number) ? Number(order.repriceAttempt) : 0;
    if (attempt >= DEFAULT_ADDON_REPRICE_MAX) return;

    const lastSignal = session.lastSignal;
    if (!lastSignal || lastSignal.score < DEFAULT_ADDON_SIGNAL_MIN) return;
    if (lastSignal.side !== session.lastState.position.side) return;

    const spreadPct = this.computeSpreadPct(session.lastOrderBook);
    if (spreadPct != null && spreadPct > this.getEffectiveMaxSpreadPct(session)) return;

    const bestBid = session.lastOrderBook.bids?.[0]?.price ?? 0;
    const bestAsk = session.lastOrderBook.asks?.[0]?.price ?? 0;
    const limitPrice = session.lastState.position.side === 'LONG' ? bestBid : bestAsk;
    if (!(limitPrice > 0)) return;

    const nextAttempt = attempt + 1;
    const clientOrderId = this.buildAddOnClientOrderId(session, Number(order.addonIndex), nextAttempt);
    session.manualOrders.push({
      side: session.lastState.position.side === 'LONG' ? 'BUY' : 'SELL',
      type: 'LIMIT',
      qty: roundTo(Number(order.remainingQty), 6),
      price: roundTo(limitPrice, 8),
      timeInForce: 'GTC',
      reduceOnly: false,
      postOnly: true,
      ttlMs: DEFAULT_ADDON_TTL_MS,
      reasonCode: 'ADDON_MAKER',
      addonIndex: Number(order.addonIndex),
      repriceAttempt: nextAttempt,
      clientOrderId,
      minFillRatio: 0.25,
      cancelOnMinFillMiss: true,
    });

    session.addOnState.pendingClientOrderId = clientOrderId;
    session.addOnState.pendingAddonIndex = Number(order.addonIndex);
    session.addOnState.pendingAttempt = nextAttempt;
    session.addOnState.lastAddOnTs = eventTimestampMs;
  }

  private syncPendingAddOn(session: SymbolSession): void {
    if (!session.addOnState.pendingClientOrderId) return;
    const stillOpen = session.lastState.openLimitOrders.some((o) => o.clientOrderId === session.addOnState.pendingClientOrderId);
    if (!stillOpen) {
      session.addOnState.pendingClientOrderId = null;
      session.addOnState.pendingAddonIndex = null;
      session.addOnState.pendingAttempt = 0;
    }
  }

  private ensureWinnerState(session: SymbolSession, position: NonNullable<DryRunStateSnapshot['position']>, markPrice: number): void {
    if (session.winnerState) return;
    session.winnerState = this.winnerManager.initState({
      entryPrice: position.entryPrice,
      side: position.side,
      atr: session.atr || Math.abs(markPrice - position.entryPrice) * 0.01,
      markPrice,
    });
  }

  private resolveActiveStop(state: WinnerState | null): number | null {
    if (!state) return null;
    const active = state.side === 'LONG'
      ? Math.max(state.profitLockStop ?? -Infinity, state.trailingStop ?? -Infinity)
      : Math.min(state.profitLockStop ?? Infinity, state.trailingStop ?? Infinity);
    return Number.isFinite(active) ? active : null;
  }

  private shouldRiskEmergency(session: SymbolSession, markPrice: number, spreadPct: number | null): boolean {
    const marginHealth = session.lastState.marginHealth;
    if (marginHealth <= 0.05) return true;
    const liquidation = this.computeLiquidationRisk(session, marginHealth);
    if (liquidation.score === 'RED' || liquidation.score === 'CRITICAL') return true;

    const drawdownPct = this.computeUnrealizedPnlPct(session, markPrice);
    if (drawdownPct <= -Math.max(DEFAULT_FLIP_DEADBAND_PCT * 4, 0.012)) return true;

    if (spreadPct != null && spreadPct > this.getEffectiveMaxSpreadPct(session) && session.spreadBreachCount >= 3) {
      return true;
    }
    return false;
  }

  private getEffectiveMaxSpreadPct(session: SymbolSession): number {
    const base = DEFAULT_MAX_SPREAD_PCT;
    const markPrice = Math.max(0, Number(session.latestMarkPrice || session.lastMarkPrice || 0));
    const atr = Math.max(0, Number(session.atr || 0));
    const atrRatio = markPrice > 0 && atr > 0 ? (atr / markPrice) : 0;
    const trendBonus = session.trend.confidence >= 0.65 ? 0.0004 : 0;
    const atrBonus = Math.min(0.0012, atrRatio * 0.25);
    return Math.max(base, Math.min(0.003, base + trendBonus + atrBonus));
  }

  private syncPositionStateAfterEvent(
    session: SymbolSession,
    prevPosition: DryRunStateSnapshot['position'],
    nextPosition: DryRunStateSnapshot['position'],
    eventTimestampMs: number,
    markPrice: number
  ): void {
    if (!prevPosition && nextPosition) {
      this.clearPendingCloseAction(session);
      this.resetAiEntryBackoff(session);
      session.winnerState = this.winnerManager.initState({
        entryPrice: nextPosition.entryPrice,
        side: nextPosition.side,
        atr: session.atr || Math.abs(markPrice - nextPosition.entryPrice) * 0.01,
        markPrice,
      });
      session.stopLossPrice = this.resolveActiveStop(session.winnerState);
      session.addOnState.count = 0;
      session.addOnState.lastAddOnTs = eventTimestampMs;
      session.addOnState.pendingClientOrderId = null;
      session.addOnState.pendingAddonIndex = null;
      session.addOnState.pendingAttempt = 0;
      session.addOnState.filledClientOrderIds.clear();
      session.lastEntryOrAddOnTs = eventTimestampMs;
      session.lastReduceOrderTs = 0;
      session.flipGovernor.reset();
      session.flipState.partialReduced = false;
      session.flipState.lastPartialReduceTs = 0;
      session.peakUnrealizedPnlPct = Math.max(0, this.computeUnrealizedPnlPct(session, markPrice));
      return;
    }

    if (prevPosition && !nextPosition) {
      this.clearPendingCloseAction(session, prevPosition.side);
      this.resetAiEntryBackoff(session);
      session.winnerState = null;
      session.stopLossPrice = null;
      session.addOnState.pendingClientOrderId = null;
      session.addOnState.pendingAddonIndex = null;
      session.addOnState.pendingAttempt = 0;
      session.lastReduceOrderTs = 0;
      session.flipGovernor.reset();
      session.flipState.partialReduced = false;
      session.flipState.lastPartialReduceTs = 0;
      session.peakUnrealizedPnlPct = 0;
      return;
    }

    if (prevPosition && nextPosition && prevPosition.side !== nextPosition.side) {
      this.clearPendingCloseAction(session, prevPosition.side);
      this.resetAiEntryBackoff(session);
      session.winnerState = this.winnerManager.initState({
        entryPrice: nextPosition.entryPrice,
        side: nextPosition.side,
        atr: session.atr || Math.abs(markPrice - nextPosition.entryPrice) * 0.01,
        markPrice,
      });
      session.stopLossPrice = this.resolveActiveStop(session.winnerState);
      session.lastEntryOrAddOnTs = eventTimestampMs;
      session.lastReduceOrderTs = 0;
      session.flipGovernor.reset();
      session.flipState.partialReduced = false;
      session.flipState.lastPartialReduceTs = 0;
      session.peakUnrealizedPnlPct = Math.max(0, this.computeUnrealizedPnlPct(session, markPrice));
      return;
    }

    if (nextPosition) {
      const currentUnrealizedPnlPct = this.computeUnrealizedPnlPct(session, markPrice);
      session.peakUnrealizedPnlPct = Math.max(
        Number.isFinite(session.peakUnrealizedPnlPct) ? session.peakUnrealizedPnlPct : 0,
        currentUnrealizedPnlPct
      );
    }
  }

  private isClosingOrder(prevSide: 'LONG' | 'SHORT', orderSide: 'BUY' | 'SELL'): boolean {
    return (prevSide === 'LONG' && orderSide === 'SELL') || (prevSide === 'SHORT' && orderSide === 'BUY');
  }

  private logTradeEvent(event: DryRunLogEvent): void {
    if (!this.tradeLogger || !this.tradeLogEnabled) return;
    this.tradeLogger.log(event);
  }

  private getRunId(): string {
    return this.runId || 'dryrun';
  }

  private addConsoleLog(
    level: 'INFO' | 'WARN' | 'ERROR',
    symbol: string | null,
    message: string,
    timestampMs: number
  ): void {
    this.consoleSeq += 1;
    const logItem: DryRunConsoleLog = {
      seq: this.consoleSeq,
      timestampMs: timestampMs > 0 ? timestampMs : this.clock.now(),
      symbol,
      level,
      message,
    };
    this.logTail.push(logItem);
    if (this.logTail.length > CONSOLE_LOG_TAIL_LIMIT) {
      this.logTail = this.logTail.slice(this.logTail.length - CONSOLE_LOG_TAIL_LIMIT);
    }
  }
}
