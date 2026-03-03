/**
 * Binance Futures Proxy Server (Strict Architecture)
 *
 * Mandates:
 * 1. Futures ONLY (fapi/fstream).
 * 2. Strict Rate Limiting (Token Bucket / 429 Backoff).
 * 3. Independent Trade Tape (works even if Orderbook is stale).
 * 4. Observability-first (Detailed /health and JSON logs).
 */

import * as dotenv from 'dotenv';
dotenv.config();

import express, { NextFunction, Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';


// Metrics Imports
import { TimeAndSales } from './metrics/TimeAndSales';
import { CvdCalculator } from './metrics/CvdCalculator';
import { AbsorptionDetector } from './metrics/AbsorptionDetector';
import { OpenInterestMonitor, OpenInterestMetrics } from './metrics/OpenInterestMonitor';
import { FundingMonitor, FundingMetrics } from './metrics/FundingMonitor';
import { OrderbookIntegrityMonitor } from './metrics/OrderbookIntegrityMonitor';
import {
    OrderbookState,
    createOrderbookStateMap,
    getOrCreateOrderbookState,
    resetOrderbookState,
    applyDepthUpdate,
    applySnapshot,
    bestBid,
    bestAsk,
    getLevelSize,
    getTopLevels,
} from './metrics/OrderbookManager';
import { LegacyCalculator } from './metrics/LegacyCalculator';
import { createOrchestratorFromEnv } from './orchestrator/Orchestrator';
import { calculateSignalReturnCorrelation } from './metrics/SignalPerformance';
import { analyzeLoserExits, analyzeWinnerExits, calculateAverageGrossEdgePerTrade, calculateFeeImpact, calculateFlipFrequency, calculatePrecisionRecall } from './metrics/TradeMetrics';
import { calculateVolatilityRegime, identifyTrendChopRegime } from './metrics/MarketRegimeDetector';
import { analyzeDrawdownClustering, calculateReturnDistribution, calculateSkewnessKurtosis } from './metrics/PortfolioMetrics';
import { analyzePerformanceByOrderSize, analyzePerformanceBySpread, calculateSlippage } from './metrics/ExecutionMetrics';
import { bootstrapMeanCI, tTestPValue } from './backtesting/Statistics';

// [PHASE 1 & 2] New Imports
import { KlineBackfill } from './backfill/KlineBackfill';
import { BackfillCoordinator } from './backfill/BackfillCoordinator';
import { OICalculator } from './metrics/OICalculator';
import { SymbolEventQueue } from './utils/SymbolEventQueue';
import { SnapshotTracker } from './telemetry/Snapshot';
import { apiKeyMiddleware, validateWebSocketApiKey } from './auth/apiKey';
import { NewStrategyV11 } from './strategy/NewStrategyV11';
import { DecisionLog } from './telemetry/DecisionLog';
import { DryRunConfig, DryRunEngine, DryRunEventInput, DryRunSessionService, isUpstreamGuardError } from './dryrun';
import { logger, requestLogger, serializeError } from './utils/logger';
import { WebSocketManager } from './ws/WebSocketManager';
import { AlertService } from './notifications/AlertService';
import { getAlertConfig } from './config/alertConfig';
import { bootValidation } from './config/ConfigValidator';
import { NotificationService } from './notifications/NotificationService';
import { HealthController } from './health/HealthController';
import { MarketDataArchive } from './backfill/MarketDataArchive';
import { SignalReplay } from './backfill/SignalReplay';
import { ABTestManager } from './abtesting';
import { PortfolioMonitor } from './risk/PortfolioMonitor';
import { InstitutionalRiskEngine, RiskState, RiskStateTrigger } from './risk/InstitutionalRiskEngine';
import { LatencyTracker } from './metrics/LatencyTracker';
import { MonteCarloSimulator, calculateRiskOfRuin, generateRandomTrades } from './backtesting/MonteCarloSimulator';
import { WalkForwardAnalyzer } from './backtesting/WalkForwardAnalyzer';
import { MarketDataValidator } from './connectors/MarketDataValidator';
import { MarketDataMonitor } from './connectors/MarketDataMonitor';
import {
    AdvancedMicrostructureMetrics,
    AdvancedMicrostructureBundle,
} from './metrics/AdvancedMicrostructureMetrics';
import { SpotReferenceMonitor, SpotReferenceMetrics } from './metrics/SpotReferenceMonitor';
import { HtfStructureMonitor } from './metrics/HtfStructureMonitor';
import { OrchestratorV1 } from './orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Decision, OrchestratorV1Order, OrchestratorV1Side } from './orchestrator_v1/types';
import { AnalyticsEngine } from './analytics';
import {
    ExampleChopFilterStrategy,
    ExampleMeanRevertStrategy,
    ExampleTrendFollowStrategy,
    SignalSide as StrategySignalSide,
    StrategyContextBuilder,
    StrategyRegistry,
} from './strategies';
import { ConsensusEngine } from './consensus/ConsensusEngine';
import { ResiliencePatches } from './risk/ResiliencePatches';
import {
    metrics as observabilityMetrics,
    RiskState as TelemetryRiskState,
} from './telemetry';
import { initializeProductionReadiness } from './integration';

// =============================================================================
// Configuration
// =============================================================================

const productionRuntimeConfig = bootValidation(process.env);

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all interfaces for Nginx proxy
const BINANCE_REST_BASE = 'https://fapi.binance.com';
const BINANCE_WS_BASE = 'wss://fstream.binance.com/stream';
const DEFAULT_MAKER_FEE_RATE = Number(process.env.MAKER_FEE_BPS || '2') / 10000;
const DEFAULT_TAKER_FEE_RATE = Number(process.env.TAKER_FEE_BPS || '4') / 10000;

// Dynamic CORS - allow configured origins plus common development ports
const ALLOWED_ORIGINS = [
    // Development
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
    // Production - add your domain here or use env var
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
];

// Rate Limiting
const SNAPSHOT_MIN_INTERVAL_MS = Number(process.env.SNAPSHOT_MIN_INTERVAL_MS || 1500);
const MIN_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 120000;
const DEPTH_QUEUE_MAX = Number(process.env.DEPTH_QUEUE_MAX || 2000);
const DEPTH_LAG_MAX_MS = Number(process.env.DEPTH_LAG_MAX_MS || 2000);
const LIVE_SNAPSHOT_FRESH_MS = Number(process.env.LIVE_SNAPSHOT_FRESH_MS || 15000);
const LIVE_DESYNC_RATE_10S_MAX = Number(process.env.LIVE_DESYNC_RATE_10S_MAX || 50);
const LIVE_QUEUE_MAX = Number(process.env.LIVE_QUEUE_MAX || 200);
const LIVE_GOOD_SEQUENCE_MIN = Number(process.env.LIVE_GOOD_SEQUENCE_MIN || 25);
const AUTO_SCALE_MIN_SYMBOLS = Number(process.env.AUTO_SCALE_MIN_SYMBOLS || 5);
const AUTO_SCALE_LIVE_DOWN_PCT = Number(process.env.AUTO_SCALE_LIVE_DOWN_PCT || 50);
const AUTO_SCALE_LIVE_UP_PCT = Number(process.env.AUTO_SCALE_LIVE_UP_PCT || 90);
const AUTO_SCALE_UP_HOLD_MS = 10 * 60 * 1000;
const DEPTH_LEVELS = Number(process.env.DEPTH_LEVELS || 20);
const DEPTH_STREAM_MODE = String(process.env.DEPTH_STREAM_MODE || 'diff').toLowerCase(); // diff | partial
const WS_UPDATE_SPEED_RAW = String(process.env.WS_UPDATE_SPEED || '250ms');
const WS_UPDATE_SPEED = normalizeWsUpdateSpeed(WS_UPDATE_SPEED_RAW);
const BINANCE_REST_TIMEOUT_MS = Math.max(1000, Number(process.env.BINANCE_REST_TIMEOUT_MS || 8000));
const BINANCE_EXCHANGE_INFO_TIMEOUT_MS = Math.max(1000, Number(process.env.BINANCE_EXCHANGE_INFO_TIMEOUT_MS || BINANCE_REST_TIMEOUT_MS));
const BINANCE_SNAPSHOT_TIMEOUT_MS = Math.max(1000, Number(process.env.BINANCE_SNAPSHOT_TIMEOUT_MS || BINANCE_REST_TIMEOUT_MS));
const BLOCKED_TELEMETRY_INTERVAL_MS = Number(process.env.BLOCKED_TELEMETRY_INTERVAL_MS || 1000);
const MIN_RESYNC_INTERVAL_MS = 15000;
const GRACE_PERIOD_MS = 5000;
const CLIENT_HEARTBEAT_INTERVAL_MS = Number(process.env.CLIENT_HEARTBEAT_INTERVAL_MS || 15000);
const CLIENT_STALE_CONNECTION_MS = Number(process.env.CLIENT_STALE_CONNECTION_MS || 60000);
const WS_MAX_SUBSCRIPTIONS = Number(process.env.WS_MAX_SUBSCRIPTIONS || 500);
const BACKFILL_RECORDING_ENABLED = parseEnvFlag(process.env.BACKFILL_RECORDING_ENABLED);
const BACKFILL_SNAPSHOT_INTERVAL_MS = Number(process.env.BACKFILL_SNAPSHOT_INTERVAL_MS || 2000);
const BOOTSTRAP_1M_LIMIT = Math.max(50, Math.trunc(Number(process.env.BOOTSTRAP_1M_LIMIT || 500)));
const STRATEGY_EVAL_MIN_INTERVAL_MS = Math.max(50, Number(process.env.STRATEGY_EVAL_MIN_INTERVAL_MS || 200));
// Cross-market metrics should be available out-of-the-box.
// Explicitly set ENABLE_CROSS_MARKET_CONFIRMATION=false to disable.
const ENABLE_CROSS_MARKET_CONFIRMATION = process.env.ENABLE_CROSS_MARKET_CONFIRMATION == null
    ? true
    : parseEnvFlag(process.env.ENABLE_CROSS_MARKET_CONFIRMATION);

// [PHASE 3] Execution Flags
let KILL_SWITCH = false;
function parseEnvFlag(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
function parseEnvNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const EXECUTION_ENABLED_DEFAULT = parseEnvFlag(process.env.EXECUTION_ENABLED);
let EXECUTION_ENABLED = EXECUTION_ENABLED_DEFAULT;
const EXECUTION_ENV = 'testnet';
let SUPER_SCALP_ENABLED = parseEnvFlag(process.env.SUPER_SCALP_ENABLED);
const RISK_ENGINE_ENABLED = process.env.RISK_ENGINE_ENABLED == null
    ? true
    : parseEnvFlag(process.env.RISK_ENGINE_ENABLED);
const RISK_ENGINE_DEFAULT_EQUITY_USDT = Math.max(
    1,
    parseEnvNumber(process.env.RISK_ENGINE_DEFAULT_EQUITY_USDT || process.env.STARTING_MARGIN_USDT, 5000)
);
const MAX_POSITION_NOTIONAL_BASE = Math.max(
    100,
    parseEnvNumber(process.env.MAX_POSITION_NOTIONAL_USDT, 10000)
);
const RISK_ENGINE_CONFIG = {
    state: {
        reducedRiskPositionMultiplier: Math.max(
            0.05,
            Math.min(1, parseEnvNumber(process.env.RISK_REDUCED_POSITION_MULTIPLIER, 0.5))
        ),
    },
    position: {
        maxPositionNotional: Math.max(100, parseEnvNumber(process.env.RISK_MAX_POSITION_NOTIONAL_USDT, MAX_POSITION_NOTIONAL_BASE)),
        maxLeverage: Math.max(1, parseEnvNumber(process.env.RISK_MAX_LEVERAGE, parseEnvNumber(process.env.MAX_LEVERAGE, 20))),
        maxPositionQty: Math.max(0.000001, parseEnvNumber(process.env.RISK_MAX_POSITION_QTY, 10)),
        maxTotalNotional: Math.max(100, parseEnvNumber(process.env.RISK_MAX_TOTAL_NOTIONAL_USDT, Math.max(MAX_POSITION_NOTIONAL_BASE * 2, 20000))),
        warningThreshold: Math.max(0.5, Math.min(0.99, parseEnvNumber(process.env.RISK_POSITION_WARNING_THRESHOLD, 0.8))),
    },
    drawdown: {
        dailyLossLimitRatio: Math.max(0.01, Math.min(1, parseEnvNumber(process.env.RISK_DAILY_LOSS_LIMIT_RATIO, 0.1))),
        dailyLossWarningRatio: Math.max(0.005, Math.min(1, parseEnvNumber(process.env.RISK_DAILY_LOSS_WARNING_RATIO, 0.07))),
        maxDrawdownRatio: Math.max(0.01, Math.min(1, parseEnvNumber(process.env.RISK_MAX_DRAWDOWN_RATIO, 0.15))),
        checkIntervalMs: Math.max(500, parseEnvNumber(process.env.RISK_DRAWDOWN_CHECK_INTERVAL_MS, 5000)),
        autoHaltOnLimit: process.env.RISK_DRAWDOWN_AUTO_HALT == null
            ? true
            : parseEnvFlag(process.env.RISK_DRAWDOWN_AUTO_HALT),
    },
    consecutiveLoss: {
        maxConsecutiveLosses: Math.max(1, Math.trunc(parseEnvNumber(process.env.RISK_MAX_CONSECUTIVE_LOSSES, 5))),
        lossWindowMs: Math.max(1000, parseEnvNumber(process.env.RISK_CONSECUTIVE_LOSS_WINDOW_MS, 3600000)),
        reducedRiskThreshold: Math.max(1, Math.trunc(parseEnvNumber(process.env.RISK_REDUCED_AFTER_CONSECUTIVE_LOSSES, 3))),
        reducedRiskMultiplier: Math.max(0.05, Math.min(1, parseEnvNumber(process.env.RISK_CONSECUTIVE_LOSS_MULTIPLIER, 0.5))),
    },
    execution: {
        maxPartialFillRate: Math.max(0.01, Math.min(1, parseEnvNumber(process.env.RISK_MAX_PARTIAL_FILL_RATE, 0.3))),
        maxRejectRate: Math.max(0.01, Math.min(1, parseEnvNumber(process.env.RISK_MAX_REJECT_RATE, 0.2))),
        executionTimeoutMs: Math.max(500, parseEnvNumber(process.env.RISK_EXECUTION_TIMEOUT_MS, 10000)),
        rateWindowMs: Math.max(1000, parseEnvNumber(process.env.RISK_EXECUTION_WINDOW_MS, 300000)),
        autoHaltOnFailure: process.env.RISK_EXECUTION_AUTO_HALT == null
            ? true
            : parseEnvFlag(process.env.RISK_EXECUTION_AUTO_HALT),
    },
    killSwitch: {
        latencySpikeThresholdMs: Math.max(10, parseEnvNumber(process.env.RISK_LATENCY_SPIKE_MS, 5000)),
        volatilitySpikeThreshold: Math.max(0.001, Math.min(1, parseEnvNumber(process.env.RISK_VOLATILITY_SPIKE_RATIO, 0.05))),
        disconnectTimeoutMs: Math.max(1000, parseEnvNumber(process.env.RISK_DISCONNECT_TIMEOUT_MS, 30000)),
        priceWindowMs: Math.max(1000, parseEnvNumber(process.env.RISK_PRICE_WINDOW_MS, 60000)),
        autoClosePositions: process.env.RISK_AUTO_CLOSE_POSITIONS == null
            ? true
            : parseEnvFlag(process.env.RISK_AUTO_CLOSE_POSITIONS),
    },
};
const RESILIENCE_PATCHES_ENABLED = process.env.RESILIENCE_PATCHES_ENABLED == null
    ? true
    : parseEnvFlag(process.env.RESILIENCE_PATCHES_ENABLED);
const RESILIENCE_SUPPRESS_MIN_MULTIPLIER = Math.max(
    0,
    Math.min(1, parseEnvNumber(process.env.RESILIENCE_SUPPRESS_MIN_MULTIPLIER, 0.75))
);
const ANALYTICS_PERSIST_TO_DISK = process.env.ANALYTICS_PERSIST_TO_DISK == null
    ? false
    : parseEnvFlag(process.env.ANALYTICS_PERSIST_TO_DISK);
const ANALYTICS_SNAPSHOT_INTERVAL_MS = Math.max(
    1000,
    parseEnvNumber(process.env.ANALYTICS_SNAPSHOT_INTERVAL_MS, 30_000)
);
const ANALYTICS_OUTPUT_DIR = String(process.env.ANALYTICS_OUTPUT_DIR || './logs/analytics');

function normalizeWsUpdateSpeed(raw: string): '100ms' | '250ms' | '500ms' {
    const value = String(raw || '').trim().toLowerCase();
    if (value === '100' || value === '100ms') return '100ms';
    if (value === '500' || value === '500ms') return '500ms';
    // Binance Futures diff/partial depth default speed is encoded without suffix.
    // We keep "250ms" as logical value and map it to no suffix in buildDepthStream.
    return '250ms';
}

// =============================================================================
// Logging
// =============================================================================

function log(event: string, data: any = {}) {
    logger.info(event, data);
}

process.on('unhandledRejection', (reason) => {
    logger.error('PROCESS_UNHANDLED_REJECTION', { reason: serializeError(reason) });
});

process.on('uncaughtException', (error) => {
    logger.error('PROCESS_UNCAUGHT_EXCEPTION', { error: serializeError(error) });
});

function getExecutionGateState() {
    const status = orchestrator.getExecutionStatus();
    const connection = status.connection;
    const hasCredentials = Boolean(connection.hasCredentials);
    const ready = Boolean(connection.ready);
    const executionAllowed = EXECUTION_ENABLED && !KILL_SWITCH && hasCredentials && ready;
    return {
        executionAllowed,
        hasCredentials,
        ready,
        readyReason: connection.readyReason,
        connectionState: connection.state,
    };
}

// =============================================================================
// State
// =============================================================================

interface SymbolMeta {
    lastSnapshotAttempt: number;
    lastSnapshotOk: number;
    backoffMs: number;
    consecutiveErrors: number;
    isResyncing: boolean;
    lastResyncTs: number; // New throttle
    lastResyncTrigger: string;
    // Counters
    depthMsgCount: number;
    depthMsgCount10s: number;
    lastDepthMsgTs: number;
    tradeMsgCount: number;
    desyncCount: number;
    snapshotCount: number;
    lastSnapshotHttpStatus: number;
    snapshotLastUpdateId: number;
    // Broadcast tracking
    lastBroadcastTs: number;
    metricsBroadcastCount10s: number;
    metricsBroadcastDepthCount10s: number;
    metricsBroadcastTradeCount10s: number;
    lastMetricsBroadcastReason: 'depth' | 'trade' | 'none';
    applyCount10s: number;
    // Reliability
    depthQueue: Array<{
        U: number;
        u: number;
        pu?: number;
        b: [string, string][];
        a: [string, string][];
        eventTimeMs: number;
        receiptTimeMs: number;
    }>;
    isProcessingDepthQueue: boolean;
    goodSequenceStreak: number;
    lastStateTransitionTs: number;
    lastLiveTs: number;
    lastBlockedTelemetryTs: number;
    lastArchiveSnapshotTs: number;
    // Rolling windows
    desyncEvents: number[];
    snapshotOkEvents: number[];
    snapshotSkipEvents: number[];
    liveSamples: Array<{ ts: number; live: boolean }>;
    // [PHASE 1] Deterministic Queue
    eventQueue: SymbolEventQueue;
    // [PHASE 1] Snapshot tracker
    snapshotTracker: SnapshotTracker;
    // Strategy throttling cache
    lastStrategyEvalTs: number;
    lastStrategyDecision: any | null;
    lastLegacyMetrics: any | null;
}

// [P0-FIX-24] Symbol-level state isolation - Map<string, State> yapısı
const symbolMeta = new Map<string, SymbolMeta>();
const orderbookMap = createOrderbookStateMap();

// [P0-FIX-25] Per-symbol processing locks
const processingSymbols = new Set<string>();
const snapshotInProgress = new Map<string, boolean>();

// [P0-FIX-26] Symbol state validation helper
function validateSymbolState(symbol: string): boolean {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    if (!normalizedSymbol) return false;

    const meta = symbolMeta.get(normalizedSymbol);
    if (!meta) return false;

    // Check for cross-symbol contamination
    for (const [key, value] of symbolMeta.entries()) {
        if (key !== normalizedSymbol) {
            // Ensure no shared references
            if (value.depthQueue === meta.depthQueue) {
                log('SYMBOL_STATE_CONTAMINATION', { symbol: normalizedSymbol, other: key, type: 'depthQueue' });
                return false;
            }
        }
    }
    return true;
}
const orchestratorEvalErrorTs = new Map<string, number>();

// Metrics
const timeAndSalesMap = new Map<string, TimeAndSales>();
const cvdMap = new Map<string, CvdCalculator>();
const absorptionMap = new Map<string, AbsorptionDetector>();
const absorptionResult = new Map<string, number>();
const legacyMap = new Map<string, LegacyCalculator>();
const orderbookIntegrityMap = new Map<string, OrderbookIntegrityMonitor>();
const advancedMicroMap = new Map<string, AdvancedMicrostructureMetrics>();

// Monitor Caches
const lastOpenInterest = new Map<string, OpenInterestMetrics>();
const lastFunding = new Map<string, FundingMetrics>();
const oiMonitors = new Map<string, OpenInterestMonitor>();
const fundingMonitors = new Map<string, FundingMonitor>();
const spotReferenceMonitors = new Map<string, SpotReferenceMonitor>();
const htfMonitors = new Map<string, HtfStructureMonitor>();

// [PHASE 1 & 2] New Maps
const backfillMap = new Map<string, KlineBackfill>();
const oiCalculatorMap = new Map<string, OICalculator>();
const decisionLog = new DecisionLog();
decisionLog.start();
const strategyMap = new Map<string, NewStrategyV11>();
const BACKFILL_RETRY_INTERVAL_MS = 30_000;
const backfillCoordinator = new BackfillCoordinator(
    BINANCE_REST_BASE,
    BOOTSTRAP_1M_LIMIT,
    BACKFILL_RETRY_INTERVAL_MS,
    log
);
const alertConfig = getAlertConfig();
const alertService = new AlertService(alertConfig);
const notificationService = new NotificationService(alertConfig);
const analyticsEngine = new AnalyticsEngine({
    persistToDisk: ANALYTICS_PERSIST_TO_DISK,
    snapshotIntervalMs: ANALYTICS_SNAPSHOT_INTERVAL_MS,
    outputDir: ANALYTICS_OUTPUT_DIR,
});
const analyticsLastErrorByKind = new Map<string, number>();
const orchestrator = createOrchestratorFromEnv(alertService);
const dryRunSession = new DryRunSessionService(alertService);
const orchestratorV1 = new OrchestratorV1();
const strategyFrameworkEnabled = process.env.STRATEGY_FRAMEWORK_ENABLED == null
    ? true
    : parseEnvFlag(process.env.STRATEGY_FRAMEWORK_ENABLED);
const strategyContextBuilder = new StrategyContextBuilder();
const strategyRegistry = new StrategyRegistry();
strategyRegistry.register(new ExampleTrendFollowStrategy());
strategyRegistry.register(new ExampleMeanRevertStrategy());
strategyRegistry.register(new ExampleChopFilterStrategy());
const consensusEngine = new ConsensusEngine();
const strategyConsensusBySymbol = new Map<string, {
    timestampMs: number;
    side: 'LONG' | 'SHORT' | 'FLAT';
    confidence: number;
    quorumMet: boolean;
    riskGatePassed: boolean;
    contributingStrategies: number;
    totalStrategies: number;
}>();
const abTestManager = new ABTestManager(alertService);
const marketArchive = new MarketDataArchive();
const signalReplay = new SignalReplay(marketArchive);
const portfolioMonitor = new PortfolioMonitor();
const latencyTracker = new LatencyTracker();
const institutionalRiskEngine = new InstitutionalRiskEngine(RISK_ENGINE_CONFIG);
const resiliencePatches = new ResiliencePatches({
    enableAll: RESILIENCE_PATCHES_ENABLED,
    autoKillSwitch: true,
    autoHalt: true,
});
const resilienceLastSideBySymbol = new Map<string, 'BUY' | 'SELL' | null>();
let riskEngineLastKnownEquity = RISK_ENGINE_DEFAULT_EQUITY_USDT;
const riskEngineLastRealizedPnlBySymbol = new Map<string, number>();
let riskEngineLastState: RiskState | null = null;
if (RISK_ENGINE_ENABLED) {
    institutionalRiskEngine.initialize(riskEngineLastKnownEquity);
    riskEngineLastState = institutionalRiskEngine.getRiskState();
    observabilityMetrics.setRiskState(toTelemetryRiskState(riskEngineLastState));
} else {
    observabilityMetrics.setRiskState(TelemetryRiskState.NORMAL);
}
if (RESILIENCE_PATCHES_ENABLED && RISK_ENGINE_ENABLED) {
    resiliencePatches.initialize(institutionalRiskEngine);
}
const marketDataValidator = new MarketDataValidator(alertService);
const marketDataMonitor = new MarketDataMonitor(alertService, {
    maxSilenceMs: Number(process.env.MARKET_DATA_MAX_SILENCE_MS || 10_000),
});
marketDataMonitor.startMonitoring();

const OBSERVABILITY_PNL_SYNC_INTERVAL_MS = 1_000;
let lastObservabilityPnlSyncMs = 0;

function toTelemetryRiskState(state: RiskState | string): TelemetryRiskState {
    if (state === RiskState.HALTED || state === RiskState.KILL_SWITCH) {
        return TelemetryRiskState.HALTED;
    }
    if (state === RiskState.REDUCED_RISK) {
        return TelemetryRiskState.WARNING;
    }
    return TelemetryRiskState.NORMAL;
}

function syncObservabilityMetrics(nowMs: number): void {
    if (RISK_ENGINE_ENABLED) {
        observabilityMetrics.setRiskState(toTelemetryRiskState(institutionalRiskEngine.getRiskState()));
    } else {
        observabilityMetrics.setRiskState(TelemetryRiskState.NORMAL);
    }

    if (nowMs - lastObservabilityPnlSyncMs < OBSERVABILITY_PNL_SYNC_INTERVAL_MS) {
        return;
    }
    lastObservabilityPnlSyncMs = nowMs;

    try {
        const snapshot = analyticsEngine.getSnapshot();
        observabilityMetrics.setPnL(Number(snapshot?.summary?.netPnl || 0));
        const status = dryRunSession.getStatus();
        const openPositions = Object.values(status.perSymbol || {}).reduce((count, symbolStatus: any) => {
            const qty = Math.abs(Number(symbolStatus?.position?.qty || 0));
            return count + (qty > 0 ? 1 : 0);
        }, 0);
        observabilityMetrics.setPositionCount(openPositions);
    } catch (error) {
        logAnalyticsError('telemetry_pnl_sync', null, error);
    }
}

function logAnalyticsError(kind: string, symbol: string | null, error: unknown): void {
    const now = Date.now();
    const last = analyticsLastErrorByKind.get(kind) || 0;
    if (now - last < 15_000) {
        return;
    }
    analyticsLastErrorByKind.set(kind, now);
    log('ANALYTICS_INGEST_ERROR', {
        kind,
        symbol,
        error: serializeError(error),
    });
}

const executionConnector = orchestrator.getConnector();
executionConnector.onExecutionEvent((event) => {
    try {
        if (event.type === 'TRADE_UPDATE') {
            analyticsEngine.ingestFill({
                type: 'FILL',
                symbol: String(event.symbol || '').toUpperCase(),
                side: event.side,
                qty: Math.max(0, Number(event.fillQty || 0)),
                price: Math.max(0, Number(event.fillPrice || 0)),
                fee: Math.max(0, Number(event.commission || 0)),
                feeType: 'taker',
                timestamp: Number(event.event_time_ms || Date.now()),
                orderId: String(event.orderId || ''),
                tradeId: String(event.tradeId || ''),
                isReduceOnly: false,
            });
            return;
        }

        if (event.type === 'ACCOUNT_UPDATE') {
            const positionAmt = Number(event.positionAmt || 0);
            const side = positionAmt > 0 ? 'LONG' : positionAmt < 0 ? 'SHORT' : 'FLAT';
            analyticsEngine.ingestPosition({
                type: 'POSITION_UPDATE',
                symbol: String(event.symbol || '').toUpperCase(),
                side,
                qty: Math.abs(positionAmt),
                entryPrice: Math.max(0, Number(event.entryPrice || 0)),
                markPrice: Math.max(0, Number(event.entryPrice || 0)),
                unrealizedPnl: Number(event.unrealizedPnL || 0),
                timestamp: Number(event.event_time_ms || Date.now()),
            });
        }
    } catch (error) {
        logAnalyticsError('execution_event', event?.symbol || null, error);
    }
});
orchestrator.setKillSwitch(KILL_SWITCH);
if (typeof process.env.EXECUTION_MODE !== 'undefined') {
    log('CONFIG_WARNING', { message: 'EXECUTION_MODE is deprecated and ignored' });
}

const hasEnvApiKey = Boolean(process.env.BINANCE_TESTNET_API_KEY);
const hasEnvApiSecret = Boolean(process.env.BINANCE_TESTNET_API_SECRET);
const initialGate = getExecutionGateState();
log('EXECUTION_CONFIG', {
    execEnabled: EXECUTION_ENABLED,
    killSwitch: KILL_SWITCH,
    env: EXECUTION_ENV,
    decisionMode: 'orchestrator_v1',
    decisionEnabled: true,
    superScalpEnabled: SUPER_SCALP_ENABLED,
    riskEngineEnabled: RISK_ENGINE_ENABLED,
    riskEngineDefaultEquityUsdt: RISK_ENGINE_DEFAULT_EQUITY_USDT,
    hasApiKey: hasEnvApiKey,
    hasApiSecret: hasEnvApiSecret,
    executionAllowed: initialGate.executionAllowed,
});
// Cached Exchange Info
let exchangeInfoCache: { data: any; timestamp: number } | null = null;
const EXCHANGE_INFO_TTL_MS = 1000 * 60 * 60; // 1 hr

// Global Rate Limit
let globalBackoffUntil = 0; // Starts at 0 to allow fresh attempts on restart
let symbolConcurrencyLimit = Math.max(AUTO_SCALE_MIN_SYMBOLS, Number(process.env.SYMBOL_CONCURRENCY || 20));
let autoScaleLastUpTs = 0;
const decisionRuntimeStats = {
    legacyDecisionCalls: 0,
    executorEntrySkipped: 0,
    orchestratorEvaluations: 0,
    ordersAttempted: 0,
    makerOrdersPlaced: 0,
    takerOrdersPlaced: 0,
    entryTakerNotionalPct: 0,
    addsUsed: 0,
    exitRiskTriggeredCount: 0,
    gateB_fail_cvd_count: 0,
    gateB_fail_obi_count: 0,
    gateB_fail_deltaZ_count: 0,
    gateA_fail_trendiness_count: 0,
    allGatesTrue_count: 0,
    entryCandidateCount: 0,
    chaseStartedCount: 0,
    chaseTimedOutCount: 0,
    impulseTrueCount: 0,
    fallbackEligibleCount: 0,
    fallbackTriggeredCount: 0,
    fallbackBlockedReasonCounts: {} as Record<string, number>,
    makerFillsCount: 0,
    takerFillsCount: 0,
    positionSide: null as OrchestratorV1Side | null,
    positionQty: 0,
    entryVwap: null as number | null,
    postOnlyRejectCount: 0,
    cancelCount: 0,
    replaceCount: 0,
};

type FallbackBlockedReason =
    | 'NO_TIMEOUT'
    | 'IMPULSE_FALSE'
    | 'GATES_FALSE'
    | 'DRYRUN_BLOCK'
    | 'CONFIG_BLOCK'
    | 'OTHER';

const fallbackReasonPriority: FallbackBlockedReason[] = [
    'IMPULSE_FALSE',
    'GATES_FALSE',
    'NO_TIMEOUT',
    'DRYRUN_BLOCK',
    'CONFIG_BLOCK',
    'OTHER',
];

const orchestratorDiagState = {
    chaseActiveBySymbol: new Map<string, boolean>(),
    chaseExpiresAtBySymbol: new Map<string, number | null>(),
    blockReasonCountsBySymbol: new Map<string, Record<string, number>>(),
};

function incrementCounter(map: Record<string, number>, key: string): void {
    map[key] = Number(map[key] || 0) + 1;
}

function topFallbackBlockedReason(): string {
    const counts = decisionRuntimeStats.fallbackBlockedReasonCounts;
    let top = 'OTHER';
    let max = -1;
    for (const reason of fallbackReasonPriority) {
        const value = Number(counts[reason] || 0);
        if (value > max) {
            max = value;
            top = reason;
        }
    }
    return top;
}

function deriveOrchestratorBlockReason(decision: OrchestratorV1Decision, nowMs: number): string {
    if (!decision.readiness.ready) return 'READINESS';
    if (!decision.gateA.passed) {
        if (decision.gateA.checks.trendiness === false) return 'GateA.trendiness';
        if (decision.gateA.checks.chop === false) return 'GateA.chop';
        if (decision.gateA.checks.volOfVol === false) return 'GateA.volOfVol';
        if (decision.gateA.checks.spread === false) return 'GateA.spread';
        if (decision.gateA.checks.oiDrop === false) return 'GateA.oiDrop';
        return 'GateA.other';
    }
    if (!decision.gateB.passed) {
        if (decision.gateB.checks.cvd === false) return 'GateB.cvd';
        if (decision.gateB.checks.obiSupport === false) return 'GateB.obiSupport';
        if (decision.gateB.checks.deltaZ === false) return 'GateB.deltaZ';
        if (decision.gateB.checks.side === false) return 'GateB.side';
        return 'GateB.other';
    }
    if (!decision.gateC.passed) {
        if (decision.gateC.checks.vwapDistance === false) return 'GateC.vwapDistance';
        if (decision.gateC.checks.vol1m === false) return 'GateC.vol1m';
        return 'GateC.other';
    }
    if (Number(decision.position?.cooldownUntilTs || 0) > nowMs) return 'COOLDOWN';
    return 'NONE';
}

function recordSymbolBlockReason(symbol: string, blockReason: string): void {
    const current = orchestratorDiagState.blockReasonCountsBySymbol.get(symbol) || {};
    incrementCounter(current, blockReason);
    orchestratorDiagState.blockReasonCountsBySymbol.set(symbol, current);
}

function updateOrchestratorDiagnostics(symbol: string, decision: OrchestratorV1Decision, nowMs: number): {
    blockReason: string;
    gateA: boolean;
    gateB: boolean;
    gateC: boolean;
    impulse: boolean;
    chaseActive: boolean;
} {
    const gateA = Boolean(decision.gateA.passed);
    const gateB = Boolean(decision.gateB.passed);
    const gateC = Boolean(decision.gateC.passed);
    const impulse = Boolean(decision.impulse?.passed);
    const chaseActive = Boolean(decision.chase?.active);
    const entryCandidate = Boolean(decision.readiness.ready && gateA && gateB && gateC);

    if (decision.gateB.checks.cvd === false) decisionRuntimeStats.gateB_fail_cvd_count += 1;
    if (decision.gateB.checks.obiSupport === false) decisionRuntimeStats.gateB_fail_obi_count += 1;
    if (decision.gateB.checks.deltaZ === false) decisionRuntimeStats.gateB_fail_deltaZ_count += 1;
    if (decision.gateA.checks.trendiness === false) decisionRuntimeStats.gateA_fail_trendiness_count += 1;
    if (decision.allGatesPassed) decisionRuntimeStats.allGatesTrue_count += 1;
    if (entryCandidate) decisionRuntimeStats.entryCandidateCount += 1;
    if (impulse) decisionRuntimeStats.impulseTrueCount += 1;

    const prevChaseActive = Boolean(orchestratorDiagState.chaseActiveBySymbol.get(symbol));
    const prevExpiresAt = orchestratorDiagState.chaseExpiresAtBySymbol.get(symbol) ?? null;

    if (!prevChaseActive && chaseActive) {
        decisionRuntimeStats.chaseStartedCount += 1;
    }

    const timedOutNow = prevChaseActive && !chaseActive && (
        (Number.isFinite(Number(prevExpiresAt)) && Number(prevExpiresAt) > 0 && nowMs >= Number(prevExpiresAt))
        || Number(decision.chase?.repricesUsed || 0) >= Number(decision.chase?.maxReprices || 0)
    );
    if (timedOutNow) {
        decisionRuntimeStats.chaseTimedOutCount += 1;
    }

    const fallbackTriggered = Array.isArray(decision.orders)
        && decision.orders.some((order) => order.kind === 'TAKER_ENTRY_FALLBACK');
    if (fallbackTriggered) {
        decisionRuntimeStats.fallbackTriggeredCount += 1;
    }

    const fallbackEligible = Boolean(timedOutNow && impulse && entryCandidate);
    if (fallbackEligible) {
        decisionRuntimeStats.fallbackEligibleCount += 1;
    }

    let fallbackBlockedReason: FallbackBlockedReason | null = null;
    if (!fallbackTriggered) {
        if (chaseActive && !timedOutNow) fallbackBlockedReason = 'NO_TIMEOUT';
        else if (timedOutNow && !impulse) fallbackBlockedReason = 'IMPULSE_FALSE';
        else if (timedOutNow && !entryCandidate) fallbackBlockedReason = 'GATES_FALSE';
        else if (timedOutNow) fallbackBlockedReason = 'OTHER';
    }
    if (fallbackBlockedReason) {
        incrementCounter(decisionRuntimeStats.fallbackBlockedReasonCounts, fallbackBlockedReason);
    }

    if (decision.position.isOpen && Number(decision.position.qty || 0) > 0) {
        decisionRuntimeStats.positionSide = decision.side || null;
        decisionRuntimeStats.positionQty = Number(decision.position.qty || 0);
        decisionRuntimeStats.entryVwap = Number.isFinite(Number(decision.position.entryVwap))
            ? Number(decision.position.entryVwap)
            : null;
    } else if (!decision.position.isOpen) {
        decisionRuntimeStats.positionSide = null;
        decisionRuntimeStats.positionQty = 0;
        decisionRuntimeStats.entryVwap = null;
    }

    orchestratorDiagState.chaseActiveBySymbol.set(symbol, chaseActive);
    orchestratorDiagState.chaseExpiresAtBySymbol.set(
        symbol,
        Number.isFinite(Number(decision.chase?.expiresAtMs)) ? Number(decision.chase?.expiresAtMs) : null
    );

    const blockReason = deriveOrchestratorBlockReason(decision, nowMs);
    recordSymbolBlockReason(symbol, blockReason);
    return {
        blockReason,
        gateA,
        gateB,
        gateC,
        impulse,
        chaseActive,
    };
}

function computeRiskExposureFromOrders(orders: OrchestratorV1Order[], fallbackPrice: number | null): {
    quantity: number;
    notional: number;
} {
    const quantity = orders.reduce((sum, order) => sum + Math.max(0, Math.abs(Number(order.qty || 0))), 0);
    const directNotional = orders.reduce((sum, order) => {
        const qty = Math.max(0, Math.abs(Number(order.qty || 0)));
        const price = Number(order.price || 0);
        if (qty > 0 && price > 0) {
            return sum + (qty * price);
        }
        return sum;
    }, 0);
    const notionalFromPct = orders.reduce((sum, order) => {
        const pct = Math.max(0, Math.abs(Number(order.notionalPct || 0)));
        return sum + ((pct / 100) * riskEngineLastKnownEquity);
    }, 0);
    const notionalFromFallback = quantity > 0 && Number(fallbackPrice || 0) > 0
        ? quantity * Number(fallbackPrice)
        : 0;

    return {
        quantity,
        notional: Math.max(0, directNotional, notionalFromPct, notionalFromFallback),
    };
}

function submitRiskAwareStrategyDecision(
    symbol: string,
    side: 'BUY' | 'SELL',
    intent: 'ENTRY' | 'ADD',
    timestampMs: number,
    riskMultiplier: number,
    expectedPrice: number | null
): void {
    const score = intent === 'ENTRY' ? 100 : 80;
    const strategySide = side === 'BUY' ? 'LONG' : 'SHORT';
    const reason = intent === 'ENTRY' ? 'ENTRY_TR' : 'STRAT_ADD';
    const actionType = intent === 'ENTRY' ? 'ENTRY' : 'ADD';
    const boundedMultiplier = Math.max(0, Math.min(1, Number(riskMultiplier || 1)));
    const percentile = Math.max(0, Math.min(1, score / 100));

    dryRunSession.submitStrategyDecision(symbol, {
        symbol,
        timestampMs,
        regime: 'TR',
        dfs: score,
        dfsPercentile: percentile,
        volLevel: 0.5,
        gatePassed: true,
        reasons: [reason],
        actions: [{
            type: actionType as any,
            side: strategySide as any,
            reason: reason as any,
            expectedPrice,
            sizeMultiplier: boundedMultiplier,
        }],
        log: {
            timestampMs,
            symbol,
            regime: 'TR',
            gate: { passed: true, reason: null, details: {} },
            dfs: score,
            dfsPercentile: percentile,
            volLevel: 0.5,
            thresholds: { longEntry: 0.85, longBreak: 0.55, shortEntry: 0.15, shortBreak: 0.45 },
            reasons: [reason],
            actions: [{
                type: actionType as any,
                side: strategySide as any,
                reason: reason as any,
                expectedPrice,
                sizeMultiplier: boundedMultiplier,
            }],
            stats: {},
        },
    } as any, timestampMs);
}

function syncRiskEngineRuntime(symbol: string, eventTimeMs: number, midPrice: number | null): ReturnType<InstitutionalRiskEngine['getRiskSummary']> | null {
    if (!RISK_ENGINE_ENABLED) {
        return null;
    }

    const now = Date.now();
    const ts = Number.isFinite(eventTimeMs) && eventTimeMs > 0 ? eventTimeMs : now;
    const latencyMs = Math.max(0, now - ts);
    observabilityMetrics.recordWsLatency(latencyMs);
    institutionalRiskEngine.recordHeartbeat(ts);
    institutionalRiskEngine.recordLatency(latencyMs, ts);
    if (RESILIENCE_PATCHES_ENABLED) {
        resiliencePatches.recordLatency(latencyMs, ts, 'network');
    }

    if (Number(midPrice || 0) > 0) {
        institutionalRiskEngine.recordPrice(symbol, Number(midPrice), ts);
    }

    if (dryRunSession.isTrackingSymbol(symbol)) {
        const status = dryRunSession.getStatus();
        const totalEquity = Number(status.summary.totalEquity || 0);
        if (Number.isFinite(totalEquity) && totalEquity > 0) {
            riskEngineLastKnownEquity = totalEquity;
            institutionalRiskEngine.updateEquity(totalEquity, ts);
        }

        const symbolStatus = status.perSymbol[symbol];
        if (symbolStatus) {
            const realizedPnl = Number(symbolStatus.metrics?.realizedPnl || 0);
            const prevRealized = riskEngineLastRealizedPnlBySymbol.has(symbol)
                ? Number(riskEngineLastRealizedPnlBySymbol.get(symbol))
                : realizedPnl;
            const pnlDelta = realizedPnl - prevRealized;
            if (Number.isFinite(pnlDelta) && Math.abs(pnlDelta) > 0) {
                const qtyForRecord = Math.max(1e-6, Number(symbolStatus.position?.qty || 1));
                institutionalRiskEngine.recordTradeResult(symbol, pnlDelta, qtyForRecord, ts);
            }
            riskEngineLastRealizedPnlBySymbol.set(symbol, realizedPnl);

            const position = symbolStatus.position;
            if (position && Number(position.qty) > 0 && Number(position.entryPrice) > 0) {
                const notional = Math.max(
                    0,
                    Math.abs(Number(position.notionalUsdt || 0)),
                    Math.abs(Number(position.qty || 0) * Number(position.entryPrice || 0))
                );
                const signedQty = position.side === 'LONG'
                    ? Math.abs(Number(position.qty || 0))
                    : -Math.abs(Number(position.qty || 0));
                const leverage = Math.max(1, Number(symbolStatus.risk?.dynamicLeverage || parseEnvNumber(process.env.MAX_LEVERAGE, 10)));
                institutionalRiskEngine.updatePosition(symbol, signedQty, notional, leverage);
            } else {
                institutionalRiskEngine.getGuards().position.removePosition(symbol);
                institutionalRiskEngine.getGuards().multiSymbol.removeExposure(symbol);
            }

            const markPrice = Math.max(
                0,
                Number(midPrice || 0),
                Number(symbolStatus.metrics?.markPrice || 0),
                Number(symbolStatus.position?.entryPrice || 0)
            );
            try {
                if (position && Number(position.qty) > 0) {
                    analyticsEngine.ingestPosition({
                        type: 'POSITION_UPDATE',
                        symbol,
                        side: position.side,
                        qty: Math.abs(Number(position.qty || 0)),
                        entryPrice: Math.max(0, Number(position.entryPrice || 0)),
                        markPrice,
                        unrealizedPnl: Number(position.unrealizedPnl || symbolStatus.metrics?.unrealizedPnl || 0),
                        timestamp: ts,
                    });
                } else {
                    analyticsEngine.ingestPosition({
                        type: 'POSITION_UPDATE',
                        symbol,
                        side: 'FLAT',
                        qty: 0,
                        entryPrice: 0,
                        markPrice,
                        unrealizedPnl: 0,
                        timestamp: ts,
                    });
                }
            } catch (error) {
                logAnalyticsError('position_sync', symbol, error);
            }
        }
    }

    const currentState = institutionalRiskEngine.getRiskState();
    if (riskEngineLastState !== currentState) {
        observabilityMetrics.setRiskState(toTelemetryRiskState(currentState));
        log('RISK_ENGINE_STATE_CHANGED', {
            from: riskEngineLastState,
            to: currentState,
            summary: institutionalRiskEngine.getRiskSummary(),
        });
        riskEngineLastState = currentState;
    }

    if (currentState === RiskState.KILL_SWITCH && !KILL_SWITCH) {
        observabilityMetrics.recordKillSwitchTriggered();
        KILL_SWITCH = true;
        orchestrator.setKillSwitch(true);
        log('RISK_ENGINE_FORCED_KILL_SWITCH', {
            reason: 'risk_engine_kill_switch_state',
            state: currentState,
        });
    }

    syncObservabilityMetrics(now);

    return institutionalRiskEngine.getRiskSummary();
}

// =============================================================================
// Helpers
// =============================================================================

// [P0-FIX-23] Symbol-level state isolation - her symbol için bağımsız state
function getMeta(symbol: string): SymbolMeta {
    // Normalize symbol to ensure consistent lookup
    const normalizedSymbol = String(symbol || '').trim().toUpperCase();
    if (!normalizedSymbol) {
        throw new Error('getMeta: empty symbol');
    }

    let meta = symbolMeta.get(normalizedSymbol);
    if (!meta) {
        meta = {
            lastSnapshotAttempt: 0,
            lastSnapshotOk: 0,
            backoffMs: MIN_BACKOFF_MS,
            consecutiveErrors: 0,
            isResyncing: false,
            lastResyncTs: 0,
            lastResyncTrigger: 'none',
            depthMsgCount: 0,
            depthMsgCount10s: 0,
            lastDepthMsgTs: Date.now(),
            tradeMsgCount: 0,
            desyncCount: 0,
            snapshotCount: 0,
            lastSnapshotHttpStatus: 0,
            snapshotLastUpdateId: 0,
            lastBroadcastTs: 0,
            metricsBroadcastCount10s: 0,
            metricsBroadcastDepthCount10s: 0,
            metricsBroadcastTradeCount10s: 0,
            lastMetricsBroadcastReason: 'none',
            applyCount10s: 0,
            depthQueue: [],
            isProcessingDepthQueue: false,
            goodSequenceStreak: 0,
            lastStateTransitionTs: Date.now(),
            lastLiveTs: 0,
            lastBlockedTelemetryTs: 0,
            lastArchiveSnapshotTs: 0,
            desyncEvents: [],
            snapshotOkEvents: [],
            snapshotSkipEvents: [],
            liveSamples: [],
            eventQueue: new SymbolEventQueue(normalizedSymbol, async (ev) => {
                await processSymbolEvent(normalizedSymbol, ev);
            }),
            snapshotTracker: new SnapshotTracker(),
            lastStrategyEvalTs: 0,
            lastStrategyDecision: null,
            lastLegacyMetrics: null,
        };
        symbolMeta.set(normalizedSymbol, meta);
        log('META_CREATED', { symbol: normalizedSymbol });
    }
    return meta;
}

function getOrderbook(symbol: string): OrderbookState {
    return getOrCreateOrderbookState(orderbookMap, symbol);
}

function pruneWindow(values: number[], windowMs: number, now: number): void {
    while (values.length > 0 && now - values[0] > windowMs) {
        values.shift();
    }
}

function countWindow(values: number[], windowMs: number, now: number): number {
    pruneWindow(values, windowMs, now);
    return values.length;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<globalThis.Response> {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const deadlineMs = Math.max(1000, timeoutMs);
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(new Error(`fetch_timeout_${deadlineMs}`));
        }, deadlineMs);
    });
    try {
        return await Promise.race([
            fetch(url, { signal: controller.signal }),
            timeoutPromise,
        ]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

function buildSymbolFallbackList(): string[] {
    const seeds = new Set<string>([
        'BTCUSDT',
        'ETHUSDT',
        'SOLUSDT',
        'BNBUSDT',
        ...Array.from(activeSymbols || []),
        ...dryRunSession.getActiveSymbols(),
    ]);
    const cached = exchangeInfoCache?.data?.symbols;
    if (Array.isArray(cached)) {
        for (const symbol of cached) {
            const normalized = String(symbol || '').toUpperCase();
            if (normalized) seeds.add(normalized);
        }
    }
    return Array.from(seeds).sort();
}

function recordLiveSample(symbol: string, live: boolean): void {
    const meta = getMeta(symbol);
    const now = Date.now();
    meta.liveSamples.push({ ts: now, live });
    while (meta.liveSamples.length > 0 && now - meta.liveSamples[0].ts > 60000) {
        meta.liveSamples.shift();
    }
}

function liveUptimePct60s(symbol: string): number {
    const meta = getMeta(symbol);
    const now = Date.now();
    while (meta.liveSamples.length > 0 && now - meta.liveSamples[0].ts > 60000) {
        meta.liveSamples.shift();
    }
    if (meta.liveSamples.length === 0) {
        return 0;
    }
    const liveCount = meta.liveSamples.reduce((acc, sample) => acc + (sample.live ? 1 : 0), 0);
    return (liveCount / meta.liveSamples.length) * 100;
}

function transitionOrderbookState(symbol: string, to: OrderbookState['uiState'], trigger: string, detail: any = {}) {
    const ob = getOrderbook(symbol);
    const from = ob.uiState;
    if (from === to) {
        return;
    }
    ob.uiState = to;
    if (to === 'LIVE') {
        ob.snapshotRequired = false;
    } else if (to === 'SNAPSHOT_PENDING' || to === 'RESYNCING' || to === 'HALTED') {
        ob.snapshotRequired = true;
    }
    const meta = getMeta(symbol);
    meta.lastStateTransitionTs = Date.now();
    if (to === 'LIVE') {
        meta.lastLiveTs = meta.lastStateTransitionTs;
    }
    log('ORDERBOOK_STATE_TRANSITION', { symbol, from, to, trigger, ...detail });
}

function requestOrderbookResync(symbol: string, trigger: string, detail: any = {}): void {
    const now = Date.now();
    const meta = getMeta(symbol);

    // [P0-FIX-17] Throttle resync attempts
    const timeSinceResync = now - meta.lastResyncTs;
    if (timeSinceResync < MIN_RESYNC_INTERVAL_MS) {
        log('RESYNC_THROTTLED', { symbol, trigger, timeSinceResync, minInterval: MIN_RESYNC_INTERVAL_MS });
        return;
    }

    if (meta.isResyncing) {
        log('RESYNC_ALREADY_IN_PROGRESS', { symbol, trigger });
        return;
    }

    // [P0-FIX-18] Set resync flag BEFORE any async operations
    meta.isResyncing = true;
    snapshotInProgress.set(symbol, true);

    meta.lastResyncTs = now;
    meta.lastResyncTrigger = trigger;
    meta.goodSequenceStreak = 0;
    meta.desyncCount += 1;
    meta.desyncEvents.push(now);

    // [P0-FIX-19] Clear processing lock
    meta.isProcessingDepthQueue = false;
    processingSymbols.delete(symbol);

    const ob = getOrderbook(symbol);

    // [P0-FIX-20] Queue'yu temizle - eski diff'ler ile devam ETME
    const queueSizeBefore = meta.depthQueue.length;
    meta.depthQueue = [];

    // [P0-FIX-21] Orderbook state reset
    resetOrderbookState(ob, { uiState: 'SNAPSHOT_PENDING', keepStats: true, desync: true });
    getIntegrity(symbol).markResyncStart(now);

    log('RESYNC_STARTED', { symbol, trigger, queueCleared: queueSizeBefore, detail });
    transitionOrderbookState(symbol, 'RESYNCING', trigger, detail);

    // [P0-FIX-22] Always force snapshot on resync
    fetchSnapshot(symbol, trigger, true)
        .then(() => {
            log('RESYNC_COMPLETED', { symbol, trigger });
        })
        .catch((e) => {
            log('RESYNC_FETCH_ERROR', { symbol, trigger, error: e?.message || 'resync_fetch_failed' });
            // Reset flags on error
            meta.isResyncing = false;
            snapshotInProgress.set(symbol, false);
        });
}

// Lazy Metric Getters
const getTaS = (s: string) => { if (!timeAndSalesMap.has(s)) timeAndSalesMap.set(s, new TimeAndSales()); return timeAndSalesMap.get(s)!; };
const getCvd = (s: string) => { if (!cvdMap.has(s)) cvdMap.set(s, new CvdCalculator()); return cvdMap.get(s)!; };
const getAbs = (s: string) => { if (!absorptionMap.has(s)) absorptionMap.set(s, new AbsorptionDetector()); return absorptionMap.get(s)!; };
const getLegacy = (s: string) => { if (!legacyMap.has(s)) legacyMap.set(s, new LegacyCalculator(s)); return legacyMap.get(s)!; };
const getAdvancedMicro = (s: string) => {
    if (!advancedMicroMap.has(s)) advancedMicroMap.set(s, new AdvancedMicrostructureMetrics(s));
    return advancedMicroMap.get(s)!;
};
const getIntegrity = (s: string) => {
    if (!orderbookIntegrityMap.has(s)) {
        orderbookIntegrityMap.set(s, new OrderbookIntegrityMonitor(s));
    }
    return orderbookIntegrityMap.get(s)!;
};

// [PHASE 1 & 2] New Getters
const getBackfill = (s: string) => { if (!backfillMap.has(s)) backfillMap.set(s, new KlineBackfill(s)); return backfillMap.get(s)!; };
const getOICalc = (s: string) => { if (!oiCalculatorMap.has(s)) oiCalculatorMap.set(s, new OICalculator(s, BINANCE_REST_BASE)); return oiCalculatorMap.get(s)!; };
const getStrategy = (s: string) => { if (!strategyMap.has(s)) strategyMap.set(s, new NewStrategyV11({}, decisionLog)); return strategyMap.get(s)!; };
const getSpotReference = (s: string) => {
    if (!spotReferenceMonitors.has(s)) {
        const monitor = new SpotReferenceMonitor(s);
        monitor.start();
        spotReferenceMonitors.set(s, monitor);
    }
    return spotReferenceMonitors.get(s)!;
};
const getHtfMonitor = (s: string) => {
    if (!htfMonitors.has(s)) {
        const monitor = new HtfStructureMonitor(s, BINANCE_REST_BASE);
        monitor.start();
        htfMonitors.set(s, monitor);
    }
    return htfMonitors.get(s)!;
};

function ensureMonitors(symbol: string) {
    getAdvancedMicro(symbol);
    getHtfMonitor(symbol);

    const backfill = getBackfill(symbol);
    const bootstrapState = backfillCoordinator.getState(symbol);
    if (!bootstrapState.done || bootstrapState.barsLoaded1m <= 0) {
        void backfillCoordinator.ensure(symbol);
    }
    const klines = backfillCoordinator.getKlines(symbol);
    if (klines && klines.length > 0) {
        backfill.updateFromKlines(klines);
    } else if (!bootstrapState.inProgress && bootstrapState.lastError) {
        backfill.markBackfillError(bootstrapState.lastError);
    }

    if (!oiCalculatorMap.has(symbol)) {
        const oi = getOICalc(symbol);
        oi.update().catch(e => log('OI_INIT_ERROR', { symbol, error: e.message }));
    }

    if (!fundingMonitors.has(symbol)) {
        const m = new FundingMonitor(symbol);
        m.onUpdate(d => {
            lastFunding.set(symbol, d);
            if (BACKFILL_RECORDING_ENABLED) {
                void marketArchive.recordFunding(symbol, d, Date.now());
            }
        });
        m.start();
        fundingMonitors.set(symbol, m);
    }

    if (ENABLE_CROSS_MARKET_CONFIRMATION) {
        getSpotReference(symbol);
    }
}

// =============================================================================
// Binance Interactions
// =============================================================================

async function fetchExchangeInfo() {
    if (exchangeInfoCache && (Date.now() - exchangeInfoCache.timestamp < EXCHANGE_INFO_TTL_MS)) {
        return exchangeInfoCache.data;
    }
    const fallbackSymbols = buildSymbolFallbackList();
    try {
        log('EXCHANGE_INFO_REQ', { url: `${BINANCE_REST_BASE}/fapi/v1/exchangeInfo` });
        const res = await fetchWithTimeout(`${BINANCE_REST_BASE}/fapi/v1/exchangeInfo`, BINANCE_EXCHANGE_INFO_TIMEOUT_MS);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data: any = await res.json();
        const symbols = data.symbols
            .filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
            .map((s: any) => s.symbol).sort();
        exchangeInfoCache = { data: { symbols }, timestamp: Date.now() };
        return exchangeInfoCache.data;
    } catch (e: any) {
        log('EXCHANGE_INFO_ERROR', { error: e.message });
        return exchangeInfoCache?.data || { symbols: fallbackSymbols };
    }
}

// [P0-FIX-4] Snapshot processing pause flag per symbol
// (declared once in global state section)

async function fetchSnapshot(symbol: string, trigger: string, force = false) {
    const meta = getMeta(symbol);
    const ob = getOrderbook(symbol);
    const now = Date.now();

    // [P0-FIX-5] Mark snapshot in progress to pause diff processing
    snapshotInProgress.set(symbol, true);
    meta.isResyncing = true;

    if (now < globalBackoffUntil) {
        log('SNAPSHOT_SKIP_GLOBAL', { symbol, wait: globalBackoffUntil - now });
        meta.isResyncing = false;
        snapshotInProgress.set(symbol, false);
        return;
    }

    const waitMs = Math.max(SNAPSHOT_MIN_INTERVAL_MS, meta.backoffMs);
    if (!force && now - meta.lastSnapshotAttempt < waitMs) {
        meta.snapshotSkipEvents.push(now);
        log('SNAPSHOT_SKIP_LOCAL', { symbol, trigger, force, wait: waitMs - (now - meta.lastSnapshotAttempt) });
        return;
    }

    if (force) {
        // [P0-FIX-6] Force mode: Complete cleanup before snapshot fetch
        // Clear all pending diffs to prevent stale merge
        meta.depthQueue = [];
        meta.isProcessingDepthQueue = false;
        processingSymbols.delete(symbol);
        meta.goodSequenceStreak = 0;

        // Reset orderbook to clean state
        resetOrderbookState(ob, { uiState: 'SNAPSHOT_PENDING', keepStats: true, desync: true });
        getIntegrity(symbol).markResyncStart(now);

        log('SNAPSHOT_FORCE_CLEANUP', { symbol, trigger, queueCleared: true });
    }

    meta.lastSnapshotAttempt = now;
    meta.isResyncing = true;
    transitionOrderbookState(symbol, 'SNAPSHOT_PENDING', trigger);

    try {
        log('SNAPSHOT_REQ', { symbol, trigger });
        const res = await fetchWithTimeout(
            `${BINANCE_REST_BASE}/fapi/v1/depth?symbol=${symbol}&limit=1000`,
            BINANCE_SNAPSHOT_TIMEOUT_MS
        );

        meta.lastSnapshotHttpStatus = res.status;

        if (res.status === 429 || res.status === 418) {
            const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10) * 1000;
            const weight = res.headers.get('x-mbx-used-weight-1m');
            globalBackoffUntil = Date.now() + retryAfter;
            meta.backoffMs = Math.min(meta.backoffMs * 2, MAX_BACKOFF_MS);
            log('SNAPSHOT_429', { symbol, retryAfter, backoff: meta.backoffMs, weight });
            transitionOrderbookState(symbol, 'HALTED', 'snapshot_429', { retryAfter });
            return;
        }

        if (!res.ok) {
            log('SNAPSHOT_FAIL', { symbol, trigger, status: res.status });
            meta.backoffMs = Math.min(meta.backoffMs * 2, MAX_BACKOFF_MS);
            meta.consecutiveErrors++;
            transitionOrderbookState(symbol, 'RESYNCING', 'snapshot_http_fail', { status: res.status });
            return;
        }

        const data: any = await res.json();
        transitionOrderbookState(symbol, 'APPLYING_SNAPSHOT', 'snapshot_received', { lastUpdateId: data.lastUpdateId });

        const snapshotResult = applySnapshot(ob, data);
        meta.lastSnapshotOk = now;
        meta.snapshotOkEvents.push(now);
        meta.snapshotLastUpdateId = data.lastUpdateId;
        meta.backoffMs = MIN_BACKOFF_MS;
        meta.consecutiveErrors = 0;
        meta.isResyncing = false;
        meta.snapshotCount++;
        meta.goodSequenceStreak = snapshotResult.ok ? Math.max(meta.goodSequenceStreak, snapshotResult.appliedCount) : 0;

        log('SNAPSHOT_TOP', {
            symbol,
            snapshotLastUpdateId: data.lastUpdateId,
            bestBid: bestBid(ob),
            bestAsk: bestAsk(ob),
            bidsCount: ob.bids.size,
            asksCount: ob.asks.size,
            bufferedApplied: snapshotResult.appliedCount,
            bufferedDropped: snapshotResult.droppedCount,
            gapDetected: snapshotResult.gapDetected
        });

        // [P0-FIX-7] Snapshot sonrası queue validation
        if (snapshotResult.ok) {
            getIntegrity(symbol).resetAfterSnapshot(now);

            // [P0-FIX-8] Validate queue'daki diff'ler snapshot ile uyumlu mu?
            const lastUpdateId = ob.lastUpdateId;
            const validQueueItems = meta.depthQueue.filter(u => u.u > lastUpdateId);
            const staleQueueItems = meta.depthQueue.length - validQueueItems.length;

            if (staleQueueItems > 0) {
                log('SNAPSHOT_QUEUE_CLEANUP', { symbol, staleItems: staleQueueItems, lastUpdateId });
                meta.depthQueue = validQueueItems;
            }

            // Release snapshot lock
            snapshotInProgress.set(symbol, false);
            meta.isResyncing = false;

            transitionOrderbookState(symbol, 'LIVE', 'snapshot_applied_success');
            log('SNAPSHOT_OK', { symbol, trigger, lastUpdateId: data.lastUpdateId, queueValid: validQueueItems.length });
            recordLiveSample(symbol, true);
        } else {
            // [P0-FIX-9] Buffer gap detected - clear queue and force resync
            meta.depthQueue = [];
            snapshotInProgress.set(symbol, false);
            meta.isResyncing = false;

            transitionOrderbookState(symbol, 'RESYNCING', 'snapshot_buffer_gap_detected');
            log('SNAPSHOT_BUFFER_GAP', { symbol, trigger, lastUpdateId: data.lastUpdateId, queueCleared: true });
        }

    } catch (e: any) {
        log('SNAPSHOT_ERR', { symbol, err: e.message });
        meta.backoffMs = Math.min(meta.backoffMs * 2, MAX_BACKOFF_MS);
        transitionOrderbookState(symbol, 'RESYNCING', 'snapshot_exception', { error: e.message });
    } finally {
        meta.isResyncing = false;
    }
}

// =============================================================================
// WebSocket Multiplexer
// =============================================================================

let ws: WebSocket | null = null;
let wsState = 'disconnected';
let activeSymbols = new Set<string>();
const dryRunForcedSymbols = new Set<string>();
const wsManager = new WebSocketManager({
    onSubscriptionsChanged: () => {
        updateStreams();
    },
    log: (event, data = {}) => {
        log(event, data);
    },
    heartbeatIntervalMs: CLIENT_HEARTBEAT_INTERVAL_MS,
    staleConnectionMs: CLIENT_STALE_CONNECTION_MS,
    maxSubscriptionsPerClient: WS_MAX_SUBSCRIPTIONS,
});
let autoScaleForcedSingle = false;
const healthController = new HealthController(wsManager, {
    getLatencySnapshot: () => latencyTracker.snapshot(),
    getReadinessState: () => ({
        wsConnected: wsState === 'connected',
        riskState: RISK_ENGINE_ENABLED ? institutionalRiskEngine.getRiskState() : 'TRACKING',
        killSwitchActive: Boolean(
            KILL_SWITCH
            || (RISK_ENGINE_ENABLED && institutionalRiskEngine.getRiskState() === RiskState.KILL_SWITCH)
        ),
        memoryThresholdPercent: Number(productionRuntimeConfig.system.memoryThreshold || 85),
    }),
});
const productionReadinessSystem = initializeProductionReadiness(
    {
        version: 'phase-7',
        environment: process.env.NODE_ENV || 'development',
        enableGracefulShutdown: true,
    },
    {
        getClientCount: () => wsManager.getClientCount(),
        getReadinessState: () => ({
            wsConnected: wsState === 'connected',
            riskState: RISK_ENGINE_ENABLED ? institutionalRiskEngine.getRiskState() : 'TRACKING',
            killSwitchActive: Boolean(
                KILL_SWITCH
                || (RISK_ENGINE_ENABLED && institutionalRiskEngine.getRiskState() === RiskState.KILL_SWITCH)
            ),
            memoryThresholdPercent: Number(productionRuntimeConfig.system.memoryThreshold || 85),
        }),
    }
);

function updateDryRunHealthFlag(): void {
    const dryRunActive = dryRunSession.getStatus().running;
    const abTestActive = abTestManager.getSnapshot().status === 'RUNNING';
    healthController.setDryRunActive(dryRunActive || abTestActive);
}

function buildDepthStream(symbolLower: string): string {
    const speedSuffix = WS_UPDATE_SPEED === '250ms' ? '' : `@${WS_UPDATE_SPEED}`;
    if (DEPTH_STREAM_MODE === 'partial') {
        return `${symbolLower}@depth${DEPTH_LEVELS}${speedSuffix}`;
    }
    return `${symbolLower}@depth${speedSuffix}`;
}

function updateStreams() {
    const forcedSorted = [...dryRunForcedSymbols].sort();
    const requiredSorted = wsManager.getRequiredSymbols();
    const baseLimit = Math.max(AUTO_SCALE_MIN_SYMBOLS, symbolConcurrencyLimit);
    const effectiveLimit = Math.max(baseLimit, requiredSorted.length, forcedSorted.length);
    const limitedSymbols = requiredSorted.slice(0, effectiveLimit);
    const effective = new Set<string>([...forcedSorted, ...limitedSymbols]);

    // Debug Log
    if (requiredSorted.length > 0 || forcedSorted.length > 0) {
        log('AUTO_SCALE_DEBUG', {
            forced: forcedSorted,
            requestedCount: requiredSorted.length,
            requested: requiredSorted,
            activeLimit: symbolConcurrencyLimit,
            limitCalculated: effectiveLimit,
            baseLimit,
            kept: limitedSymbols,
            dropped: requiredSorted.slice(limitedSymbols.length),
        });
    }

    if (requiredSorted.length > limitedSymbols.length) {
        log('AUTO_SCALE_APPLIED', {
            requested: requiredSorted.length,
            activeLimit: symbolConcurrencyLimit,
            limitCalculated: effectiveLimit,
            kept: limitedSymbols,
            dropped: requiredSorted.slice(limitedSymbols.length),
        });
    }

    // Simple diff check
    if (effective.size === activeSymbols.size && [...effective].every(s => activeSymbols.has(s))) {
        if (ws && ws.readyState === WebSocket.OPEN) return;
    }

    if (effective.size === 0) {
        if (ws) ws.close();
        ws = null;
        wsState = 'disconnected';
        activeSymbols.clear();
        return;
    }

    if (ws) ws.close();

    activeSymbols = new Set(effective);
    const streams = [...activeSymbols].flatMap(s => {
        const l = s.toLowerCase();
        return [buildDepthStream(l), `${l}@trade`];
    });

    const url = `${BINANCE_WS_BASE}?streams=${streams.join('/')}`;
    log('WS_CONNECT', { count: activeSymbols.size, url });

    wsState = 'connecting';
    const socket = new WebSocket(url);
    ws = socket;

    socket.on('open', () => {
        // Ignore stale events from an older socket instance.
        if (ws !== socket) return;
        wsState = 'connected';
        log('WS_OPEN', {});

        activeSymbols.forEach((symbol) => {
            const ob = getOrderbook(symbol);
            const meta = getMeta(symbol);

            // [P0-FIX-14] Full reset on WebSocket open - eski state ile devam ETME
            meta.depthQueue = []; // Tüm bekleyen diff'leri temizle
            meta.isProcessingDepthQueue = false;
            processingSymbols.delete(symbol);
            meta.isResyncing = false;
            meta.goodSequenceStreak = 0;

            // Orderbook state'ini sıfırla
            resetOrderbookState(ob, { uiState: 'SNAPSHOT_PENDING', keepStats: true, desync: true });

            // [P0-FIX-15] Snapshot zorunluluğu - force=true ile ALWAYS snapshot al
            ob.snapshotRequired = true;
            transitionOrderbookState(symbol, 'SNAPSHOT_PENDING', 'ws_open_seed');

            // [P0-FIX-16] Sequential snapshot fetch to avoid race conditions
            fetchSnapshot(symbol, 'ws_open_seed', true)
                .then(() => {
                    log('WS_OPEN_SNAPSHOT_OK', { symbol });
                })
                .catch((e) => {
                    log('WS_OPEN_SNAPSHOT_ERR', { symbol, error: e.message });
                    // Retry after delay
                    setTimeout(() => {
                        if (wsState === 'connected') {
                            fetchSnapshot(symbol, 'ws_open_retry', true).catch(() => {});
                        }
                    }, 2000);
                });
        });
    });

    socket.on('message', (raw: any) => {
        if (ws !== socket) return;
        handleMsg(raw);
    });

    socket.on('close', () => {
        if (ws !== socket) return;
        wsState = 'disconnected';
        ws = null;
        log('WS_CLOSE', {});
        const now = Date.now();
        for (const symbol of activeSymbols) {
            const meta = getMeta(symbol);
            const ob = getOrderbook(symbol);

            // [P0-FIX-2] Full state reset on reconnect - queue temizleme
            meta.depthQueue = []; // Tüm bekleyen diff'leri temizle
            meta.isProcessingDepthQueue = false;
            processingSymbols.delete(symbol); // Lock'u serbest bırak
            meta.isResyncing = false;
            meta.goodSequenceStreak = 0;

            // Orderbook state'ini tamamen sıfırla
            resetOrderbookState(ob, { uiState: 'SNAPSHOT_PENDING', keepStats: true, desync: true });
            getIntegrity(symbol).markReconnect(now);

            // [P0-FIX-3] Snapshot zorunluluğu - eski state ile devam etme
            ob.snapshotRequired = true;
            transitionOrderbookState(symbol, 'SNAPSHOT_PENDING', 'ws_reconnect_reset');
        }
        setTimeout(updateStreams, 5000);
    });

    socket.on('error', (e) => {
        if (ws !== socket) return;
        log('WS_ERROR', { msg: e.message });
    });
}




function enqueueDepthUpdate(symbol: string, update: { U: number; u: number; pu?: number; b: [string, string][]; a: [string, string][]; eventTimeMs: number; receiptTimeMs: number }) {
    const meta = getMeta(symbol);

    // [P0-FIX-10] Skip diff processing if snapshot is in progress
    if (snapshotInProgress.get(symbol) === true) {
        log('DEPTH_UPDATE_DEFERRED', { symbol, U: update.U, u: update.u, reason: 'snapshot_in_progress' });
        // Still queue but don't process yet
        meta.depthQueue.push(update);
        return;
    }

    // [P0-FIX-11] Skip if resyncing
    if (meta.isResyncing) {
        log('DEPTH_UPDATE_DEFERRED', { symbol, U: update.U, u: update.u, reason: 'resync_in_progress' });
        meta.depthQueue.push(update);
        return;
    }

    meta.depthQueue.push(update);
    if (meta.depthQueue.length > DEPTH_QUEUE_MAX) {
        requestOrderbookResync(symbol, 'queue_overflow', { max: DEPTH_QUEUE_MAX });
        return;
    }
    processDepthQueue(symbol).catch((e) => {
        log('DEPTH_QUEUE_PROCESS_ERR', { symbol, error: e.message });
    });
}

// [P0-FIX-1] Atomic queue processing with symbol-level lock
// (declared once in global state section)

async function processDepthQueue(symbol: string) {
    const meta = getMeta(symbol);

    // Atomic check-and-set for symbol-level lock
    if (processingSymbols.has(symbol)) {
        return;
    }
    processingSymbols.add(symbol);
    meta.isProcessingDepthQueue = true;

    try {
        // [P0-FIX-2] Skip processing if resync is in progress
        if (meta.isResyncing) {
            return;
        }

        // [P0-FIX-27] Sort queue by U (sequence start) to handle out-of-order diffs
        if (meta.depthQueue.length > 1) {
            meta.depthQueue.sort((a, b) => a.U - b.U);
        }

        // [P0-FIX-28] Remove duplicate sequence IDs
        const seen = new Set<number>();
        meta.depthQueue = meta.depthQueue.filter(u => {
            if (seen.has(u.u)) return false;
            seen.add(u.u);
            return true;
        });

        while (meta.depthQueue.length > 0) {
            const update = meta.depthQueue.shift()!;
            const now = Date.now();
            const lagMs = now - update.receiptTimeMs;
            latencyTracker.record('depth_ingest_ms', Math.max(0, now - Number(update.eventTimeMs || now)));
            if (lagMs > DEPTH_LAG_MAX_MS) {
                requestOrderbookResync(symbol, 'lag_too_high', { lagMs, max: DEPTH_LAG_MAX_MS });
                break;
            }

            const ob = getOrderbook(symbol);
            ob.lastSeenU_u = `${update.U}-${update.u}`;
            ob.lastDepthTime = now;

            // [P0-FIX-12] Monotonic sequence validation
            const lastUpdateId = ob.lastUpdateId;
            if (update.U <= lastUpdateId && update.u <= lastUpdateId) {
                // Completely stale update, drop it
                log('DEPTH_UPDATE_STALE', { symbol, U: update.U, u: update.u, lastUpdateId });
                continue;
            }

            if (update.U > lastUpdateId + 1) {
                // [P0-FIX-13] Gap detected - U should be lastUpdateId + 1
                log('DEPTH_GAP_DETECTED', { symbol, U: update.U, u: update.u, lastUpdateId, expected: lastUpdateId + 1 });

                // Re-queue this update and trigger resync
                meta.depthQueue.unshift(update);
                requestOrderbookResync(symbol, 'sequence_gap', { U: update.U, u: update.u, lastUpdateId });
                break;
            }

            const applied = applyDepthUpdate(ob, update);
            if (!applied.ok && applied.gapDetected) {
                log('DEPTH_DESYNC', { symbol, U: update.U, u: update.u, lastUpdateId: ob.lastUpdateId });
                requestOrderbookResync(symbol, 'sequence_gap', { U: update.U, u: update.u, lastUpdateId: ob.lastUpdateId });
                break;
            }

            if (!applied.applied) {
                // While waiting for a mandatory snapshot or reordering window, ignore this diff.
                continue;
            }

            if (RESILIENCE_PATCHES_ENABLED) {
                const eventTs = Number(update.eventTimeMs || now);
                for (const [priceStr, qtyStr] of update.b) {
                    const price = Number(priceStr);
                    const qty = Number(qtyStr);
                    if (Number.isFinite(price) && price > 0) {
                        resiliencePatches.recordOrderActivity(
                            symbol,
                            price,
                            'bid',
                            Number.isFinite(qty) ? Math.max(0, qty) : 0,
                            qty === 0 ? 'cancel' : 'modify',
                            eventTs
                        );
                    }
                }
                for (const [priceStr, qtyStr] of update.a) {
                    const price = Number(priceStr);
                    const qty = Number(qtyStr);
                    if (Number.isFinite(price) && price > 0) {
                        resiliencePatches.recordOrderActivity(
                            symbol,
                            price,
                            'ask',
                            Number.isFinite(qty) ? Math.max(0, qty) : 0,
                            qty === 0 ? 'cancel' : 'modify',
                            eventTs
                        );
                    }
                }
                const bb = Number(bestBid(ob) || 0);
                const ba = Number(bestAsk(ob) || 0);
                if (bb > 0 && ba > 0) {
                    resiliencePatches.recordOrderbook(symbol, bb, ba, eventTs);
                }
            }

            if (applied.applied) {
                meta.applyCount10s++;
                meta.goodSequenceStreak++;
            }

            const integrity = getIntegrity(symbol).observe({
                symbol,
                sequenceStart: update.U,
                sequenceEnd: update.u,
                prevSequenceEnd: update.pu,
                eventTimeMs: update.eventTimeMs || now,
                bestBid: bestBid(ob),
                bestAsk: bestAsk(ob),
                nowMs: now,
            });

            if (integrity.level === 'CRITICAL') {
                alertService.send('ORDERBOOK_INTEGRITY', `${symbol}: ${integrity.message}`, 'CRITICAL');
            } else if (integrity.level === 'DEGRADED') {
                alertService.send('ORDERBOOK_INTEGRITY', `${symbol}: ${integrity.message}`, 'MEDIUM');
            }

            if (integrity.reconnectRecommended && !meta.isResyncing) {
                const timeSinceResync = now - meta.lastResyncTs;
                if (timeSinceResync > MIN_RESYNC_INTERVAL_MS) {
                    getIntegrity(symbol).markReconnect(now);
                    requestOrderbookResync(symbol, 'integrity_reconnect', {
                        level: integrity.level,
                        message: integrity.message,
                    });
                    break;
                }
            }

            evaluateLiveReadiness(symbol);

            const tas = getTaS(symbol);
            const cvd = getCvd(symbol);
            const abs = getAbs(symbol);
            const leg = getLegacy(symbol);
            const advancedMicro = getAdvancedMicro(symbol);
            const top50 = getTopLevels(ob, 50);
            advancedMicro.onDepthSnapshot({
                timestampMs: Number(update.eventTimeMs || now),
                bids: top50.bids,
                asks: top50.asks,
            });
            const absVal = absorptionResult.get(symbol) ?? 0;
            broadcastMetrics(symbol, ob, tas, cvd, absVal, leg, update.eventTimeMs || 0, null, 'depth');

            if (BACKFILL_RECORDING_ENABLED) {
                const lastArchive = meta.lastArchiveSnapshotTs || 0;
                if (now - lastArchive >= BACKFILL_SNAPSHOT_INTERVAL_MS) {
                    const top = getTopLevels(ob, Number(process.env.DRY_RUN_ORDERBOOK_DEPTH || 20));
                    void marketArchive.recordOrderbookSnapshot(symbol, {
                        bids: top.bids,
                        asks: top.asks,
                        lastUpdateId: ob.lastUpdateId || 0,
                    }, Number(update.eventTimeMs || now));
                    meta.lastArchiveSnapshotTs = now;
                }
            }

            if (dryRunSession.isTrackingSymbol(symbol)) {
                const top = getTopLevels(ob, Number(process.env.DRY_RUN_ORDERBOOK_DEPTH || 20));
                const bestBidPx = bestBid(ob);
                const bestAskPx = bestAsk(ob);
                const markPrice = (bestBidPx && bestAskPx)
                    ? (bestBidPx + bestAskPx) / 2
                    : (bestBidPx || bestAskPx || 0);
                try {
                    const ingestStart = Date.now();
                    dryRunSession.ingestDepthEvent({
                        symbol,
                        eventTimestampMs: Number(update.eventTimeMs || 0),
                        markPrice,
                        orderBook: {
                            bids: top.bids.map(([price, qty]) => ({ price, qty })),
                            asks: top.asks.map(([price, qty]) => ({ price, qty })),
                        },
                    });
                    latencyTracker.record('dry_run_ingest_ms', Date.now() - ingestStart);
                    abTestManager.ingestDepthEvent({
                        symbol,
                        eventTimestampMs: Number(update.eventTimeMs || 0),
                        markPrice,
                        orderBook: {
                            bids: top.bids.map(([price, qty]) => ({ price, qty })),
                            asks: top.asks.map(([price, qty]) => ({ price, qty })),
                        },
                    });
                } catch (e: any) {
                    log('DRY_RUN_EVENT_ERROR', { symbol, error: e?.message || 'dry_run_event_failed' });
                }
            }
        }
    } finally {
        // [P0-FIX-29] Always release locks
        meta.isProcessingDepthQueue = false;
        processingSymbols.delete(symbol);

        // [P0-FIX-30] If queue still has items and not resyncing, trigger another processing
        if (meta.depthQueue.length > 0 && !meta.isResyncing && !snapshotInProgress.get(symbol)) {
            setImmediate(() => {
                processDepthQueue(symbol).catch(e => {
                    log('DEPTH_QUEUE_RETRY_ERR', { symbol, error: e.message });
                });
            });
        }
    }
}

function evaluateLiveReadiness(symbol: string) {
    const meta = getMeta(symbol);
    const ob = getOrderbook(symbol);
    const now = Date.now();

    const snapshotFresh = meta.lastSnapshotOk > 0 && (now - meta.lastSnapshotOk) <= LIVE_SNAPSHOT_FRESH_MS;
    const hasBook = ob.bids.size > 0 && ob.asks.size > 0;

    // Data Liveness: Check if depth messages are flowing within GRACE_PERIOD
    // If we just resynced, give it time (MIN_RESYNC_INTERVAL check handles throttle)
    const dataFlowing = (now - meta.lastDepthMsgTs) < GRACE_PERIOD_MS;

    // Consider book "live" when it is populated and either:
    // - recent depth updates are flowing, or
    // - a fresh snapshot was just applied.
    // This avoids forced resync loops every snapshot TTL when depth is healthy.
    const isLiveCondition = hasBook && (dataFlowing || snapshotFresh);

    if (isLiveCondition) {
        // We look good foundationally. Check data flow.
        if (ob.uiState !== 'LIVE') {
            transitionOrderbookState(symbol, 'LIVE', 'live_criteria_met', {
                fresh: snapshotFresh,
                dataFlowing,
                dataLag: now - meta.lastDepthMsgTs
            });
        }
        recordLiveSample(symbol, true);
    } else {
        recordLiveSample(symbol, false);

        // Trigger Resync only if allowed by throttle
        const timeSinceResync = now - meta.lastResyncTs;
        const canResync = timeSinceResync > MIN_RESYNC_INTERVAL_MS;

        if (canResync && !meta.isResyncing) {
            requestOrderbookResync(symbol, 'live_criteria_failed_throttled', {
                fresh: snapshotFresh,
                dataFlowing,
                dataLag: now - meta.lastDepthMsgTs,
                hasBook,
                timeSinceResync
            });
        }
    }
}

function runAutoScaler() {
    const symbols = Array.from(activeSymbols);
    if (symbols.length === 0) {
        return;
    }

    const avgLive = symbols.reduce((acc, s) => acc + liveUptimePct60s(s), 0) / symbols.length;
    const now = Date.now();

    if (avgLive < AUTO_SCALE_LIVE_DOWN_PCT && symbolConcurrencyLimit > AUTO_SCALE_MIN_SYMBOLS) {
        symbolConcurrencyLimit = AUTO_SCALE_MIN_SYMBOLS;
        autoScaleForcedSingle = true;
        log('AUTO_SCALE_DOWN', { avgLiveUptimePct60s: Number(avgLive.toFixed(2)), symbolConcurrencyLimit });
        updateStreams();
        return;
    }

    if (avgLive > AUTO_SCALE_LIVE_UP_PCT) {
        if (autoScaleLastUpTs === 0) {
            autoScaleLastUpTs = now;
        }
        const heldLongEnough = now - autoScaleLastUpTs >= AUTO_SCALE_UP_HOLD_MS;
        if (heldLongEnough && autoScaleForcedSingle) {
            symbolConcurrencyLimit = Math.max(symbolConcurrencyLimit + 1, AUTO_SCALE_MIN_SYMBOLS + 1);
            autoScaleForcedSingle = false;
            autoScaleLastUpTs = now;
            log('AUTO_SCALE_UP', { avgLiveUptimePct60s: Number(avgLive.toFixed(2)), symbolConcurrencyLimit });
            updateStreams();
        }
        return;
    }

    autoScaleLastUpTs = 0;
}

async function processSymbolEvent(s: string, d: any) {
    const e = d.e;
    const ob = getOrderbook(s);
    const meta = getMeta(s);
    const now = Date.now();

    if (e === 'depthUpdate') {
        meta.depthMsgCount++;
        meta.depthMsgCount10s++;
        meta.lastDepthMsgTs = now;
        healthController.setLastDataReceivedAt(now);
        marketDataMonitor.recordDataArrival(s, Number(d.E || d.T || now));

        ensureMonitors(s);
        enqueueDepthUpdate(s, {
            U: Number(d.U || 0),
            u: Number(d.u || 0),
            pu: Number(d.pu || 0),
            b: Array.isArray(d.b) ? d.b : [],
            a: Array.isArray(d.a) ? d.a : [],
            eventTimeMs: Number(d.E || d.T || now),
            receiptTimeMs: now,
        });
    } else if (e === 'trade') {
        ensureMonitors(s);
        meta.tradeMsgCount++;
        healthController.setLastDataReceivedAt(now);
        const rawPrice = parseFloat(d.p);
        const rawQty = parseFloat(d.q);
        const rawTs = Number(d.T || now);
        const validatedTrade = marketDataValidator.validate({
            symbol: s,
            price: rawPrice,
            quantity: rawQty,
            timestamp: rawTs,
        });
        if (!validatedTrade) {
            return;
        }
        marketDataMonitor.recordDataArrival(s, validatedTrade.timestamp);

        const p = validatedTrade.price;
        const q = validatedTrade.quantity;
        const t = validatedTrade.timestamp;
        const side = d.m ? 'sell' : 'buy';
        latencyTracker.record('trade_ingest_ms', Math.max(0, now - Number(t || now)));
        if (p > 0) {
            portfolioMonitor.ingestPrice(s, p);
            try {
                analyticsEngine.ingestPrice({
                    type: 'PRICE_TICK',
                    symbol: s,
                    markPrice: p,
                    timestamp: Number(t || now),
                });
            } catch (error) {
                logAnalyticsError('price_tick', s, error);
            }
            if (RESILIENCE_PATCHES_ENABLED) {
                const bestBidNow = Number(bestBid(ob) || 0);
                const bestAskNow = Number(bestAsk(ob) || 0);
                const fallbackBid = bestBidNow > 0 ? bestBidNow : p;
                const fallbackAsk = bestAskNow > 0 ? bestAskNow : p;
                resiliencePatches.recordPriceTick(
                    s,
                    p,
                    Number(q || 0),
                    fallbackBid,
                    fallbackAsk,
                    Number(t || now)
                );
                if (fallbackBid > 0 && fallbackAsk > 0) {
                    resiliencePatches.recordOrderbook(s, fallbackBid, fallbackAsk, Number(t || now));
                }
            }
        }

        if (dryRunSession.isTrackingSymbol(s)) {
            const hasDepth = ob.uiState === 'LIVE' && ob.bids.size > 0 && ob.asks.size > 0;
            if (!hasDepth && Number.isFinite(p) && p > 0) {
                const spreadBps = Number(process.env.DRY_RUN_SYNTH_SPREAD_BPS || 2);
                const qty = Number(process.env.DRY_RUN_SYNTH_QTY || 5);
                const bid = p * (1 - (spreadBps / 10000));
                const ask = p * (1 + (spreadBps / 10000));
                try {
                    dryRunSession.ingestDepthEvent({
                        symbol: s,
                        eventTimestampMs: Number(t || now),
                        markPrice: p,
                        orderBook: {
                            bids: [{ price: bid, qty }],
                            asks: [{ price: ask, qty }],
                        },
                    });
                } catch (e: any) {
                    log('DRY_RUN_SYNTH_DEPTH_ERROR', { symbol: s, error: e?.message || 'dry_run_synth_depth_failed' });
                }
            }
        }
        if (BACKFILL_RECORDING_ENABLED && Number.isFinite(p) && Number.isFinite(q)) {
            void marketArchive.recordTrade(s, { price: p, quantity: q, side }, Number(t || now));
        }

        const tas = getTaS(s);
        const cvd = getCvd(s);
        const abs = getAbs(s);
        const leg = getLegacy(s);
        const advancedMicro = getAdvancedMicro(s);

        tas.addTrade({ price: p, quantity: q, side, timestamp: t });
        cvd.addTrade({ price: p, quantity: q, side, timestamp: t });
        leg.addTrade({ price: p, quantity: q, side, timestamp: t });
        const bestBidForTrade = bestBid(ob);
        const bestAskForTrade = bestAsk(ob);
        const midForTrade = (bestBidForTrade && bestAskForTrade) ? (bestBidForTrade + bestAskForTrade) / 2 : null;
        advancedMicro.onTrade({
            timestampMs: Number(t || now),
            price: p,
            quantity: q,
            side,
            midPrice: midForTrade,
        });

        const levelSize = getLevelSize(ob, p) || 0;
        const absVal = abs.addTrade(s, p, side, t, levelSize);
        absorptionResult.set(s, absVal);

        // [NEW_STRATEGY_V1.1] Decision Check (throttled to reduce event-loop pressure)
        const strategy = getStrategy(s);
        const backfill = getBackfill(s);
        const oiMetrics = leg.getOpenInterestMetrics();
        const decisionFlowEnabled = true;
        let decision = meta.lastStrategyDecision;
        let tasMetrics: any = null;
        let legMetrics: any = null;
        let spreadPct: number | null = null;
        let spreadRatio: number | null = null;
        let mid = p;

        const shouldEvaluateStrategy = decisionFlowEnabled
            && (!decision || (now - meta.lastStrategyEvalTs) >= STRATEGY_EVAL_MIN_INTERVAL_MS);
        if (shouldEvaluateStrategy) {
            const calcStart = Date.now();
            legMetrics = leg.computeMetrics(ob, Number(t || now));
            tasMetrics = tas.computeMetrics();
            const integrity = getIntegrity(s).getStatus(now);
            const bestBidPx = bestBid(ob);
            const bestAskPx = bestAsk(ob);
            mid = (bestBidPx && bestAskPx) ? (bestBidPx + bestAskPx) / 2 : p;
            spreadRatio = (bestBidPx && bestAskPx && mid)
                ? ((bestAskPx - bestBidPx) / mid)
                : null;
            spreadPct = spreadRatio == null ? null : (spreadRatio * 100);

            decision = strategy.evaluate({
                symbol: s,
                nowMs: Number(t || now),
                source: oiMetrics?.source ?? 'real',
                orderbook: {
                    lastUpdatedMs: integrity.lastUpdateTimestamp || now,
                    spreadPct,
                    bestBid: bestBidPx,
                    bestAsk: bestAskPx,
                },
                trades: {
                    lastUpdatedMs: Number(t || now),
                    printsPerSecond: tasMetrics.printsPerSecond,
                    tradeCount: tasMetrics.tradeCount,
                    aggressiveBuyVolume: tasMetrics.aggressiveBuyVolume,
                    aggressiveSellVolume: tasMetrics.aggressiveSellVolume,
                    consecutiveBurst: tasMetrics.consecutiveBurst,
                },
                market: {
                    price: p,
                    vwap: legMetrics?.vwap || mid || p,
                    delta1s: legMetrics?.delta1s || 0,
                    delta5s: legMetrics?.delta5s || 0,
                    deltaZ: legMetrics?.deltaZ || 0,
                    cvdSlope: legMetrics?.cvdSlope || 0,
                    obiWeighted: legMetrics?.obiWeighted || 0,
                    obiDeep: legMetrics?.obiDeep || 0,
                    obiDivergence: legMetrics?.obiDivergence || 0,
                },
                openInterest: oiMetrics ? {
                    oiChangePct: oiMetrics.oiChangePct,
                    lastUpdatedMs: oiMetrics.lastUpdated,
                    source: oiMetrics.source,
                } : null,
                absorption: {
                    value: absVal,
                    side: absVal ? side : null,
                },
                volatility: backfill.getState().atr || 0,
                position: dryRunSession.getStrategyPosition(s),
            });
            meta.lastStrategyDecision = decision;
            meta.lastStrategyEvalTs = now;
            latencyTracker.record('strategy_calc_ms', Date.now() - calcStart);
        }

        const oiPanel = getOICalc(s).getMetrics();
        const resolvedOI = oiMetrics
            ? {
                currentOI: oiMetrics.openInterest,
                oiChangeAbs: oiMetrics.oiChangeAbs,
                oiChangePct: oiMetrics.oiChangePct,
                lastUpdated: oiMetrics.lastUpdated,
            }
            : {
                currentOI: oiPanel.currentOI,
                oiChangeAbs: oiPanel.oiChangeAbs,
                oiChangePct: oiPanel.oiChangePct,
                lastUpdated: oiPanel.lastUpdated,
            };
        advancedMicro.onDerivativesSnapshot({
            timestampMs: Number(t || now),
            funding: lastFunding.get(s) || null,
            openInterest: resolvedOI,
            lastPrice: p,
        });
        const spotMetrics: SpotReferenceMetrics | null = ENABLE_CROSS_MARKET_CONFIRMATION
            ? getSpotReference(s).getMetrics()
            : null;
        const btcRefRet = advancedMicroMap.get('BTCUSDT')?.getLatestReturn() ?? null;
        const ethRefRet = advancedMicroMap.get('ETHUSDT')?.getLatestReturn() ?? null;
        advancedMicro.updateCrossMarket({
            timestampMs: Number(t || now),
            enableCrossMarketConfirmation: ENABLE_CROSS_MARKET_CONFIRMATION,
            btcReturn: btcRefRet,
            ethReturn: ethRefRet,
            spotReference: spotMetrics
                ? {
                    timestampMs: spotMetrics.lastUpdated,
                    midPrice: spotMetrics.midPrice,
                    imbalance10: spotMetrics.imbalance10,
                }
                : null,
        });
        const advancedBundle = advancedMicro.getMetrics(Number(t || now));

        // [DRY RUN INTEGRATION]
        const isDryRunTracked = dryRunSession.isTrackingSymbol(s);
        if (shouldEvaluateStrategy && decision) {
            if (isDryRunTracked) {
                if ((Number(t || now) % 20) === 0) {
                    log('DRY_RUN_STRATEGY_CHECK', {
                        symbol: s,
                        regime: decision.regime,
                        dfsP: decision.dfsPercentile,
                        gate: decision.gatePassed
                    });
                }
                dryRunSession.submitStrategyDecision(s, decision, Number(t || now));
            }

            abTestManager.submitStrategyDecision(s, decision, Number(t || now));
        }

        // Broadcast (reuse precomputed metrics when available)
        broadcastMetrics(
            s,
            ob,
            tas,
            cvd,
            absVal,
            leg,
            t,
            decision,
            'trade',
            shouldEvaluateStrategy
                ? { tasMetrics, legacyMetrics: legMetrics, advancedBundle }
                : { advancedBundle }
        );
    }
}

function classifyCVDState(delta: number): 'Normal' | 'High Vol' | 'Extreme' {
    const absD = Math.abs(delta);
    if (absD > 1000000) return 'Extreme';
    if (absD > 250000) return 'High Vol';
    return 'Normal';
}

function defaultOrchestratorDecision(symbol: string, nowMs: number): OrchestratorV1Decision {
    return {
        symbol,
        timestampMs: nowMs,
        intent: 'HOLD',
        side: null,
        readiness: { ready: false, reasons: ['ORCHESTRATOR_INPUT_MISSING'] },
        gateA: { passed: false, reason: 'GATE_A_BLOCK', checks: {} },
        gateB: { passed: false, reason: 'GATE_B_BLOCK', checks: {} },
        gateC: { passed: false, reason: 'GATE_C_BLOCK', checks: {} },
        allGatesPassed: false,
        impulse: {
            passed: false,
            checks: {
                printsPerSecond: false,
                deltaZ: false,
                spread: false,
            },
        },
        add: {
            triggered: false,
            step: null,
            gatePassed: false,
            rateLimitPassed: false,
            thresholdPrice: null,
        },
        exitRisk: {
            triggered: false,
            triggeredThisTick: false,
            reason: null,
            makerAttemptsUsed: 0,
            takerUsed: false,
        },
        position: {
            isOpen: false,
            qty: 0,
            entryVwap: null,
            baseQty: 0,
            addsUsed: 0,
            lastAddTs: null,
            cooldownUntilTs: 0,
            atr3m: 0,
            atrSource: 'UNKNOWN',
        },
        orders: [],
        chase: {
            active: false,
            startedAtMs: null,
            expiresAtMs: null,
            repriceMs: 0,
            maxReprices: 0,
            repricesUsed: 0,
            chaseMaxSeconds: 0,
            ttlMs: 0,
        },
        chaseDebug: {
            chaseActive: false,
            chaseStartTs: null,
            chaseElapsedMs: 0,
            chaseAttempts: 0,
            chaseTimedOut: false,
            impulse: false,
            fallbackEligible: false,
            fallbackBlockedReason: 'NO_TIMEOUT' as const,
        },
        crossMarketBlockReason: null,
        telemetry: {
            sideFlipCount5m: 0,
            sideFlipPerMin: 0,
            allGatesTrueCount5m: 0,
            entryIntentCount5m: 0,
            smoothed: {
                deltaZ: 0,
                cvdSlope: 0,
                obiWeighted: 0,
            },
            hysteresis: {
                confirmCountLong: 0,
                confirmCountShort: 0,
                entryConfirmCount: 0,
            },
            chase: {
                chaseStartedCount: 0,
                chaseTimedOutCount: 0,
                chaseElapsedMaxMs: 0,
                fallbackEligibleCount: 0,
                fallbackTriggeredCount: 0,
                fallbackBlocked_NO_TIMEOUT: 0,
                fallbackBlocked_IMPULSE_FALSE: 0,
                fallbackBlocked_GATES_FALSE: 0,
            },
            crossMarket: {
                crossMarketVetoCount: 0,
                crossMarketNeutralCount: 0,
                crossMarketAllowedCount: 0,
                active: false,
                mode: 'DISABLED_NO_BTC' as const,
                disableReason: null,
                anchorSide: 'NONE' as const,
                anchorMode: 'NONE' as const,
                btcHasPosition: false,
                mismatchActive: false,
                mismatchSinceMs: null,
                exitTriggeredCount: 0,
            },
            lastExitReasonCode: null,
            reversal: {
                reversalAttempted: 0,
                reversalBlocked: 0,
                reversalConvertedToExit: 0,
                exitOnFlipCount: 0,
                currentPositionSide: null,
                sideCandidate: null,
                flipPersistenceCount: 0,
                flipFirstDetectedMs: null,
                minFlipIntervalMs: 0,
                entryConfirmations: 0,
            },
            htf: {
                price: 0,
                h1SwingLow: null,
                h1SwingHigh: null,
                h1SBUp: false,
                h1SBDn: false,
                vetoed: false,
                softBiasApplied: false,
                reason: null,
            },
            superScalp: {
                active: false,
                m15SwingLow: null,
                m15SwingHigh: null,
                sweepDetected: false,
                reclaimDetected: false,
                sideCandidate: null,
            },
        },
    };
}

function buildDecisionViewFromOrchestrator(decision: OrchestratorV1Decision) {
    const side = decision.side === 'BUY' ? 'LONG' : (decision.side === 'SELL' ? 'SHORT' : 'NONE');
    const signal = decision.intent === 'ENTRY'
        ? (side === 'LONG' ? 'ENTRY_LONG' : (side === 'SHORT' ? 'ENTRY_SHORT' : 'NONE'))
        : decision.intent === 'ADD'
            ? (side === 'LONG' ? 'POSITION_LONG' : (side === 'SHORT' ? 'POSITION_SHORT' : 'NONE'))
            : 'NONE';
    const score = decision.intent === 'ENTRY'
        ? 100
        : decision.intent === 'ADD'
            ? 80
            : 0;
    const vetoReason = decision.intent === 'HOLD'
        ? (decision.readiness.reasons[0] || decision.gateA.reason || decision.gateB.reason || decision.gateC.reason || 'HOLD')
        : decision.intent === 'EXIT_RISK'
            ? (decision.exitRisk.reason || 'EXIT_RISK')
            : decision.intent === 'EXIT_FLIP'
                ? 'EXIT_FLIP'
                : null;
    const reasonTag = decision.intent === 'ENTRY'
        ? 'ORCHESTRATOR_V1_ENTRY'
        : decision.intent === 'ADD'
            ? `ORCHESTRATOR_V1_ADD_${decision.add.step ?? 'NA'}`
            : decision.intent === 'EXIT_RISK'
                ? `ORCHESTRATOR_V1_EXIT_${decision.exitRisk.reason || 'RISK'}`
                : decision.intent === 'EXIT_FLIP'
                    ? 'ORCHESTRATOR_V1_EXIT_FLIP'
                    : (decision.readiness.reasons[0] || 'ORCHESTRATOR_V1_HOLD');

    return {
        signalDisplay: {
            signal,
            score,
            confidence: score >= 75 ? 'HIGH' as const : score >= 50 ? 'MEDIUM' as const : 'LOW' as const,
            vetoReason,
            candidate: null,
            regime: null,
            dfsPercentile: null,
            actions: decision.orders,
            reasons: [reasonTag],
            gatePassed: decision.allGatesPassed,
        },
        suppressDryRunPosition: true,
    };
}

function applyOrchestratorOrders(symbol: string, decision: OrchestratorV1Decision): void {
    decisionRuntimeStats.addsUsed = Math.max(
        decisionRuntimeStats.addsUsed,
        Number(decision?.position?.addsUsed || 0)
    );
    if (decision.exitRisk.triggeredThisTick) {
        decisionRuntimeStats.exitRiskTriggeredCount += 1;
    }

    const isPreTradeIntent = decision.intent === 'ENTRY' || decision.intent === 'ADD';
    const riskMultiplier = RISK_ENGINE_ENABLED ? institutionalRiskEngine.getPositionMultiplier() : 1;
    if (RISK_ENGINE_ENABLED && isPreTradeIntent && decision.side) {
        observabilityMetrics.recordTradeAttempt();
        const currentPos = dryRunSession.getStrategyPosition(symbol);
        const fallbackPrice = Number(currentPos?.entryPrice || decision.position?.entryVwap || 0) > 0
            ? Number(currentPos?.entryPrice || decision.position?.entryVwap || 0)
            : null;
        const exposure = computeRiskExposureFromOrders(Array.isArray(decision.orders) ? decision.orders : [], fallbackPrice);
        const checkQty = exposure.quantity > 0 ? exposure.quantity : 1;
        const checkNotional = exposure.notional > 0 ? exposure.notional : Math.max(1, riskEngineLastKnownEquity * 0.01);
        const direction = decision.side === 'BUY' ? 'long' as const : 'short' as const;
        const riskCheck = institutionalRiskEngine.canTrade(symbol, checkQty, checkNotional, direction);
        if (!riskCheck.allowed) {
            observabilityMetrics.recordTradeRejected();
            log('RISK_ENGINE_TRADE_REJECTED', {
                symbol,
                intent: decision.intent,
                side: decision.side,
                quantity: checkQty,
                notional: checkNotional,
                reason: riskCheck.reason || 'risk_rejected',
                state: riskCheck.state,
                guards: riskCheck.guards,
                positionMultiplier: riskCheck.positionMultiplier,
            });
            return;
        }
    }

    // Dry Run integration: forward OrchestratorV1 decisions to dryRunSession
    const isDryRunTracked = dryRunSession.isTrackingSymbol(symbol);
    if (isDryRunTracked && (decision.intent === 'ENTRY' || decision.intent === 'ADD' || decision.intent === 'EXIT_RISK' || decision.intent === 'EXIT_FLIP')) {
        const currentPos = dryRunSession.getStrategyPosition(symbol);
        if ((decision.intent === 'ENTRY' || decision.intent === 'ADD') && decision.side) {
            if (RISK_ENGINE_ENABLED && riskMultiplier <= 0) {
                observabilityMetrics.recordTradeRejected();
                log('RISK_ENGINE_TRADE_REJECTED', {
                    symbol,
                    intent: decision.intent,
                    reason: 'position_multiplier_zero',
                    state: institutionalRiskEngine.getRiskState(),
                });
                return;
            }
            const expectedPrice = Array.isArray(decision.orders)
                ? (decision.orders.find((order) => Number(order.price || 0) > 0)?.price ?? null)
                : null;
            submitRiskAwareStrategyDecision(
                symbol,
                decision.side,
                decision.intent === 'ENTRY' ? 'ENTRY' : 'ADD',
                Number(decision.timestampMs || Date.now()),
                riskMultiplier,
                expectedPrice
            );
        } else if ((decision.intent === 'EXIT_RISK' || decision.intent === 'EXIT_FLIP') && currentPos) {
            if (currentPos.side === 'LONG' || currentPos.side === 'SHORT') {
                const exitSignal = currentPos.side === 'LONG' ? 'ENTRY_SHORT' : 'ENTRY_LONG';
                dryRunSession.submitStrategySignal(symbol, {
                    signal: exitSignal,
                    score: 0,
                    vetoReason: null,
                    candidate: null,
                }, decision.timestampMs);
            }
        }
    }

    if (!decision || !Array.isArray(decision.orders) || decision.orders.length === 0) {
        return;
    }
    for (const order of decision.orders) {
        decisionRuntimeStats.ordersAttempted += 1;
        if (order.kind === 'MAKER') {
            decisionRuntimeStats.makerOrdersPlaced += 1;
        } else {
            decisionRuntimeStats.takerOrdersPlaced += 1;
        }
        observabilityMetrics.recordTradeExecuted();
        if (order.kind === 'TAKER_ENTRY_FALLBACK') {
            decisionRuntimeStats.entryTakerNotionalPct = Math.max(
                decisionRuntimeStats.entryTakerNotionalPct,
                Number(order.notionalPct || 0)
            );
            decisionRuntimeStats.takerFillsCount += 1;
        }
        if (RISK_ENGINE_ENABLED) {
            const requestedQty = Math.max(0, Math.abs(Number(order.qty || 0)));
            if (requestedQty > 0) {
                institutionalRiskEngine.recordExecutionEvent(
                    String(order.id || `${symbol}-${decision.timestampMs}-${decisionRuntimeStats.ordersAttempted}`),
                    symbol,
                    'fill',
                    requestedQty,
                    requestedQty
                );
            }
        }
    }
    log('ORCHESTRATOR_V1_ORDERS', {
        symbol,
        intent: decision.intent,
        side: decision.side,
        riskState: RISK_ENGINE_ENABLED ? institutionalRiskEngine.getRiskState() : 'DISABLED',
        riskMultiplier,
        orders: decision.orders.map((order: OrchestratorV1Order) => ({
            id: order.id,
            kind: order.kind,
            side: order.side,
            role: order.role,
            notionalPct: order.notionalPct,
            qty: order.qty,
            price: order.price,
            postOnly: order.postOnly,
            repriceAttempt: order.repriceAttempt,
        })),
        addsUsed: decision.position.addsUsed,
        exitRisk: decision.exitRisk,
    });
}

function handleMsg(raw: any) {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg.data) return;

    const s = msg.data.s;
    if (!s) return;

    const meta = getMeta(s);
    meta.eventQueue.enqueue(msg.data);
}

function broadcastMetrics(
    s: string,
    ob: OrderbookState,
    tas: TimeAndSales,
    cvd: CvdCalculator,
    absVal: number,
    leg: LegacyCalculator,
    eventTimeMs: number,
    decision: any = null,
    reason: 'depth' | 'trade' = 'trade',
    precomputed?: { tasMetrics?: any; cvdMetrics?: any[]; legacyMetrics?: any; advancedBundle?: AdvancedMicrostructureBundle }
) {
    const THROTTLE_MS = 250; // 4Hz max per symbol
    const meta = getMeta(s);
    if (leg) leg.updateOpenInterest();
    const now = Date.now();

    // Throttle check - skip if last broadcast was too recent
    const intervalMs = now - meta.lastBroadcastTs;
    if (intervalMs < THROTTLE_MS) {
        // Throttled - skip but log occasionally
        return;
    }

    const cvdM = precomputed?.cvdMetrics ?? cvd.computeMetrics(Number(eventTimeMs || now));
    const tasMetrics = precomputed?.tasMetrics ?? tas.computeMetrics();
    // Calculate OBI/Legacy if Orderbook has data (bids and asks exist)
    // This allows metrics to continue displaying during brief resyncs
    const hasBookData = ob.bids.size > 0 && ob.asks.size > 0;
    const legacyM = precomputed && Object.prototype.hasOwnProperty.call(precomputed, 'legacyMetrics')
        ? precomputed.legacyMetrics
        : (hasBookData ? leg.computeMetrics(ob, Number(eventTimeMs || now)) : null);
    if (legacyM) {
        meta.lastLegacyMetrics = legacyM;
    }
    const legacyForUse = legacyM || meta.lastLegacyMetrics || null;

    // Top of book
    const { bids, asks } = getTopLevels(ob, 20);
    const bestBidPx = bestBid(ob);
    const bestAskPx = bestAsk(ob);
    const mid = (bestBidPx && bestAskPx) ? (bestBidPx + bestAskPx) / 2 : null;
    const spreadPct = (bestBidPx && bestAskPx && mid && mid > 0)
        ? ((bestAskPx - bestBidPx) / mid) * 100
        : null;
    const sessionVwap = leg.getSessionVwapSnapshot(now, mid);
    const htfSnapshot = getHtfMonitor(s).getSnapshot();

    const oiM = getOICalc(s).getMetrics();
    const oiLegacy = leg.getOpenInterestMetrics();
    const resolvedOpenInterest = oiLegacy ? {
        openInterest: oiLegacy.openInterest,
        oiChangeAbs: oiLegacy.oiChangeAbs,
        oiChangePct: oiLegacy.oiChangePct,
        oiDeltaWindow: oiLegacy.oiDeltaWindow,
        lastUpdated: oiLegacy.lastUpdated,
        source: oiLegacy.source,
        stabilityMsg: oiM.stabilityMsg
    } : {
        openInterest: oiM.currentOI,
        oiChangeAbs: oiM.oiChangeAbs,
        oiChangePct: oiM.oiChangePct,
        oiDeltaWindow: oiM.oiChangeAbs,
        lastUpdated: oiM.lastUpdated,
        source: 'real',
        stabilityMsg: oiM.stabilityMsg
    };
    const bf = getBackfill(s).getState();
    const bootstrapState = backfillCoordinator.getState(s);
    const bootstrapSnapshot = {
        backfillInProgress: Boolean(bootstrapState.inProgress),
        backfillDone: Boolean(bootstrapState.done),
        barsLoaded1m: Number(bootstrapState.barsLoaded1m || 0),
        startedAtMs: Number.isFinite(Number(bootstrapState.startedAtMs)) ? Number(bootstrapState.startedAtMs) : null,
        doneAtMs: Number.isFinite(Number(bootstrapState.doneAtMs)) ? Number(bootstrapState.doneAtMs) : null,
    };
    const integrity = getIntegrity(s).getStatus(now);
    const tf1m = cvdM.find((x: any) => x.timeframe === '1m') || null;
    const tf5m = cvdM.find((x: any) => x.timeframe === '5m') || null;
    const tf15m = cvdM.find((x: any) => x.timeframe === '15m') || null;
    const advancedMicro = getAdvancedMicro(s);
    advancedMicro.onDerivativesSnapshot({
        timestampMs: Number(eventTimeMs || now),
        funding: lastFunding.get(s) || null,
        openInterest: {
            currentOI: resolvedOpenInterest.openInterest,
            oiChangeAbs: resolvedOpenInterest.oiChangeAbs,
            oiChangePct: resolvedOpenInterest.oiChangePct,
            lastUpdated: resolvedOpenInterest.lastUpdated,
        },
        lastPrice: mid,
    });
    const spotMetrics: SpotReferenceMetrics | null = ENABLE_CROSS_MARKET_CONFIRMATION
        ? getSpotReference(s).getMetrics()
        : null;
    const btcRefRet = advancedMicroMap.get('BTCUSDT')?.getLatestReturn() ?? null;
    const ethRefRet = advancedMicroMap.get('ETHUSDT')?.getLatestReturn() ?? null;
    advancedMicro.updateCrossMarket({
        timestampMs: Number(eventTimeMs || now),
        enableCrossMarketConfirmation: ENABLE_CROSS_MARKET_CONFIRMATION,
        btcReturn: btcRefRet,
        ethReturn: ethRefRet,
        spotReference: spotMetrics
            ? {
                timestampMs: spotMetrics.lastUpdated,
                midPrice: spotMetrics.midPrice,
                imbalance10: spotMetrics.imbalance10,
            }
            : null,
    });
    const advancedBundle = precomputed?.advancedBundle ?? advancedMicro.getMetrics(now);
    const dryRunPosition = dryRunSession.getStrategyPosition(s);
    const liveExecutionPosition = orchestrator.getSymbolPosition(s);
    const rawStrategyPosition = dryRunPosition || liveExecutionPosition;
    const rawPositionSource: 'dryrun' | 'live' | null = liveExecutionPosition
        ? 'live'
        : (dryRunPosition ? 'dryrun' : null);
    const spreadRatio = spreadPct == null ? null : (spreadPct / 100);
    const integrityLevelNumeric = integrity.level === 'CRITICAL'
        ? 2
        : integrity.level === 'DEGRADED'
            ? 1
            : 0;
    const selectedAtr3m = Number(advancedBundle.regimeMetrics?.microATR || 0) > 0
        ? Number(advancedBundle.regimeMetrics?.microATR || 0)
        : Number(bf.atr || 0);
    const selectedAtrSource = Number(advancedBundle.regimeMetrics?.microATR || 0) > 0
        ? 'MICRO_ATR'
        : Number(bf.atr || 0) > 0
            ? 'BACKFILL_ATR'
            : 'UNKNOWN';
    const cvdTf5mState = Number(tf5m?.delta || 0) > 0
        ? 'BUY'
        : Number(tf5m?.delta || 0) < 0
            ? 'SELL'
            : 'NEUTRAL';
    const crossMarketRuntimeActive = ENABLE_CROSS_MARKET_CONFIRMATION && activeSymbols.has('BTCUSDT');
    let btcContext: any = null;
        if (s !== 'BTCUSDT' && crossMarketRuntimeActive) {
            try {
                const btcHtf = getHtfMonitor('BTCUSDT').getSnapshot();
                const btcAdvanced = advancedMicroMap.get('BTCUSDT')?.getMetrics(now);
                if (btcHtf && btcAdvanced?.regimeMetrics) {
                    btcContext = {
                        h1BarStartMs: Number.isFinite(btcHtf.h1?.barStartMs) ? Number(btcHtf.h1?.barStartMs) : null,
                        h4BarStartMs: Number.isFinite(btcHtf.h4?.barStartMs) ? Number(btcHtf.h4?.barStartMs) : null,
                        h1StructureUp: Boolean(btcHtf.h1?.structureBreakUp),
                        h1StructureDn: Boolean(btcHtf.h1?.structureBreakDn),
                        h4StructureUp: Boolean(btcHtf.h4?.structureBreakUp),
                        h4StructureDn: Boolean(btcHtf.h4?.structureBreakDn),
                        trendiness: Number(btcAdvanced.regimeMetrics.trendinessScore || 0),
                        chop: Number(btcAdvanced.regimeMetrics.chopScore || 0),
                    };
                }
            } catch (err) {
                // Ignore btc context derivation error
            }
        }

        // ── P0: Build dryRunPosition snapshot for this symbol ──
        const buildDrpSnapshot = (sym: string) => {
            const pos = dryRunSession.getStrategyPosition(sym);
            if (!pos || !pos.side || !(Number(pos.qty) > 0)) {
                return { hasPosition: false, side: null, qty: 0, entryPrice: 0, notional: 0, addsUsed: 0 };
            }
            const refPrice = Number(pos.entryPrice) || 0;
            return {
                hasPosition: true,
                side: pos.side as 'LONG' | 'SHORT',
                qty: Number(pos.qty),
                entryPrice: refPrice,
                notional: Number(pos.qty) * refPrice,
                addsUsed: Number(pos.addsUsed || 0),
            };
        };

        const dryRunPositionSnapshot = dryRunSession.isTrackingSymbol(s) ? buildDrpSnapshot(s) : null;
        const btcDryRunPosition = (s !== 'BTCUSDT' && crossMarketRuntimeActive && dryRunSession.isTrackingSymbol('BTCUSDT'))
            ? buildDrpSnapshot('BTCUSDT')
            : null;

    const canonicalTimeMs = Number(eventTimeMs || now);
    const deltaZForDecision = Number(legacyForUse?.deltaZ ?? tf1m?.delta ?? 0);
    const cvdSlopeForDecision = Number(legacyForUse?.cvdSlope ?? tf5m?.delta ?? 0);
    const chopScoreForDecision = Number(advancedBundle.regimeMetrics?.chopScore || 0);
    const spoofAwareObi = RESILIENCE_PATCHES_ENABLED
        ? resiliencePatches.getOBI(s, ob.bids, ob.asks, 20, canonicalTimeMs)
        : null;
    const obiDeepForDecision = Number(
        spoofAwareObi?.spoofAdjusted
            ? spoofAwareObi.obi
            : (legacyForUse?.obiDeep || 0)
    );
    const obiWeightedForDecision = Number(
        spoofAwareObi?.spoofAdjusted
            ? spoofAwareObi.obiWeighted
            : (legacyForUse?.obiWeighted || 0)
    );
    let resolvedOrchestratorDecision = defaultOrchestratorDecision(s, canonicalTimeMs);
    try {
        resolvedOrchestratorDecision = orchestratorV1.evaluate({
            symbol: s,
            nowMs: canonicalTimeMs,
            price: Number(mid || legacyForUse?.price || 0),
            bestBid: bestBidPx,
            bestAsk: bestAskPx,
            spreadPct: spreadRatio,
            printsPerSecond: Number(tasMetrics?.printsPerSecond || 0),
            deltaZ: deltaZForDecision,
            cvdSlope: cvdSlopeForDecision,
            cvdTf5mState,
            obiDeep: obiDeepForDecision,
            obiWeighted: obiWeightedForDecision,
            trendinessScore: Number(advancedBundle.regimeMetrics?.trendinessScore || 0),
            chopScore: chopScoreForDecision,
            volOfVol: Number(advancedBundle.regimeMetrics?.volOfVol || 0),
            realizedVol1m: Number(advancedBundle.regimeMetrics?.realizedVol1m || 0),
            atr3m: selectedAtr3m,
            atrSource: selectedAtrSource as 'MICRO_ATR' | 'BACKFILL_ATR' | 'UNKNOWN',
            orderbookIntegrityLevel: integrityLevelNumeric,
            oiChangePct: Number.isFinite(Number(resolvedOpenInterest.oiChangePct)) ? Number(resolvedOpenInterest.oiChangePct) : null,
            sessionVwapValue: Number.isFinite(Number(sessionVwap?.value)) ? Number(sessionVwap?.value) : null,
            htfH1BarStartMs: Number.isFinite(Number(htfSnapshot?.h1?.barStartMs)) ? Number(htfSnapshot?.h1?.barStartMs) : null,
            htfH1SwingLow: Number.isFinite(Number(htfSnapshot?.h1?.lastSwingLow)) ? Number(htfSnapshot?.h1?.lastSwingLow) : null,
            htfH1SwingHigh: Number.isFinite(Number(htfSnapshot?.h1?.lastSwingHigh)) ? Number(htfSnapshot?.h1?.lastSwingHigh) : null,
            htfH1StructureBreakUp: Boolean(htfSnapshot?.h1?.structureBreakUp),
            htfH1StructureBreakDn: Boolean(htfSnapshot?.h1?.structureBreakDn),
            htfH4BarStartMs: Number.isFinite(Number(htfSnapshot?.h4?.barStartMs)) ? Number(htfSnapshot?.h4?.barStartMs) : null,
            m15SwingLow: Number.isFinite(Number(htfSnapshot?.m15?.lastSwingLow)) ? Number(htfSnapshot?.m15?.lastSwingLow) : null,
            m15SwingHigh: Number.isFinite(Number(htfSnapshot?.m15?.lastSwingHigh)) ? Number(htfSnapshot?.m15?.lastSwingHigh) : null,
            superScalpEnabled: SUPER_SCALP_ENABLED,
            backfillDone: bootstrapSnapshot.backfillDone,
            barsLoaded1m: bootstrapSnapshot.barsLoaded1m,
            btcContext,
            crossMarketActive: crossMarketRuntimeActive,
            dryRunPosition: dryRunPositionSnapshot,
            btcDryRunPosition,
        });
    } catch (e: any) {
        const nowMs = now;
        const lastErrTs = orchestratorEvalErrorTs.get(s) || 0;
        if (nowMs - lastErrTs > 5000) {
            log('ORCHESTRATOR_V1_EVAL_ERROR', {
                symbol: s,
                error: e?.message || 'orchestrator_eval_failed',
            });
            orchestratorEvalErrorTs.set(s, nowMs);
        }
    }
    const riskSummary = syncRiskEngineRuntime(s, canonicalTimeMs, mid);
    const resolvedRiskState = RISK_ENGINE_ENABLED
        ? (riskSummary?.state ?? institutionalRiskEngine.getRiskState())
        : RiskState.TRACKING;
    let resilienceGuardResult: ReturnType<ResiliencePatches['evaluate']> | null = null;
    let resilienceStatus: ReturnType<ResiliencePatches['getStatus']> | null = null;
    if (RESILIENCE_PATCHES_ENABLED) {
        const decisionPrice = Number(mid || legacyForUse?.price || 0);
        resiliencePatches.recordDelta(s, deltaZForDecision, decisionPrice, canonicalTimeMs);
        resiliencePatches.recordChopScore(s, chopScoreForDecision, canonicalTimeMs);
        const previousSide = resilienceLastSideBySymbol.has(s)
            ? (resilienceLastSideBySymbol.get(s) ?? null)
            : null;
        const currentSide = resolvedOrchestratorDecision.side;
        if ((currentSide === 'BUY' || currentSide === 'SELL') && currentSide !== previousSide) {
            resiliencePatches.recordSideFlip(s, currentSide, decisionPrice, canonicalTimeMs);
            resilienceLastSideBySymbol.set(s, currentSide);
        } else if (currentSide == null && !resilienceLastSideBySymbol.has(s)) {
            resilienceLastSideBySymbol.set(s, null);
        }
        resilienceGuardResult = resiliencePatches.evaluate(s, canonicalTimeMs);
        resilienceStatus = resiliencePatches.getStatus(canonicalTimeMs);
    }
    let strategySignals: ReturnType<StrategyRegistry['evaluateAll']> = [];
    let consensusDecision: ReturnType<ConsensusEngine['evaluate']> | null = null;

    if (strategyFrameworkEnabled) {
        try {
            const deltaZForStrategy = deltaZForDecision;
            const cvdSlopeForStrategy = cvdSlopeForDecision;
            const trendinessScore = Math.max(0, Math.min(1, Number(advancedBundle.regimeMetrics?.trendinessScore || 0)));
            const trendDirection = cvdSlopeForStrategy > 0
                ? 1
                : cvdSlopeForStrategy < 0
                    ? -1
                    : deltaZForStrategy > 0
                        ? 1
                        : deltaZForStrategy < 0
                            ? -1
                            : 0;
            const m3TrendScore = Math.max(-1, Math.min(1, Math.tanh(deltaZForStrategy / 3)));
            const m5TrendScore = Math.max(-1, Math.min(1, trendDirection * trendinessScore));
            const strategyContext = strategyContextBuilder.build({
                symbol: s,
                timestamp: canonicalTimeMs,
                price: Number(mid || legacyForUse?.price || 0),
                m3TrendScore,
                m5TrendScore,
                obiDeep: obiDeepForDecision,
                deltaZ: deltaZForStrategy,
                volatilityIndex: Number(advancedBundle.regimeMetrics?.realizedVol1m || advancedBundle.regimeMetrics?.volOfVol || 0),
                spreadPct,
                printsPerSecond: Number(tasMetrics?.printsPerSecond || 0),
                position: rawStrategyPosition
                    ? {
                        side: (rawStrategyPosition.side === 'LONG' || rawStrategyPosition.side === 'SHORT')
                            ? rawStrategyPosition.side
                            : null,
                        qty: Number(rawStrategyPosition.qty || 0),
                        entryPrice: Number(rawStrategyPosition.entryPrice || 0) > 0
                            ? Number(rawStrategyPosition.entryPrice || 0)
                            : null,
                        unrealizedPnl: Number(
                            (rawStrategyPosition as any).unrealizedPnl
                            ?? (rawStrategyPosition as any).unrealizedPnlPct
                            ?? 0
                        ),
                    }
                    : null,
            }, resolvedRiskState, canonicalTimeMs);

            strategySignals = strategyRegistry.evaluateAll(strategyContext);
            consensusDecision = consensusEngine.evaluate(strategySignals, resolvedRiskState, canonicalTimeMs);
            observabilityMetrics.recordDecisionConfidence(
                Math.max(0, Math.min(1, Number(consensusDecision.confidence || 0)))
            );
            strategyConsensusBySymbol.set(s, {
                timestampMs: canonicalTimeMs,
                side: consensusDecision.side,
                confidence: Number(consensusDecision.confidence || 0),
                quorumMet: Boolean(consensusDecision.quorumMet),
                riskGatePassed: Boolean(consensusDecision.riskGatePassed),
                contributingStrategies: Number(consensusDecision.contributingStrategies || 0),
                totalStrategies: Number(consensusDecision.totalStrategies || 0),
            });

            const hardStop = resolvedRiskState === RiskState.HALTED || resolvedRiskState === RiskState.KILL_SWITCH;
            if (hardStop) {
                if (resolvedOrchestratorDecision.intent !== 'HOLD' || resolvedOrchestratorDecision.orders.length > 0) {
                    log('STRATEGY_CONSENSUS_HARD_STOP', {
                        symbol: s,
                        riskState: resolvedRiskState,
                        previousIntent: resolvedOrchestratorDecision.intent,
                        previousSide: resolvedOrchestratorDecision.side,
                    });
                }
                resolvedOrchestratorDecision = {
                    ...resolvedOrchestratorDecision,
                    intent: 'HOLD',
                    side: null,
                    allGatesPassed: false,
                    orders: [],
                    readiness: {
                        ready: false,
                        reasons: [`RISK_${resolvedRiskState}_NO_TRADE`],
                    },
                };
            } else {
                const preTradeIntent = resolvedOrchestratorDecision.intent === 'ENTRY'
                    || resolvedOrchestratorDecision.intent === 'ADD';
                if (preTradeIntent) {
                    const consensusAllowsTrade = consensusEngine.shouldTrade(consensusDecision);
                    const consensusSide = consensusDecision.side === StrategySignalSide.LONG
                        ? 'BUY'
                        : consensusDecision.side === StrategySignalSide.SHORT
                            ? 'SELL'
                            : null;
                    if (!consensusAllowsTrade) {
                        log('STRATEGY_CONSENSUS_REJECTED', {
                            symbol: s,
                            reason: 'consensus_not_ready',
                            intent: resolvedOrchestratorDecision.intent,
                            orchestratorSide: resolvedOrchestratorDecision.side,
                            consensusSide: consensusDecision.side,
                            confidence: consensusDecision.confidence,
                            quorumMet: consensusDecision.quorumMet,
                            riskGatePassed: consensusDecision.riskGatePassed,
                        });
                        resolvedOrchestratorDecision = {
                            ...resolvedOrchestratorDecision,
                            intent: 'HOLD',
                            side: null,
                            allGatesPassed: false,
                            orders: [],
                            readiness: {
                                ready: false,
                                reasons: ['CONSENSUS_NOT_READY'],
                            },
                        };
                    } else if (!consensusSide || resolvedOrchestratorDecision.side !== consensusSide) {
                        log('STRATEGY_CONSENSUS_REJECTED', {
                            symbol: s,
                            reason: 'side_mismatch',
                            intent: resolvedOrchestratorDecision.intent,
                            orchestratorSide: resolvedOrchestratorDecision.side,
                            consensusSide: consensusDecision.side,
                            confidence: consensusDecision.confidence,
                        });
                        resolvedOrchestratorDecision = {
                            ...resolvedOrchestratorDecision,
                            intent: 'HOLD',
                            side: null,
                            allGatesPassed: false,
                            orders: [],
                            readiness: {
                                ready: false,
                                reasons: ['CONSENSUS_SIDE_MISMATCH'],
                            },
                        };
                    }
                }
            }
        } catch (error) {
            log('STRATEGY_CONSENSUS_EVAL_ERROR', {
                symbol: s,
                error: (error as Error)?.message || 'strategy_consensus_eval_failed',
            });
        }
    } else {
        strategyConsensusBySymbol.delete(s);
    }

    if (RESILIENCE_PATCHES_ENABLED && resilienceGuardResult) {
        if (resilienceGuardResult.action === 'KILL_SWITCH' && RISK_ENGINE_ENABLED && institutionalRiskEngine.getRiskState() !== RiskState.KILL_SWITCH) {
            institutionalRiskEngine.activateKillSwitch(`ResiliencePatches blocked ${s}: ${resilienceGuardResult.reasons.join(',')}`);
        } else if (resilienceGuardResult.action === 'HALT' && RISK_ENGINE_ENABLED) {
            institutionalRiskEngine.getStateManager().transition(
                RiskStateTrigger.EXECUTION_TIMEOUT,
                `ResiliencePatches halt on ${s}: ${resilienceGuardResult.reasons.join(',')}`,
                { symbol: s, timestampMs: canonicalTimeMs }
            );
        }

        const preTradeIntent = resolvedOrchestratorDecision.intent === 'ENTRY'
            || resolvedOrchestratorDecision.intent === 'ADD';
        const suppressesPreTrade = preTradeIntent
            && (
                !resilienceGuardResult.allow
                || resilienceGuardResult.action === 'NO_TRADE'
                || resilienceGuardResult.action === 'HALT'
                || resilienceGuardResult.action === 'KILL_SWITCH'
                || (
                    resilienceGuardResult.action === 'SUPPRESS'
                    && resilienceGuardResult.confidenceMultiplier < RESILIENCE_SUPPRESS_MIN_MULTIPLIER
                )
            );

        if (suppressesPreTrade) {
            log('RESILIENCE_GUARD_BLOCKED', {
                symbol: s,
                action: resilienceGuardResult.action,
                confidenceMultiplier: resilienceGuardResult.confidenceMultiplier,
                reasons: resilienceGuardResult.reasons,
                previousIntent: resolvedOrchestratorDecision.intent,
                previousSide: resolvedOrchestratorDecision.side,
            });
            resolvedOrchestratorDecision = {
                ...resolvedOrchestratorDecision,
                intent: 'HOLD',
                side: null,
                allGatesPassed: false,
                orders: [],
                readiness: {
                    ready: false,
                    reasons: [
                        'RESILIENCE_SUPPRESS',
                        ...resilienceGuardResult.reasons,
                    ],
                },
            };
        }
    }

    const orchestratorDebug = updateOrchestratorDiagnostics(s, resolvedOrchestratorDecision, canonicalTimeMs);
    const decisionView = buildDecisionViewFromOrchestrator(resolvedOrchestratorDecision);
    const strategyPosition = decisionView.suppressDryRunPosition && rawPositionSource === 'dryrun'
        ? null
        : rawStrategyPosition;
    const hasOpenStrategyPosition = Boolean(
        strategyPosition
        && (strategyPosition.side === 'LONG' || strategyPosition.side === 'SHORT')
        && Number(strategyPosition.qty || 0) > 0
    );

    const payload: any = {
        type: 'metrics',
        symbol: s,
        state: ob.uiState,
        event_time_ms: eventTimeMs,
        riskEngine: riskSummary,
        snapshot: meta.snapshotTracker.next({ s, mid }),
        timeAndSales: tasMetrics,
        cvd: {
            tf1m: tf1m ? { ...tf1m, state: classifyCVDState(tf1m.delta) } : { cvd: 0, delta: 0, state: 'Normal' },
            tf5m: tf5m ? { ...tf5m, state: classifyCVDState(tf5m.delta) } : { cvd: 0, delta: 0, state: 'Normal' },
            tf15m: tf15m ? { ...tf15m, state: classifyCVDState(tf15m.delta) } : { cvd: 0, delta: 0, state: 'Normal' },
            tradeCounts: cvd.getTradeCounts()
        },
        absorption: absVal,
        openInterest: resolvedOpenInterest,
        funding: lastFunding.get(s) || null,
        strategyPosition: hasOpenStrategyPosition
            ? {
                side: strategyPosition!.side,
                qty: Number(strategyPosition!.qty || 0),
                entryPrice: Number(strategyPosition!.entryPrice || 0),
                unrealizedPnlPct: Number(strategyPosition!.unrealizedPnlPct || 0),
                addsUsed: Number(strategyPosition!.addsUsed || 0),
                timeInPositionMs: Number((strategyPosition as any).timeInPositionMs || 0),
            }
            : null,
        legacyMetrics: legacyForUse,
        sessionVwap,
        htf: {
            m15: htfSnapshot.m15,
            h1: htfSnapshot.h1,
            h4: htfSnapshot.h4,
        },
        bootstrap: bootstrapSnapshot,
        orderbookIntegrity: integrity,
        signalDisplay: decisionView.signalDisplay,
        orchestratorV1: {
            intent: resolvedOrchestratorDecision.intent,
            side: resolvedOrchestratorDecision.side,
            readiness: resolvedOrchestratorDecision.readiness,
            gateA: resolvedOrchestratorDecision.gateA,
            gateB: resolvedOrchestratorDecision.gateB,
            gateC: resolvedOrchestratorDecision.gateC,
            allGatesPassed: resolvedOrchestratorDecision.allGatesPassed,
            impulse: resolvedOrchestratorDecision.impulse,
            add: resolvedOrchestratorDecision.add,
            exitRisk: resolvedOrchestratorDecision.exitRisk,
            position: resolvedOrchestratorDecision.position,
            orders: resolvedOrchestratorDecision.orders,
            chase: resolvedOrchestratorDecision.chase,
            chaseDebug: resolvedOrchestratorDecision.chaseDebug,
            telemetry: resolvedOrchestratorDecision.telemetry,
            debug: orchestratorDebug,
        },
        strategyConsensus: strategyFrameworkEnabled
            ? {
                timestampMs: consensusDecision?.timestamp ?? canonicalTimeMs,
                side: consensusDecision?.side ?? StrategySignalSide.FLAT,
                confidence: Number(consensusDecision?.confidence || 0),
                quorumMet: Boolean(consensusDecision?.quorumMet),
                riskGatePassed: Boolean(consensusDecision?.riskGatePassed),
                contributingStrategies: Number(consensusDecision?.contributingStrategies || 0),
                totalStrategies: Number(consensusDecision?.totalStrategies || strategyRegistry.size()),
                vetoApplied: Boolean(consensusDecision?.vetoApplied),
                shouldTrade: consensusDecision ? consensusEngine.shouldTrade(consensusDecision) : false,
                signals: strategySignals.map((signal) => ({
                    strategyId: signal.strategyId,
                    strategyName: signal.strategyName,
                    side: signal.side,
                    confidence: signal.confidence,
                    timestamp: signal.timestamp,
                    validityDurationMs: signal.validityDurationMs,
                })),
            }
            : null,
        resilience: RESILIENCE_PATCHES_ENABLED
            ? {
                action: resilienceGuardResult?.action ?? 'ALLOW',
                allow: resilienceGuardResult?.allow ?? true,
                confidenceMultiplier: Number(resilienceGuardResult?.confidenceMultiplier ?? 1),
                reasons: resilienceGuardResult?.reasons ?? [],
                status: resilienceStatus,
                spoofAwareObi: spoofAwareObi
                    ? {
                        obi: spoofAwareObi.obi,
                        obiWeighted: spoofAwareObi.obiWeighted,
                        spoofAdjusted: spoofAwareObi.spoofAdjusted,
                    }
                    : null,
            }
            : null,
        advancedMetrics: {
            sweepFadeScore: decision?.dfsPercentile || 0,
            breakoutScore: decision?.dfsPercentile || 0,
            volatilityIndex: bf.atr
        },
        liquidityMetrics: advancedBundle.liquidityMetrics,
        passiveFlowMetrics: advancedBundle.passiveFlowMetrics,
        derivativesMetrics: advancedBundle.derivativesMetrics,
        toxicityMetrics: advancedBundle.toxicityMetrics,
        regimeMetrics: advancedBundle.regimeMetrics,
        crossMarketMetrics: advancedBundle.crossMarketMetrics,
        enableCrossMarketConfirmation: advancedBundle.enableCrossMarketConfirmation,
        bids, asks,
        bestBid: bestBidPx,
        bestAsk: bestAskPx,
        spreadPct,
        midPrice: mid,
        lastUpdateId: ob.lastUpdateId
    };

    const str = JSON.stringify(payload);
    const sentCount = wsManager.broadcastToSymbol(s, str);

    // Update counters
    meta.lastBroadcastTs = now;
    meta.metricsBroadcastCount10s++;
    meta.lastMetricsBroadcastReason = reason;
    if (reason === 'depth') {
        meta.metricsBroadcastDepthCount10s++;
    } else {
        meta.metricsBroadcastTradeCount10s++;
    }

    // Log broadcast event (every 20th to avoid spam)
    if (meta.metricsBroadcastCount10s % 20 === 1) {
        log(reason === 'depth' ? 'METRICS_BROADCAST_DEPTH' : 'METRICS_BROADCAST_TRADE', {
            symbol: s,
            reason,
            throttled: false,
            intervalMs,
            sentTo: sentCount,
            obiWeighted: legacyForUse?.obiWeighted ?? null,
            obiDeep: legacyForUse?.obiDeep ?? null,
            obiDivergence: legacyForUse?.obiDivergence ?? null,
            integrityLevel: integrity.level
        });

        // Debug: METRICS_SYMBOL_BIND for integrity check
        log('METRICS_SYMBOL_BIND', {
            symbol: s,
            bestBid: bestBid(ob),
            bestAsk: bestAsk(ob),
            obiWeighted: legacyForUse?.obiWeighted ?? null,
            obiDeep: legacyForUse?.obiDeep ?? null,
            bookLevels: { bids: ob.bids.size, asks: ob.asks.size }
        });
    }

    if (eventTimeMs > 0) {
        applyOrchestratorOrders(s, resolvedOrchestratorDecision);
    }
}


// =============================================================================
// Server
// =============================================================================

const app = express();
app.set('etag', false);
app.use(express.json());
app.use(requestLogger);

// CORS configuration - more permissive for development, restrictive for production
const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) {
            callback(null, true);
            return;
        }
        // Check against allowed origins
        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
            return;
        }
        // In development, allow any origin
        if (process.env.NODE_ENV !== 'production') {
            callback(null, true);
            return;
        }
        // Reject in production if not in list
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Viewer-Token'],
};
app.use(cors(corsOptions));
app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});
app.use('/api', apiKeyMiddleware);
app.get(
    ['/health-report.json', '/health_check_result.json', '/server/health-report.json'],
    (_req, res) => {
        res.status(404).json({
            ok: false,
            error: 'not_found',
        });
    }
);

app.get('/health', (_req, res) => {
    const result = healthController.getHealth();
    res.status(result.status).json(result.body);
});
app.get('/ready', (_req, res) => {
    const result = healthController.getReady();
    res.status(result.status).json(result.body);
});
app.get('/metrics', (req, res) => {
    syncObservabilityMetrics(Date.now());
    const acceptHeader = String(req.headers.accept || 'text/plain');
    const result = observabilityMetrics.handleMetricsEndpoint(acceptHeader);
    res.status(result.statusCode);
    for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
    }
    res.send(result.body);
});
app.get('/health/liveness', healthController.liveness);
app.get('/health/readiness', healthController.readiness);
app.get('/health/metrics', healthController.metrics);

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        executionEnabled: EXECUTION_ENABLED,
        killSwitch: KILL_SWITCH,
        decisionMode: 'orchestrator_v1',
        decisionEnabled: true,
        riskEngineEnabled: RISK_ENGINE_ENABLED,
        riskEngine: RISK_ENGINE_ENABLED ? institutionalRiskEngine.getRiskSummary() : null,
        resilienceEnabled: RESILIENCE_PATCHES_ENABLED,
        resilience: RESILIENCE_PATCHES_ENABLED ? resiliencePatches.getStatus(Date.now()) : null,
        decisionRuntime: {
            legacyDecisionCalls: decisionRuntimeStats.legacyDecisionCalls,
            executorEntrySkipped: decisionRuntimeStats.executorEntrySkipped,
            orchestratorEvaluations: decisionRuntimeStats.orchestratorEvaluations,
            ordersAttempted: decisionRuntimeStats.ordersAttempted,
            makerOrdersPlaced: decisionRuntimeStats.makerOrdersPlaced,
            takerOrdersPlaced: decisionRuntimeStats.takerOrdersPlaced,
            entryTakerNotionalPct: decisionRuntimeStats.entryTakerNotionalPct,
            addsUsed: decisionRuntimeStats.addsUsed,
            exitRiskTriggeredCount: decisionRuntimeStats.exitRiskTriggeredCount,
            gateB_fail_cvd_count: decisionRuntimeStats.gateB_fail_cvd_count,
            gateB_fail_obi_count: decisionRuntimeStats.gateB_fail_obi_count,
            gateB_fail_deltaZ_count: decisionRuntimeStats.gateB_fail_deltaZ_count,
            gateA_fail_trendiness_count: decisionRuntimeStats.gateA_fail_trendiness_count,
            allGatesTrue_count: decisionRuntimeStats.allGatesTrue_count,
            entryCandidateCount: decisionRuntimeStats.entryCandidateCount,
            chaseStartedCount: decisionRuntimeStats.chaseStartedCount,
            chaseTimedOutCount: decisionRuntimeStats.chaseTimedOutCount,
            impulseTrueCount: decisionRuntimeStats.impulseTrueCount,
            fallbackEligibleCount: decisionRuntimeStats.fallbackEligibleCount,
            fallbackTriggeredCount: decisionRuntimeStats.fallbackTriggeredCount,
            fallbackBlockedReasonTop: topFallbackBlockedReason(),
            fallbackBlockedReasonCounts: decisionRuntimeStats.fallbackBlockedReasonCounts,
            makerFillsCount: decisionRuntimeStats.makerFillsCount,
            takerFillsCount: decisionRuntimeStats.takerFillsCount,
            positionSide: decisionRuntimeStats.positionSide,
            positionQty: decisionRuntimeStats.positionQty,
            entryVwap: decisionRuntimeStats.entryVwap,
            postOnlyRejectCount: decisionRuntimeStats.postOnlyRejectCount,
            cancelCount: decisionRuntimeStats.cancelCount,
            replaceCount: decisionRuntimeStats.replaceCount,
            blockReasonCountsBySymbol: Object.fromEntries(orchestratorDiagState.blockReasonCountsBySymbol.entries()),
            orchestratorRuntime: orchestratorV1.getRuntimeSnapshot(),
        },
        bootstrapRuntime: {
            limit1m: BOOTSTRAP_1M_LIMIT,
            totalFetches: backfillCoordinator.getTotalFetches(),
            symbols: backfillCoordinator.getStates(),
        },
        activeSymbols: Array.from(activeSymbols),
        wsClients: wsManager.getClientCount(),
        wsState
    });
});

app.post('/api/kill-switch', (req, res) => {
    KILL_SWITCH = Boolean(req.body?.enabled);
    if (KILL_SWITCH) {
        observabilityMetrics.recordKillSwitchTriggered();
    }
    orchestrator.setKillSwitch(KILL_SWITCH);
    if (RISK_ENGINE_ENABLED) {
        if (KILL_SWITCH) {
            institutionalRiskEngine.activateKillSwitch('manual_http_kill_switch');
        } else {
            institutionalRiskEngine.getStateManager().transition(
                RiskStateTrigger.MANUAL_RESET,
                'manual_http_kill_switch_reset'
            );
        }
    }
    log('KILL_SWITCH_TOGGLED', { enabled: KILL_SWITCH });
    res.json({ ok: true, killSwitch: KILL_SWITCH });
});

app.get('/api/status', (req, res) => {
    const now = Date.now();
    const result: any = {
        ok: true,
        uptime: Math.floor(process.uptime()),
        ws: { state: wsState, count: activeSymbols.size },
        globalBackoff: Math.max(0, globalBackoffUntil - now),
        summary: {
            desync_count_10s: 0,
            desync_count_60s: 0,
            snapshot_ok_count_60s: 0,
            snapshot_skip_count_60s: 0,
            live_uptime_pct_60s: 0,
        },
        symbols: {}
    };

    activeSymbols.forEach(s => {
        const meta = getMeta(s);
        const ob = getOrderbook(s);
        const integrity = getIntegrity(s).getStatus(now);
        const desync10s = countWindow(meta.desyncEvents, 10000, now);
        const desync60s = countWindow(meta.desyncEvents, 60000, now);
        const snapshotOk60s = countWindow(meta.snapshotOkEvents, 60000, now);
        const snapshotSkip60s = countWindow(meta.snapshotSkipEvents, 60000, now);
        const livePct60s = liveUptimePct60s(s);
        result.symbols[s] = {
            status: ob.uiState,
            lastSnapshot: meta.lastSnapshotOk ? Math.floor((now - meta.lastSnapshotOk) / 1000) + 's ago' : 'never',
            lastSnapshotOkTs: meta.lastSnapshotOk,
            snapshotLastUpdateId: meta.snapshotLastUpdateId,
            lastSnapshotHttpStatus: meta.lastSnapshotHttpStatus,
            desync_count_10s: desync10s,
            desync_count_60s: desync60s,
            snapshot_ok_count_60s: snapshotOk60s,
            snapshot_skip_count_60s: snapshotSkip60s,
            live_uptime_pct_60s: Number(livePct60s.toFixed(2)),
            last_live_ts: meta.lastLiveTs,
            last_snapshot_ok_ts: meta.lastSnapshotOk,
            depthMsgCount10s: meta.depthMsgCount10s,
            lastDepthMsgTs: meta.lastDepthMsgTs,
            bufferedDepthCount: ob.buffer.length,
            bufferedEventCount: meta.eventQueue.getQueueLength(),
            droppedEventCount: meta.eventQueue.getDroppedCount(),
            applyCount: ob.stats.applied,
            applyCount10s: meta.applyCount10s,
            dropCount: ob.stats.dropped,
            desyncCount: meta.desyncCount,
            lastSeenU_u: ob.lastSeenU_u,
            bookLevels: {
                bids: ob.bids.size,
                asks: ob.asks.size,
                bestBid: bestBid(ob),
                bestAsk: bestAsk(ob)
            },
            orderbookIntegrity: integrity,
            // Broadcast tracking
            metricsBroadcastCount10s: meta.metricsBroadcastCount10s,
            metricsBroadcastDepthCount10s: meta.metricsBroadcastDepthCount10s,
            metricsBroadcastTradeCount10s: meta.metricsBroadcastTradeCount10s,
            lastMetricsBroadcastTs: meta.lastBroadcastTs,
            lastMetricsBroadcastReason: meta.lastMetricsBroadcastReason,
            backoff: meta.backoffMs,
            trades: meta.tradeMsgCount,
            lastResyncTrigger: meta.lastResyncTrigger,
        };
        result.summary.desync_count_10s += desync10s;
        result.summary.desync_count_60s += desync60s;
        result.summary.snapshot_ok_count_60s += snapshotOk60s;
        result.summary.snapshot_skip_count_60s += snapshotSkip60s;
        result.summary.live_uptime_pct_60s += livePct60s;
    });
    if (activeSymbols.size > 0) {
        result.summary.live_uptime_pct_60s = Number((result.summary.live_uptime_pct_60s / activeSymbols.size).toFixed(2));
    }
    res.json(result);
});

app.get('/api/status', (req, res) => {
    res.redirect(307, '/api/health');
});

app.get('/api/exchange-info', async (req, res) => {
    // Disable caching to prevent 304 responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const fallbackSymbols = buildSymbolFallbackList();
    const info = await fetchExchangeInfo();
    const symbols = Array.isArray(info?.symbols) && info.symbols.length > 0 ? info.symbols : fallbackSymbols;
    res.json({ symbols });
});

app.get('/api/testnet/exchange-info', async (req, res) => {
    try {
        const symbols = await orchestrator.listTestnetFuturesPairs();
        if (Array.isArray(symbols) && symbols.length > 0) {
            res.json({ symbols });
            return;
        }
        const mainnet = await fetchExchangeInfo();
        res.json({ symbols: Array.isArray(mainnet?.symbols) ? mainnet.symbols : [], fallback: 'mainnet' });
    } catch (e: any) {
        const mainnet = await fetchExchangeInfo();
        res.json({ symbols: Array.isArray(mainnet?.symbols) ? mainnet.symbols : [], fallback: 'mainnet' });
    }
});

app.get('/api/execution/status', (req, res) => {
    res.json(orchestrator.getExecutionStatus());
});

app.post('/api/execution/connect', async (req, res) => {
    try {
        const apiKey = String(req.body?.apiKey || '');
        const apiSecret = String(req.body?.apiSecret || '');
        if (!apiKey || !apiSecret) {
            res.status(400).json({ error: 'apiKey and apiSecret are required' });
            return;
        }
        await orchestrator.connectExecution(apiKey, apiSecret);
        res.json({ ok: true, status: orchestrator.getExecutionStatus() });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message || 'execution_connect_failed' });
    }
});

app.post('/api/execution/disconnect', async (req, res) => {
    try {
        await orchestrator.disconnectExecution();
        res.json({ ok: true, status: orchestrator.getExecutionStatus() });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message || 'execution_disconnect_failed' });
    }
});

app.post('/api/execution/enabled', async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    EXECUTION_ENABLED = enabled;
    await orchestrator.setExecutionEnabled(EXECUTION_ENABLED);
    res.json({ ok: true, status: orchestrator.getExecutionStatus(), executionEnabled: EXECUTION_ENABLED });
});

app.post('/api/execution/symbol', async (req, res) => {
    try {
        const symbol = String(req.body?.symbol || '').toUpperCase();
        let symbols = Array.isArray(req.body?.symbols) ? req.body.symbols.map((s: any) => String(s).toUpperCase()) : null;

        if (!symbols && symbol) {
            symbols = [symbol];
        }

        if (!symbols || symbols.length === 0) {
            res.status(400).json({ error: 'symbol or symbols required' });
            return;
        }

        await orchestrator.setExecutionSymbols(symbols);
        res.json({ ok: true, status: orchestrator.getExecutionStatus() });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message || 'execution_symbol_set_failed' });
    }
});

app.post('/api/execution/settings', async (req, res) => {
    const rawPairMargins = (req.body && typeof req.body.pairInitialMargins === 'object' && req.body.pairInitialMargins !== null)
        ? req.body.pairInitialMargins
        : {};
    const pairInitialMargins: Record<string, number> = {};
    Object.entries(rawPairMargins).forEach(([symbol, raw]) => {
        const margin = Number(raw);
        if (Number.isFinite(margin) && margin > 0) {
            pairInitialMargins[String(symbol).toUpperCase()] = margin;
        }
    });

    const settings = await orchestrator.updateCapitalSettings({
        leverage: Number(req.body?.leverage),
        pairInitialMargins,
    });
    res.json({ ok: true, settings, status: orchestrator.getExecutionStatus() });
});

app.post('/api/execution/refresh', async (req, res) => {
    try {
        const status = await orchestrator.refreshExecutionState();
        res.json({ ok: true, status });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message || 'execution_refresh_failed' });
    }
});

app.get('/api/dry-run/symbols', async (req, res) => {
    try {
        // Prevent 304/empty-body cache flows on symbol bootstrap requests.
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const fallbackSymbols = buildSymbolFallbackList();
        const info = await fetchExchangeInfo();
        const symbols = Array.isArray(info?.symbols) && info.symbols.length > 0 ? info.symbols : fallbackSymbols;
        res.json({ ok: true, symbols });
    } catch (e: any) {
        res.status(200).json({ ok: true, symbols: buildSymbolFallbackList(), degraded: true });
    }
});

function withRuntimeStrategyConfig(status: any): any {
    if (!status || typeof status !== 'object') return status;
    const cfg = status.config && typeof status.config === 'object' ? status.config : null;
    return {
        ...status,
        config: cfg ? { ...cfg, superScalpEnabled: SUPER_SCALP_ENABLED } : cfg,
    };
}

app.get('/api/dry-run/status', (req, res) => {
    res.json({ ok: true, status: withRuntimeStrategyConfig(dryRunSession.getStatus()) });
});

app.get('/api/dry-run/sessions', async (_req, res) => {
    try {
        const sessions = await dryRunSession.listSessions();
        res.json({ ok: true, sessions });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_sessions_failed' });
    }
});

app.post('/api/dry-run/save', async (req, res) => {
    try {
        const sessionId = req.body?.sessionId ? String(req.body.sessionId) : undefined;
        await dryRunSession.saveSession(sessionId);
        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_save_failed' });
    }
});

app.post('/api/dry-run/load', async (req, res) => {
    try {
        const sessionId = String(req.body?.sessionId || '');
        if (!sessionId) {
            res.status(400).json({ ok: false, error: 'sessionId_required' });
            return;
        }
        const status = await dryRunSession.loadSession(sessionId);
        updateDryRunHealthFlag();
        res.json({ ok: true, status: withRuntimeStrategyConfig(status) });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_load_failed' });
    }
});

app.post('/api/dry-run/start', async (req, res) => {
    try {
        if (typeof req.body?.superScalpEnabled !== 'undefined') {
            SUPER_SCALP_ENABLED = Boolean(req.body.superScalpEnabled);
        }
        const rawSymbols = Array.isArray(req.body?.symbols)
            ? req.body.symbols.map((s: any) => String(s || '').toUpperCase())
            : [];
        const fallbackSymbol = String(req.body?.symbol || '').toUpperCase();
        const symbolsRequested = rawSymbols.length > 0
            ? rawSymbols.filter((s: string, idx: number, arr: string[]) => Boolean(s) && arr.indexOf(s) === idx)
            : (fallbackSymbol ? [fallbackSymbol] : []);

        if (symbolsRequested.length === 0) {
            res.status(400).json({ ok: false, error: 'symbols_required' });
            return;
        }

        const info = await fetchExchangeInfo();
        const symbols = Array.isArray(info?.symbols) ? info.symbols : [];
        const unsupported = symbolsRequested.filter((s: string) => !symbols.includes(s));
        if (unsupported.length > 0) {
            res.status(400).json({ ok: false, error: 'symbol_not_supported', unsupported });
            return;
        }

        const fundingRates: Record<string, number> = {};
        for (const symbol of symbolsRequested) {
            fundingRates[symbol] = lastFunding.get(symbol)?.rate ?? Number(req.body?.fundingRate ?? 0);
        }

        const status = dryRunSession.start({
            symbols: symbolsRequested,
            runId: req.body?.runId ? String(req.body.runId) : undefined,
            walletBalanceStartUsdt: Number(req.body?.walletBalanceStartUsdt ?? 5000),
            initialMarginUsdt: Number(req.body?.initialMarginUsdt ?? 200),
            leverage: Number(req.body?.leverage ?? 10),
            makerFeeRate: req.body?.makerFeeRate != null ? Number(req.body.makerFeeRate) : undefined,
            takerFeeRate: req.body?.takerFeeRate != null ? Number(req.body.takerFeeRate) : undefined,
            maintenanceMarginRate: Number(req.body?.maintenanceMarginRate ?? 0.005),
            fundingRates,
            fundingIntervalMs: Number(req.body?.fundingIntervalMs ?? (8 * 60 * 60 * 1000)),
            heartbeatIntervalMs: Number(req.body?.heartbeatIntervalMs ?? 10_000),
            debugAggressiveEntry: Boolean(req.body?.debugAggressiveEntry),
        });

        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        for (const symbol of symbolsRequested) {
            dryRunForcedSymbols.add(symbol);
        }
        updateStreams();

        for (const symbol of symbolsRequested) {
            const ob = getOrderbook(symbol);
            if (ob.lastUpdateId === 0 || ob.uiState === 'INIT') {
                transitionOrderbookState(symbol, 'SNAPSHOT_PENDING', 'dry_run_start');
                fetchSnapshot(symbol, 'dry_run_start', true).catch((e) => {
                    log('DRY_RUN_SNAPSHOT_ERROR', { symbol, error: e?.message || 'dry_run_snapshot_failed' });
                });
            }
        }

        res.json({ ok: true, status: withRuntimeStrategyConfig(status) });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_start_failed' });
    }
});

app.post('/api/dry-run/stop', (req, res) => {
    try {
        const status = dryRunSession.stop();
        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        updateStreams();
        res.json({ ok: true, status: withRuntimeStrategyConfig(status) });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_stop_failed' });
    }
});

app.post('/api/dry-run/reset', (req, res) => {
    try {
        const status = dryRunSession.reset();
        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        updateStreams();
        res.json({ ok: true, status: withRuntimeStrategyConfig(status) });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_reset_failed' });
    }
});

app.post('/api/dry-run/test-order', (req, res) => {
    try {
        const symbol = String(req.body?.symbol || '').toUpperCase();
        const sideRaw = String(req.body?.side || 'BUY').toUpperCase();
        const side = sideRaw === 'SELL' ? 'SELL' : 'BUY';
        if (!symbol) {
            res.status(400).json({ ok: false, error: 'symbol_required' });
            return;
        }
        const status = dryRunSession.submitManualTestOrder(symbol, side);
        res.json({ ok: true, status });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_test_order_failed' });
    }
});

app.post('/api/dry-run/run', (req, res) => {
    try {
        const body = req.body || {};
        const runId = String(body.runId || '');
        if (!runId) {
            res.status(400).json({ ok: false, error: 'runId is required' });
            return;
        }

        if (!Array.isArray(body.events)) {
            res.status(400).json({ ok: false, error: 'events array is required' });
            return;
        }

        const events: DryRunEventInput[] = body.events;
        const config: DryRunConfig = {
            runId,
            walletBalanceStartUsdt: Number(body.walletBalanceStartUsdt ?? 5000),
            initialMarginUsdt: Number(body.initialMarginUsdt ?? 200),
            leverage: Number(body.leverage ?? 1),
            makerFeeRate: Number(body.makerFeeRate ?? DEFAULT_MAKER_FEE_RATE),
            takerFeeRate: Number(body.takerFeeRate ?? DEFAULT_TAKER_FEE_RATE),
            maintenanceMarginRate: Number(body.maintenanceMarginRate ?? 0.005),
            fundingRate: Number(body.fundingRate ?? 0),
            fundingIntervalMs: Number(body.fundingIntervalMs ?? (8 * 60 * 60 * 1000)),
            fundingBoundaryStartTsUTC: body.fundingBoundaryStartTsUTC != null
                ? Number(body.fundingBoundaryStartTsUTC)
                : undefined,
            proxy: {
                mode: 'backend-proxy',
                restBaseUrl: String(body.restBaseUrl || 'https://fapi.binance.com'),
                marketWsBaseUrl: String(body.marketWsBaseUrl || 'wss://fstream.binance.com/stream'),
            },
        };

        const engine = new DryRunEngine(config);
        const result = engine.run(events);
        res.json({ ok: true, logs: result.logs, finalState: result.finalState });
    } catch (e: any) {
        if (isUpstreamGuardError(e)) {
            log('DRY_RUN_UPSTREAM_GUARD_REJECT', { code: e.code, details: e.details || {} });
            res.status(e.statusCode).json({ ok: false, error: e.code, message: e.message, details: e.details || {} });
            return;
        }
        log('DRY_RUN_RUN_ERROR', { error: serializeError(e) });
        res.status(500).json({ ok: false, error: e.message || 'dry_run_failed' });
    }
});

app.get('/api/alpha-decay', (_req, res) => {
    res.json({ ok: true, alphaDecay: [] });
});

app.get('/api/portfolio/status', (_req, res) => {
    const status = dryRunSession.getStatus();
    const exposures: Record<string, number> = {};
    for (const [symbol, symStatus] of Object.entries(status.perSymbol)) {
        if (symStatus.position) {
            const sign = symStatus.position.side === 'LONG' ? 1 : -1;
            exposures[symbol] = sign * symStatus.position.qty * symStatus.metrics.markPrice;
        }
    }
    res.json({ ok: true, snapshot: portfolioMonitor.snapshot(exposures) });
});

app.get('/api/latency', (_req, res) => {
    res.json({ ok: true, latency: latencyTracker.snapshot() });
});

app.get('/api/risk/status', (_req, res) => {
    res.json({
        ok: true,
        enabled: RISK_ENGINE_ENABLED,
        defaultEquityUsdt: riskEngineLastKnownEquity,
        summary: RISK_ENGINE_ENABLED ? institutionalRiskEngine.getRiskSummary() : null,
    });
});

app.post('/api/abtest/start', (req, res) => {
    try {
        const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols.map((s: any) => String(s || '').toUpperCase()) : [];
        if (symbols.length === 0) {
            res.status(400).json({ ok: false, error: 'symbols_required' });
            return;
        }
        const sessionA = { name: 'A', ...(req.body?.sessionA || {}) };
        const sessionB = { name: 'B', ...(req.body?.sessionB || {}) };
        const snapshot = abTestManager.start({
            symbols,
            walletBalanceStartUsdt: Number(req.body?.walletBalanceStartUsdt ?? 5000),
            initialMarginUsdt: Number(req.body?.initialMarginUsdt ?? 200),
            leverage: Number(req.body?.leverage ?? 10),
            heartbeatIntervalMs: Number(req.body?.heartbeatIntervalMs ?? 10_000),
            runId: req.body?.runId ? String(req.body.runId) : undefined,
            sessionA,
            sessionB,
        });
        updateDryRunHealthFlag();
        res.json({ ok: true, status: snapshot });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'abtest_start_failed' });
    }
});

app.post('/api/abtest/stop', (_req, res) => {
    const snapshot = abTestManager.stop();
    updateDryRunHealthFlag();
    res.json({ ok: true, status: snapshot });
});

app.get('/api/abtest/status', (_req, res) => {
    res.json({ ok: true, status: abTestManager.getSnapshot() });
});

app.get('/api/abtest/results', (_req, res) => {
    res.json({ ok: true, results: abTestManager.getComparison() });
});

app.get('/api/backfill/status', async (_req, res) => {
    const symbols = await marketArchive.listSymbols();
    res.json({
        ok: true,
        recordingEnabled: BACKFILL_RECORDING_ENABLED,
        symbols,
        bootstrap1m: {
            limit: BOOTSTRAP_1M_LIMIT,
            totalFetches: backfillCoordinator.getTotalFetches(),
            states: backfillCoordinator.getStates(),
        },
    });
});

app.post('/api/backfill/replay', async (req, res) => {
    try {
        const symbol = String(req.body?.symbol || '').toUpperCase();
        if (!symbol) {
            res.status(400).json({ ok: false, error: 'symbol_required' });
            return;
        }
        const result = await signalReplay.replay(symbol, {
            fromMs: req.body?.fromMs ? Number(req.body.fromMs) : undefined,
            toMs: req.body?.toMs ? Number(req.body.toMs) : undefined,
            limit: req.body?.limit ? Number(req.body.limit) : undefined,
        });
        res.json({ ok: true, result });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'backfill_replay_failed' });
    }
});

app.post('/api/backtest/monte-carlo', async (req, res) => {
    try {
        const symbol = String(req.body?.symbol || '').toUpperCase();
        if (!symbol) {
            res.status(400).json({ ok: false, error: 'symbol_required' });
            return;
        }
        const events = await marketArchive.loadEvents(symbol, {
            fromMs: req.body?.fromMs ? Number(req.body.fromMs) : undefined,
            toMs: req.body?.toMs ? Number(req.body.toMs) : undefined,
            types: ['trade'],
        });
        const prices = events.map((e) => Number(e.payload?.price ?? e.payload?.p ?? 0)).filter((p) => p > 0);
        if (prices.length < 2) {
            res.status(400).json({ ok: false, error: 'insufficient_price_history' });
            return;
        }
        const returns: number[] = [];
        for (let i = 1; i < prices.length; i += 1) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        }
        const simulator = new MonteCarloSimulator({
            runs: Number(req.body?.runs ?? 100),
            seed: req.body?.seed ? Number(req.body.seed) : undefined,
        });
        const results = simulator.run(returns);
        const pValue = tTestPValue(returns);
        const confidenceInterval = bootstrapMeanCI(returns);
        const baselineTrades = generateRandomTrades(returns, returns.length);
        const baselineSharpe = (() => {
            if (baselineTrades.length < 2) return 0;
            const avg = baselineTrades.reduce((acc, v) => acc + v, 0) / baselineTrades.length;
            const variance = baselineTrades.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / baselineTrades.length;
            const std = Math.sqrt(variance);
            return std === 0 ? 0 : (avg / std) * Math.sqrt(252);
        })();
        const initialCapital = Number(req.body?.initialCapital ?? 10_000);
        const ruinThreshold = Number(req.body?.ruinThreshold ?? 0.5);
        const riskOfRuin = calculateRiskOfRuin(returns, initialCapital, ruinThreshold, Number(req.body?.ruinRuns ?? 500));

        res.json({
            ok: true,
            results,
            stats: {
                pValue,
                confidenceInterval,
                baselineSharpe,
                riskOfRuin,
            },
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'monte_carlo_failed' });
    }
});

app.post('/api/backtest/walk-forward', async (req, res) => {
    try {
        const symbol = String(req.body?.symbol || '').toUpperCase();
        if (!symbol) {
            res.status(400).json({ ok: false, error: 'symbol_required' });
            return;
        }
        const events = await marketArchive.loadEvents(symbol, {
            fromMs: req.body?.fromMs ? Number(req.body.fromMs) : undefined,
            toMs: req.body?.toMs ? Number(req.body.toMs) : undefined,
            types: ['trade'],
        });
        const prices = events.map((e) => Number(e.payload?.price ?? e.payload?.p ?? 0)).filter((p) => p > 0);
        if (prices.length < 2) {
            res.status(400).json({ ok: false, error: 'insufficient_price_history' });
            return;
        }
        const returns: number[] = [];
        for (let i = 1; i < prices.length; i += 1) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        }
        const analyzer = new WalkForwardAnalyzer({
            windowSize: Number(req.body?.windowSize ?? 100),
            stepSize: Number(req.body?.stepSize ?? 50),
            thresholdRange: {
                min: Number(req.body?.thresholdMin ?? 0.0005),
                max: Number(req.body?.thresholdMax ?? 0.01),
                step: Number(req.body?.thresholdStep ?? 0.0005),
            },
        });
        const reports = analyzer.run(returns);
        res.json({ ok: true, reports });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'walk_forward_failed' });
    }
});

app.get('/api/analytics/snapshot', (_req, res) => {
    const result = analyticsEngine.handleSnapshotRequest();
    res.status(result.status).json(result.body);
});

app.get('/api/analytics/evidence-pack', (_req, res) => {
    const result = analyticsEngine.handleEvidencePackRequest();
    res.status(result.status).json(result.body);
});

app.post('/api/analytics/edge-validation', (req, res) => {
    try {
        const signals = Array.isArray(req.body?.signals) ? req.body.signals : [];
        const prices = Array.isArray(req.body?.prices) ? req.body.prices : [];
        const trades = Array.isArray(req.body?.trades) ? req.body.trades : [];
        const lookaheadMs = Number(req.body?.lookaheadMs ?? 60 * 60 * 1000);
        const profitThreshold = Number(req.body?.profitThreshold ?? 0);

        const correlation = calculateSignalReturnCorrelation(signals, prices, lookaheadMs);
        const precisionRecall = calculatePrecisionRecall(trades, profitThreshold);

        const tradePnLs = trades.map((trade: any) => {
            const side = trade.side === 'SELL' ? -1 : 1;
            const gross = (Number(trade.exitPrice) - Number(trade.entryPrice)) * Number(trade.quantity) * side;
            return gross - Number(trade.fees || 0);
        });

        const pValue = tTestPValue(tradePnLs);
        const confidenceInterval = bootstrapMeanCI(tradePnLs);
        const baselineTrades = generateRandomTrades(tradePnLs, tradePnLs.length);

        res.json({
            ok: true,
            correlation,
            precisionRecall,
            statistics: {
                pValue,
                confidenceInterval,
                baselineMean: baselineTrades.length ? baselineTrades.reduce((a, b) => a + b, 0) / baselineTrades.length : 0,
            },
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'edge_validation_failed' });
    }
});

app.post('/api/analytics/regime-analysis', (req, res) => {
    try {
        const priceSeries = Array.isArray(req.body?.prices) ? req.body.prices : [];
        const trades = Array.isArray(req.body?.trades) ? req.body.trades : [];
        const prices: number[] = priceSeries.map((p: any) => Number(p.price ?? p));
        const timestamps: number[] = priceSeries.map((p: any, idx: number) => Number(p.timestampMs ?? p.timestamp ?? idx));

        const volRegimes = calculateVolatilityRegime(prices);
        const trendRegimes = identifyTrendChopRegime(prices);

        const buckets = new Map<string, number[]>();
        trades.forEach((trade: any) => {
            const entryTs = Number(trade.entryTimestampMs ?? trade.timestampMs ?? 0);
            const idx = timestamps.findIndex((ts) => ts >= entryTs);
            const index = idx >= 0 ? idx : timestamps.length - 1;
            const vol = volRegimes[index] || 'MEDIUM';
            const trend = trendRegimes[index] || 'CHOP';
            const key = `${vol}_${trend}`;
            const side = trade.side === 'SELL' ? -1 : 1;
            const pnl = (Number(trade.exitPrice) - Number(trade.entryPrice)) * Number(trade.quantity) * side - Number(trade.fees || 0);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key)?.push(pnl);
        });

        const regimeReports = Array.from(buckets.entries()).map(([regime, pnls]) => {
            const totalPnL = pnls.reduce((a, b) => a + b, 0);
            const winRate = pnls.length ? pnls.filter((p) => p > 0).length / pnls.length : 0;
            let peak = 0;
            let maxDd = 0;
            let running = 0;
            pnls.forEach((p) => {
                running += p;
                peak = Math.max(peak, running);
                maxDd = Math.max(maxDd, peak - running);
            });
            const avgPnL = pnls.length ? totalPnL / pnls.length : 0;
            const variance = pnls.length ? pnls.reduce((a, b) => a + Math.pow(b - avgPnL, 2), 0) / pnls.length : 0;
            const std = Math.sqrt(variance);
            const sharpeRatio = std === 0 ? 0 : (avgPnL / std) * Math.sqrt(252);
            return { regime, totalPnL, maxDrawdown: maxDd, winRate, avgPnL, sharpeRatio };
        });

        res.json({
            ok: true,
            regimes: {
                volatility: volRegimes,
                trend: trendRegimes,
            },
            regimeReports,
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'regime_analysis_failed' });
    }
});

app.post('/api/analytics/risk-profile', (req, res) => {
    try {
        const returns = Array.isArray(req.body?.returns) ? req.body.returns.map(Number) : [];
        const equityCurve = Array.isArray(req.body?.equityCurve) ? req.body.equityCurve.map(Number) : [];
        const distribution = calculateReturnDistribution(returns);
        const skewKurt = calculateSkewnessKurtosis(returns);
        const drawdowns = analyzeDrawdownClustering(equityCurve);

        res.json({ ok: true, distribution, skewKurt, drawdowns });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'risk_profile_failed' });
    }
});

app.post('/api/analytics/execution-impact', (req, res) => {
    try {
        const executions = Array.isArray(req.body?.executions) ? req.body.executions : [];
        const trades = Array.isArray(req.body?.trades) ? req.body.trades : [];
        const slippage = calculateSlippage(executions);
        const spreadPerf = analyzePerformanceBySpread(trades);
        const sizePerf = analyzePerformanceByOrderSize(trades);

        res.json({ ok: true, slippage, spreadPerformance: spreadPerf, orderSizePerformance: sizePerf });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'execution_impact_failed' });
    }
});

app.post('/api/analytics/trade-metrics', (req, res) => {
    try {
        const trades = Array.isArray(req.body?.trades) ? req.body.trades : [];
        const precisionRecall = calculatePrecisionRecall(trades, Number(req.body?.profitThreshold ?? 0));
        const feeImpact = calculateFeeImpact(trades);
        const flipFrequency = calculateFlipFrequency(trades);
        const avgGrossEdge = calculateAverageGrossEdgePerTrade(trades);
        const winners = analyzeWinnerExits(trades);
        const losers = analyzeLoserExits(trades);

        res.json({
            ok: true,
            precisionRecall,
            feeImpact,
            flipFrequency,
            avgGrossEdge,
            winners,
            losers,
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'trade_metrics_failed' });
    }
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const statusCode = Number.isFinite(err?.statusCode) ? Number(err.statusCode) : 500;
    const errorCode = typeof err?.code === 'string' ? err.code : 'internal_server_error';
    logger.error('HTTP_UNHANDLED_ERROR', {
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode,
        errorCode,
        error: serializeError(err),
    });
    if (statusCode >= 500) {
        notificationService.sendAlert('INTERNAL_ERROR', err?.message || 'Unhandled server error', {
            details: {
                method: req.method,
                path: req.originalUrl || req.url,
                errorCode,
            },
        }).catch(() => undefined);
    }

    if (res.headersSent) {
        next(err);
        return;
    }

    const message = statusCode >= 500
        ? 'Internal server error'
        : String(err?.message || 'request_failed');

    res.status(statusCode).json({
        ok: false,
        error: errorCode,
        message,
    });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function shutdown(): void {
    wsManager.shutdown();
    marketDataMonitor.stopMonitoring();
    if (RESILIENCE_PATCHES_ENABLED) {
        resiliencePatches.stop();
    }
    for (const monitor of spotReferenceMonitors.values()) {
        monitor.stop();
    }
    for (const monitor of htfMonitors.values()) {
        monitor.stop();
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    wss.close();
    server.close(() => {
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

wss.on('connection', (wc, req) => {
    const authResult = validateWebSocketApiKey(req);
    if (!authResult.ok) {
        log('WS_AUTH_REJECT', {
            reason: authResult.reason || 'unauthorized',
            remoteAddress: req.socket.remoteAddress || null,
        });
        wc.close(1008, 'Unauthorized');
        return;
    }

    const p = new URL(req.url || '', 'http://l').searchParams.get('symbols') || '';
    const syms = p.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    wsManager.registerClient(wc, syms, {
        remoteAddress: req.socket.remoteAddress || null,
    });

    syms.forEach(s => {
        // Trigger initial seed if needed
        const ob = getOrderbook(s);
        if (ob.uiState === 'INIT' || ob.lastUpdateId === 0 || ob.snapshotRequired) {
            transitionOrderbookState(s, 'SNAPSHOT_PENDING', 'client_subscribe_init');
            fetchSnapshot(s, 'client_subscribe_init', true).catch(() => { });
        }
    });
});

// Reset 10s counters
setInterval(() => {
    const now = Date.now();
    symbolMeta.forEach((meta, symbol) => {
        meta.depthMsgCount10s = 0;
        meta.metricsBroadcastCount10s = 0;
        meta.metricsBroadcastDepthCount10s = 0;
        meta.metricsBroadcastTradeCount10s = 0;
        meta.applyCount10s = 0;
        const desyncRate10s = countWindow(meta.desyncEvents, 10000, now);
        if (desyncRate10s > LIVE_DESYNC_RATE_10S_MAX) {
            requestOrderbookResync(symbol, 'desync_rate_high', { desyncRate10s });
        }
    });
}, 10000);

setInterval(() => {
    activeSymbols.forEach((symbol) => {
        evaluateLiveReadiness(symbol);
    });
}, 1000);

// [PHASE 1] Rate-limit aware staggered OI Updates
let oiTick = 0;
function scheduleNextOIPoll() {
    const symbols = Array.from(activeSymbols);
    if (symbols.length > 0) {
        const symbolToUpdate = symbols[oiTick % symbols.length];
        getOICalc(symbolToUpdate).update().catch(() => { });
        oiTick++;
    }

    // Target cycle: Each symbol updated every 30 seconds.
    const symbolCount = Math.max(1, symbols.length);
    const targetCycleSeconds = 30;
    let delay = (targetCycleSeconds * 1000) / symbolCount;
    delay = Math.max(1000, Math.min(delay, 15000)); // Clamp between 1s and 15s

    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() - 0.5);
    setTimeout(scheduleNextOIPoll, delay + jitter);
}
scheduleNextOIPoll();

server.listen(PORT, HOST, () => log('SERVER_UP', { port: PORT, host: HOST }));
orchestrator.start().catch((e) => {
    log('ORCHESTRATOR_START_ERROR', { error: e.message });
});
// trigger restart
