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
import { deriveDryRunRuntimeContext } from './runtime/DryRunRuntimeContext';
import { deriveBias15m, deriveVeto1h } from './strategy/HtfBias';
import { SymbolCapitalConfig, materializeSymbolCapitalConfigs, normalizeSymbolCapitalConfigs } from './types/capital';
import { AnalyticsEngine } from './analytics';
import {
    SignalSide as StrategySignalSide,
    type StrategySignal,
} from './strategies';
import { ResiliencePatches } from './risk/ResiliencePatches';
import { StrategyActionType, type StrategyDecision, type StrategySide } from './types/strategy';
import {
    metrics as observabilityMetrics,
    RiskState as TelemetryRiskState,
} from './telemetry';
import { initializeProductionReadiness } from './integration';
import {
    createAnalyticsRoutes,
    createResilienceRoutes,
    createRiskRoutes,
    createStrategyRoutes,
    createTelemetryRoutes,
    type GuardAction as ResilienceGuardAction,
} from './api';

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
const DEPTH_LAG_MAX_MS = Number(process.env.DEPTH_LAG_MAX_MS || 15000);
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
const ORDERBOOK_CATCHUP_GRACE_MS = Math.max(
    GRACE_PERIOD_MS,
    Number(process.env.ORDERBOOK_CATCHUP_GRACE_MS || 30000)
);
const CLIENT_HEARTBEAT_INTERVAL_MS = Number(process.env.CLIENT_HEARTBEAT_INTERVAL_MS || 15000);
const CLIENT_STALE_CONNECTION_MS = Number(process.env.CLIENT_STALE_CONNECTION_MS || 60000);
const WS_MAX_SUBSCRIPTIONS = Number(process.env.WS_MAX_SUBSCRIPTIONS || 500);
const BACKFILL_RECORDING_ENABLED = parseEnvFlag(process.env.BACKFILL_RECORDING_ENABLED);
const BACKFILL_SNAPSHOT_INTERVAL_MS = Number(process.env.BACKFILL_SNAPSHOT_INTERVAL_MS || 2000);
const BOOTSTRAP_1M_LIMIT = Math.max(50, Math.trunc(Number(process.env.BOOTSTRAP_1M_LIMIT || 1440)));
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
    autoRecovery: {
        enabled: process.env.RISK_AUTO_RECOVERY_ENABLED == null
            ? true
            : parseEnvFlag(process.env.RISK_AUTO_RECOVERY_ENABLED),
        haltedStableMs: Math.max(1000, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_HALTED_STABLE_MS, 30000)),
        reducedStableMs: Math.max(1000, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_REDUCED_STABLE_MS, 60000)),
        haltedExecutionHeadroom: Math.max(0.1, Math.min(1, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_HALTED_EXECUTION_HEADROOM, 0.9))),
        reducedExecutionHeadroom: Math.max(0.1, Math.min(1, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_REDUCED_EXECUTION_HEADROOM, 0.75))),
        haltedNotionalUtilization: Math.max(0.05, Math.min(1, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_HALTED_NOTIONAL_UTILIZATION, 0.95))),
        haltedLeverageUtilization: Math.max(0.05, Math.min(1, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_HALTED_LEVERAGE_UTILIZATION, 0.95))),
        reducedNotionalUtilization: Math.max(0.05, Math.min(1, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_REDUCED_NOTIONAL_UTILIZATION, 0.8))),
        reducedLeverageUtilization: Math.max(0.05, Math.min(1, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_REDUCED_LEVERAGE_UTILIZATION, 0.8))),
        maxHeartbeatAgeMs: Math.max(1000, parseEnvNumber(process.env.RISK_AUTO_RECOVERY_MAX_HEARTBEAT_AGE_MS, 15000)),
    },
};
const RESILIENCE_PATCHES_ENABLED = process.env.RESILIENCE_PATCHES_ENABLED == null
    ? true
    : parseEnvFlag(process.env.RESILIENCE_PATCHES_ENABLED);
const RESILIENCE_AUTO_KILL_SWITCH = process.env.RESILIENCE_AUTO_KILL_SWITCH == null
    ? false
    : parseEnvFlag(process.env.RESILIENCE_AUTO_KILL_SWITCH);
const RESILIENCE_AUTO_HALT = process.env.RESILIENCE_AUTO_HALT == null
    ? true
    : parseEnvFlag(process.env.RESILIENCE_AUTO_HALT);
const RESILIENCE_SUPPRESS_MIN_MULTIPLIER = Math.max(
    0,
    Math.min(1, parseEnvNumber(process.env.RESILIENCE_SUPPRESS_MIN_MULTIPLIER, 0.75))
);
const RESILIENCE_LATENCY_P95_THRESHOLD_MS = Math.max(
    50,
    parseEnvNumber(process.env.RESILIENCE_LATENCY_P95_THRESHOLD_MS, 1000)
);
const RESILIENCE_LATENCY_P99_THRESHOLD_MS = Math.max(
    RESILIENCE_LATENCY_P95_THRESHOLD_MS,
    parseEnvNumber(process.env.RESILIENCE_LATENCY_P99_THRESHOLD_MS, 2000)
);
const RESILIENCE_EVENT_LOOP_LAG_THRESHOLD_MS = Math.max(
    10,
    parseEnvNumber(process.env.RESILIENCE_EVENT_LOOP_LAG_THRESHOLD_MS, 200)
);
const RESILIENCE_LATENCY_CONSECUTIVE_VIOLATIONS = Math.max(
    1,
    Math.trunc(parseEnvNumber(process.env.RESILIENCE_LATENCY_CONSECUTIVE_VIOLATIONS, 5))
);
const RESILIENCE_LATENCY_KILL_SWITCH_AFTER_VIOLATIONS = Math.max(
    RESILIENCE_LATENCY_CONSECUTIVE_VIOLATIONS,
    Math.trunc(parseEnvNumber(process.env.RESILIENCE_LATENCY_KILL_SWITCH_AFTER_VIOLATIONS, 20))
);
const RESILIENCE_LATENCY_COOLDOWN_MS = Math.max(
    250,
    parseEnvNumber(process.env.RESILIENCE_LATENCY_COOLDOWN_MS, 5000)
);
const RESILIENCE_ACTION_DEDUP_MS = Math.max(
    250,
    parseEnvNumber(process.env.RESILIENCE_ACTION_DEDUP_MS, 2000)
);
const RISK_LATENCY_USE_EVENT_AGE = process.env.RISK_LATENCY_USE_EVENT_AGE == null
    ? false
    : parseEnvFlag(process.env.RISK_LATENCY_USE_EVENT_AGE);
const RISK_LATENCY_EVENT_AGE_CAP_MS = Math.max(
    250,
    parseEnvNumber(process.env.RISK_LATENCY_EVENT_AGE_CAP_MS, 5000)
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
    lastDepthBroadcastTs: number;
    lastTradeBroadcastTs: number;
    metricsBroadcastCount10s: number;
    metricsBroadcastDepthCount10s: number;
    metricsBroadcastTradeCount10s: number;
    lastMetricsBroadcastReason: 'depth' | 'trade' | 'none';
    applyCount10s: number;
    lastDepthApplyTs: number;
    streamEpoch: number;
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
const strategySignalsBySymbol = new Map<string, StrategySignal[]>();
type StrategyConsensusSnapshot = {
    timestampMs: number;
    side: 'LONG' | 'SHORT' | 'FLAT';
    confidence: number;
    quorumMet: boolean;
    riskGatePassed: boolean;
    contributingStrategies: number;
    totalStrategies: number;
    vetoApplied: boolean;
    breakdown: {
        long: { count: number; avgConfidence: number };
        short: { count: number; avgConfidence: number };
        flat: { count: number; avgConfidence: number };
    };
    strategyIds: string[];
    shouldTrade: boolean;
};
const strategyConsensusBySymbol = new Map<string, StrategyConsensusSnapshot>();
const strategyApiConsensusEngine = {
    evaluate: (_signals: StrategySignal[], _riskState: RiskState, timestamp: number): StrategyConsensusSnapshot => ({
        timestampMs: timestamp,
        side: 'FLAT',
        confidence: 0,
        quorumMet: true,
        riskGatePassed: false,
        contributingStrategies: 1,
        totalStrategies: 1,
        vetoApplied: false,
        breakdown: {
            long: { count: 0, avgConfidence: 0 },
            short: { count: 0, avgConfidence: 0 },
            flat: { count: 1, avgConfidence: 0 },
        },
        strategyIds: ['new-strategy-v11'],
        shouldTrade: false,
    }),
    getConfig: () => ({
        minQuorumSize: 1,
        minConfidenceThreshold: 0,
        maxSignalAgeMs: 15_000,
        minActionConfidence: 0.5,
        longWeight: 1,
        shortWeight: 1,
    }),
};
const resilienceGuardActions: ResilienceGuardAction[] = [];
const resilienceActionDedupMap = new Map<string, number>();
const resilienceTriggerCounters = {
    antiSpoof: 0,
    deltaBurst: 0,
    latencySpike: 0,
    flashCrash: 0,
};
const abTestManager = new ABTestManager(alertService);
const marketArchive = new MarketDataArchive();
const signalReplay = new SignalReplay(marketArchive);
const portfolioMonitor = new PortfolioMonitor();
const latencyTracker = new LatencyTracker();
const institutionalRiskEngine = new InstitutionalRiskEngine(RISK_ENGINE_CONFIG);
const resiliencePatches = new ResiliencePatches({
    enableAll: RESILIENCE_PATCHES_ENABLED,
    autoKillSwitch: RESILIENCE_AUTO_KILL_SWITCH,
    autoHalt: RESILIENCE_AUTO_HALT,
    onGuardAction: (event) => {
        trackResilience(event.reason, event.symbol || 'SYSTEM', event.action, event.timestampMs);
    },
    latency: {
        p95ThresholdMs: RESILIENCE_LATENCY_P95_THRESHOLD_MS,
        p99ThresholdMs: RESILIENCE_LATENCY_P99_THRESHOLD_MS,
        eventLoopLagThresholdMs: RESILIENCE_EVENT_LOOP_LAG_THRESHOLD_MS,
        consecutiveViolations: RESILIENCE_LATENCY_CONSECUTIVE_VIOLATIONS,
        killSwitchAfterViolations: RESILIENCE_LATENCY_KILL_SWITCH_AFTER_VIOLATIONS,
        cooldownMs: RESILIENCE_LATENCY_COOLDOWN_MS,
    },
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

function resetDryRunRuntimeState(initialEquityUsdt?: number): void {
    const normalizedEquity = Number(initialEquityUsdt);
    const nextEquity = Number.isFinite(normalizedEquity) && normalizedEquity > 0
        ? normalizedEquity
        : RISK_ENGINE_DEFAULT_EQUITY_USDT;

    analyticsEngine.reset();
    riskEngineLastKnownEquity = nextEquity;
    riskEngineLastRealizedPnlBySymbol.clear();
    riskEngineLastState = null;
    lastObservabilityPnlSyncMs = 0;
    observabilityMetrics.setPnL(0);
    observabilityMetrics.setPositionCount(0);

    resilienceLastSideBySymbol.clear();
    resilienceGuardActions.splice(0, resilienceGuardActions.length);
    resilienceActionDedupMap.clear();
    resilienceTriggerCounters.antiSpoof = 0;
    resilienceTriggerCounters.deltaBurst = 0;
    resilienceTriggerCounters.latencySpike = 0;
    resilienceTriggerCounters.flashCrash = 0;

    if (RISK_ENGINE_ENABLED) {
        institutionalRiskEngine.reset();
        institutionalRiskEngine.initialize(nextEquity);
        riskEngineLastState = institutionalRiskEngine.getRiskState();
        observabilityMetrics.setRiskState(toTelemetryRiskState(riskEngineLastState));
    } else {
        observabilityMetrics.setRiskState(TelemetryRiskState.NORMAL);
    }

    if (RESILIENCE_PATCHES_ENABLED) {
        resiliencePatches.reset();
        if (RISK_ENGINE_ENABLED) {
            resiliencePatches.initialize(institutionalRiskEngine);
        }
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

function trackResilience(reason: string, symbol: string, action: string, timestamp: number): void {
    const normalized = String(reason || '').toLowerCase();
    let guardType: ResilienceGuardAction['guardType'] = 'general';
    let counterKey: keyof typeof resilienceTriggerCounters | null = null;
    let severity: ResilienceGuardAction['severity'] = 'low';

    if (normalized.includes('spoof')) {
        guardType = 'anti_spoof';
        counterKey = 'antiSpoof';
    } else if (normalized.includes('delta_burst') || normalized.includes('burst')) {
        guardType = 'delta_burst';
        counterKey = 'deltaBurst';
    } else if (
        normalized.includes('flash_crash')
        || normalized.includes('flash')
        || normalized.includes('liquidity_vacuum')
        || normalized.includes('vacuum')
    ) {
        guardType = 'flash_crash';
        counterKey = 'flashCrash';
        severity = 'high';
    } else if (
        normalized.includes('latency')
        || normalized.includes('event_loop')
        || normalized.includes('p95')
        || normalized.includes('p99')
    ) {
        guardType = 'latency';
        counterKey = 'latencySpike';
    } else if (normalized.includes('churn')) {
        // Churn suppressions are informational and should not inflate latency/error counters.
        guardType = 'general';
        severity = normalized.includes('no_trade') ? 'medium' : 'low';
    } else {
        guardType = 'general';
    }

    if (normalized.includes('kill') || normalized.includes('halt') || normalized.includes('critical')) {
        severity = 'high';
    } else if (normalized.includes('suppress') || normalized.includes('cooldown')) {
        severity = 'medium';
    }

    const dedupeNow = Date.now();
    const eventTimestamp = Number.isFinite(Number(timestamp)) && Number(timestamp) > 0
        ? Number(timestamp)
        : dedupeNow;
    const dedupeKey = `${guardType}:${symbol}:${action}:${normalized}`;
    const lastSeen = resilienceActionDedupMap.get(dedupeKey) || 0;
    if ((dedupeNow - lastSeen) < RESILIENCE_ACTION_DEDUP_MS) {
        return;
    }
    resilienceActionDedupMap.set(dedupeKey, dedupeNow);
    if (resilienceActionDedupMap.size > 5000) {
        const cutoff = dedupeNow - (RESILIENCE_ACTION_DEDUP_MS * 4);
        for (const [key, seenAt] of resilienceActionDedupMap.entries()) {
            if (seenAt < cutoff) {
                resilienceActionDedupMap.delete(key);
            }
        }
    }

    if (counterKey) {
        resilienceTriggerCounters[counterKey] += 1;
    }
    resilienceGuardActions.push({
        guardType,
        timestamp: eventTimestamp,
        symbol,
        action,
        reason,
        severity,
    });
    if (resilienceGuardActions.length > 500) {
        resilienceGuardActions.splice(0, resilienceGuardActions.length - 500);
    }
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
    decisionMode: 'strategy_v11',
    decisionEnabled: true,
    riskEngineEnabled: RISK_ENGINE_ENABLED,
    riskEngineDefaultEquityUsdt: RISK_ENGINE_DEFAULT_EQUITY_USDT,
    riskAutoRecoveryEnabled: Boolean(RISK_ENGINE_CONFIG.autoRecovery?.enabled),
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
const STRATEGY_ENGINE_NAME = 'NewStrategyV11';

function syncRiskEngineRuntime(
    symbol: string,
    eventTimeMs: number,
    midPrice: number | null,
    receiptTimeMs?: number
): ReturnType<InstitutionalRiskEngine['getRiskSummary']> | null {
    if (!RISK_ENGINE_ENABLED) {
        return null;
    }

    const now = Date.now();
    const ts = Number.isFinite(eventTimeMs) && eventTimeMs > 0 ? eventTimeMs : now;
    const normalizedReceiptMs = Number(receiptTimeMs);
    const receiptTs = Number.isFinite(normalizedReceiptMs) && normalizedReceiptMs > 0
        ? normalizedReceiptMs
        : now;
    const processingLatencyMs = Math.max(0, now - receiptTs);
    const eventAgeMs = Math.max(0, now - ts);
    const latencyMs = (RISK_LATENCY_USE_EVENT_AGE && eventAgeMs <= RISK_LATENCY_EVENT_AGE_CAP_MS)
        ? Math.max(processingLatencyMs, eventAgeMs)
        : processingLatencyMs;

    observabilityMetrics.recordWsLatency(latencyMs);
    institutionalRiskEngine.recordHeartbeat(now);
    institutionalRiskEngine.recordLatency(latencyMs, now);
    if (RESILIENCE_PATCHES_ENABLED) {
        resiliencePatches.recordLatency(latencyMs, now, 'processing');
    }

    if (Number(midPrice || 0) > 0) {
        institutionalRiskEngine.recordPrice(symbol, Number(midPrice), now);
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

    const autoRecovery = institutionalRiskEngine.evaluateAutoRecovery(now);
    if (autoRecovery.transitioned) {
        log('RISK_ENGINE_AUTO_RECOVERY', {
            from: autoRecovery.fromState,
            to: autoRecovery.targetState,
            stableForMs: autoRecovery.stableForMs,
            requiredStableMs: autoRecovery.requiredStableMs,
        });
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
            lastDepthBroadcastTs: 0,
            lastTradeBroadcastTs: 0,
            metricsBroadcastCount10s: 0,
            metricsBroadcastDepthCount10s: 0,
            metricsBroadcastTradeCount10s: 0,
            lastMetricsBroadcastReason: 'none',
            applyCount10s: 0,
            lastDepthApplyTs: 0,
            streamEpoch: 1,
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

function resetRealtimeSymbolState(symbol: string, reason: string, advanceEpoch = true): void {
    const meta = getMeta(symbol);
    if (advanceEpoch) {
        meta.streamEpoch += 1;
    }
    meta.depthQueue = [];
    meta.eventQueue.reset();
    meta.isProcessingDepthQueue = false;
    processingSymbols.delete(symbol);
    meta.goodSequenceStreak = 0;
    log('SYMBOL_REALTIME_RESET', { symbol, reason, streamEpoch: meta.streamEpoch });
}

function isOrderbookTrusted(symbol: string, now = Date.now()): boolean {
    const meta = getMeta(symbol);
    const ob = getOrderbook(symbol);
    const integrity = getIntegrity(symbol).getStatus(now);
    const depthRecentlyApplied = meta.lastDepthApplyTs > 0 && (now - meta.lastDepthApplyTs) <= GRACE_PERIOD_MS;
    return ob.uiState === 'LIVE'
        && integrity.level === 'OK'
        && depthRecentlyApplied
        && !meta.isResyncing
        && snapshotInProgress.get(symbol) !== true;
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

function prioritizeSymbols(symbols: string[], priority: string[]): string[] {
    const normalizedPriority = Array.from(new Set(
        priority
            .map((symbol) => String(symbol || '').trim().toUpperCase())
            .filter(Boolean)
    ));
    if (normalizedPriority.length === 0) {
        return symbols;
    }

    const available = Array.from(new Set(
        symbols
            .map((symbol) => String(symbol || '').trim().toUpperCase())
            .filter(Boolean)
    ));
    const availableSet = new Set(available);
    const head = normalizedPriority.filter((symbol) => availableSet.has(symbol));
    const tail = available.filter((symbol) => !head.includes(symbol));
    return [...head, ...tail];
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

    const queueSizeBefore = meta.depthQueue.length + meta.eventQueue.getQueueLength();
    resetRealtimeSymbolState(symbol, `resync:${trigger}`);

    const ob = getOrderbook(symbol);

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
        // Clear all pending raw events and diffs to prevent stale merge.
        resetRealtimeSymbolState(symbol, `snapshot_force:${trigger}`);

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
            bidsCount: ob.bids.length,
            asksCount: ob.asks.length,
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
            if (meta.depthQueue.length > 0) {
                setImmediate(() => {
                    processDepthQueue(symbol).catch((e) => {
                        log('DEPTH_QUEUE_POST_SNAPSHOT_ERR', { symbol, error: e.message });
                    });
                });
            }
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
const dryRunPreviewSymbols = new Set<string>();
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

function getAllowedTelemetrySymbols(): Set<string> {
    const allowed = new Set<string>();
    for (const symbol of dryRunSession.getActiveSymbols()) {
        if (symbol) allowed.add(String(symbol).toUpperCase());
    }
    for (const symbol of dryRunPreviewSymbols) {
        if (symbol) allowed.add(String(symbol).toUpperCase());
    }
    const selectedSymbols = orchestrator.getExecutionStatus().selectedSymbols || [];
    for (const symbol of selectedSymbols) {
        if (symbol) allowed.add(String(symbol).toUpperCase());
    }
    return allowed;
}

function sanitizeTelemetrySymbols(symbols: string[]): string[] {
    const normalized = [...new Set(symbols.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];
    const allowed = getAllowedTelemetrySymbols();
    if (allowed.size === 0) {
        return normalized;
    }
    return normalized.filter((symbol) => allowed.has(symbol));
}

function getConfiguredTelemetryUniverse(): string[] {
    const allowed = getAllowedTelemetrySymbols();
    return Array.from(allowed).sort();
}

function updateStreams() {
    const forcedSorted = [...dryRunForcedSymbols].sort();
    const configuredUniverse = getConfiguredTelemetryUniverse();
    const requiredSorted = configuredUniverse.length > 0
        ? configuredUniverse
        : sanitizeTelemetrySymbols(wsManager.getRequiredSymbols());
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
            resetRealtimeSymbolState(symbol, 'ws_open_seed');
            meta.isResyncing = false;


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
            resetRealtimeSymbolState(symbol, 'ws_reconnect_reset');
            meta.isResyncing = false;


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
    const ob = getOrderbook(symbol);

    // During snapshot/resync we must keep buffering diffs inside the orderbook
    // bridge buffer so snapshot->diff continuity can be reconstructed.
    if (snapshotInProgress.get(symbol) === true) {
        log('DEPTH_UPDATE_DEFERRED', { symbol, U: update.U, u: update.u, reason: 'snapshot_in_progress' });
        ob.lastSeenU_u = `${update.U}-${update.u}`;
        applyDepthUpdate(ob, update);
        return;
    }

    // Same rule for explicit resync windows.
    if (meta.isResyncing) {
        log('DEPTH_UPDATE_DEFERRED', { symbol, U: update.U, u: update.u, reason: 'resync_in_progress' });
        ob.lastSeenU_u = `${update.U}-${update.u}`;
        applyDepthUpdate(ob, update);
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
            latencyTracker.record('depth_ingest_ms', Math.max(0, now - Number(update.receiptTimeMs || now)));
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
                meta.lastDepthApplyTs = now;
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
            broadcastMetrics(symbol, ob, tas, cvd, absVal, leg, update.eventTimeMs || 0, null, 'depth', undefined, update.receiptTimeMs || now);

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
    const hasBook = ob.bids.length > 0 && ob.asks.length > 0;
    const appliedDepthFresh = meta.lastDepthApplyTs > 0 && (now - meta.lastDepthApplyTs) < GRACE_PERIOD_MS;

    // Data Liveness: Check if depth messages are flowing within GRACE_PERIOD
    // If we just resynced, give it time (MIN_RESYNC_INTERVAL check handles throttle)
    const dataFlowing = (now - meta.lastDepthMsgTs) < GRACE_PERIOD_MS;

    // Consider book "live" when it is populated and either:
    // - recent depth updates are flowing, or
    // - a fresh snapshot was just applied.
    // This avoids forced resync loops every snapshot TTL when depth is healthy.
    const catchingUp = hasBook
        && meta.lastSnapshotOk > 0
        && (now - meta.lastSnapshotOk) <= ORDERBOOK_CATCHUP_GRACE_MS
        && dataFlowing
        && ob.reorderBuffer.size > 0
        && meta.lastDepthApplyTs <= meta.lastSnapshotOk;
    const isLiveCondition = hasBook && (appliedDepthFresh || snapshotFresh || catchingUp);

    if (isLiveCondition) {
        // We look good foundationally. Check data flow.
        if (ob.uiState !== 'LIVE') {
            transitionOrderbookState(symbol, 'LIVE', 'live_criteria_met', {
                fresh: snapshotFresh,
                catchingUp,
                dataFlowing,
                appliedDepthFresh,
                dataLag: now - meta.lastDepthMsgTs,
                reorderBuffered: ob.reorderBuffer.size,
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
                catchingUp,
                dataFlowing,
                appliedDepthFresh,
                dataLag: now - meta.lastDepthMsgTs,
                applyLag: meta.lastDepthApplyTs > 0 ? (now - meta.lastDepthApplyTs) : null,
                hasBook,
                reorderBuffered: ob.reorderBuffer.size,
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
    const eventEpoch = Math.trunc(Number(d?.__streamEpoch || 0));
    if (eventEpoch !== meta.streamEpoch) {
        return;
    }

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
        latencyTracker.record('trade_ingest_ms', Math.max(0, Date.now() - now));
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
            const hasDepth = ob.uiState === 'LIVE' && ob.bids.length > 0 && ob.asks.length > 0;
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
        const strategyHtfSnapshot = getHtfMonitor(s).getSnapshot();
        const strategyBootstrapState = backfillCoordinator.getState(s);
        const strategyBootstrapSnapshot = {
            backfillInProgress: Boolean(strategyBootstrapState.inProgress),
            backfillDone: Boolean(strategyBootstrapState.done),
            barsLoaded1m: Number(strategyBootstrapState.barsLoaded1m || 0),
            startedAtMs: Number.isFinite(Number(strategyBootstrapState.startedAtMs)) ? Number(strategyBootstrapState.startedAtMs) : null,
            doneAtMs: Number.isFinite(Number(strategyBootstrapState.doneAtMs)) ? Number(strategyBootstrapState.doneAtMs) : null,
        };

        const shouldEvaluateStrategy = decisionFlowEnabled
            && (!decision || (now - meta.lastStrategyEvalTs) >= STRATEGY_EVAL_MIN_INTERVAL_MS);
        if (shouldEvaluateStrategy) {
            const calcStart = Date.now();
            legMetrics = leg.computeMetrics(ob, Number(t || now));
            tasMetrics = tas.computeMetrics();
            const integrity = getIntegrity(s).getStatus(now);
            const orderbookTrusted = isOrderbookTrusted(s, now);
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
                bootstrap: {
                    backfillDone: strategyBootstrapSnapshot.backfillDone,
                    barsLoaded1m: strategyBootstrapSnapshot.barsLoaded1m,
                },
                htf: {
                    m15: strategyHtfSnapshot.m15,
                    h1: strategyHtfSnapshot.h1,
                },
                execution: {
                    tradeReady: strategyBootstrapSnapshot.backfillDone,
                    addonReady: strategyBootstrapSnapshot.backfillDone,
                    vetoReason: strategyBootstrapSnapshot.backfillDone ? null : 'BOOTSTRAP_NOT_DONE',
                    orderbookTrusted,
                    integrityLevel: integrity.level,
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
                : { advancedBundle },
            now
        );
    }
}

function classifyCVDState(delta: number): 'Normal' | 'High Vol' | 'Extreme' {
    const absD = Math.abs(delta);
    if (absD > 1000000) return 'Extreme';
    if (absD > 250000) return 'High Vol';
    return 'Normal';
}

function normalizeExecutionSide(side: StrategySide | null | undefined): 'BUY' | 'SELL' | null {
    if (side === 'LONG') return 'BUY';
    if (side === 'SHORT') return 'SELL';
    return null;
}

function deriveStrategyExecutionSide(
    decision: StrategyDecision | null,
    position: { side?: string | null } | null
): 'BUY' | 'SELL' | null {
    const actionable = Array.isArray(decision?.actions)
        ? decision!.actions.find((action) => action.type === StrategyActionType.ENTRY || action.type === StrategyActionType.ADD)
        : null;
    const actionSide = normalizeExecutionSide(actionable?.side);
    if (actionSide) return actionSide;
    if (position?.side === 'LONG') return 'BUY';
    if (position?.side === 'SHORT') return 'SELL';
    return null;
}

function buildStrategyTelemetryFromDecision(
    symbol: string,
    decision: StrategyDecision | null,
    position: { side?: string | null } | null,
    price: number | null,
    nowMs: number
): { signals: StrategySignal[]; consensus: StrategyConsensusSnapshot } {
    const executionSide = deriveStrategyExecutionSide(decision, position);
    const signalSide = executionSide === 'BUY'
        ? StrategySignalSide.LONG
        : executionSide === 'SELL'
            ? StrategySignalSide.SHORT
            : StrategySignalSide.FLAT;
    const consensusSide: StrategyConsensusSnapshot['side'] = executionSide === 'BUY'
        ? 'LONG'
        : executionSide === 'SELL'
            ? 'SHORT'
            : 'FLAT';
    const rawConfidence = Math.max(0, Math.min(1, Number(decision?.dfsPercentile || 0)));
    const gatePassed = Boolean(decision?.gatePassed);
    const confidence = gatePassed ? rawConfidence : Math.min(rawConfidence, 0.25);
    const timestampMs = Number(decision?.timestampMs || nowMs);
    const reasons = Array.isArray(decision?.reasons) ? [...decision.reasons] : [];
    const primaryAction = Array.isArray(decision?.actions) ? decision.actions[0] : null;
    const signal: StrategySignal = {
        strategyId: 'new-strategy-v11',
        strategyName: STRATEGY_ENGINE_NAME,
        side: signalSide,
        confidence,
        timestamp: timestampMs,
        validityDurationMs: 15_000,
        metadata: {
            symbol,
            price,
            gatePassed,
            regime: decision?.regime ?? null,
            reason: primaryAction?.reason ?? reasons[0] ?? null,
            actionType: primaryAction?.type ?? StrategyActionType.NOOP,
            reasons,
        },
    };
    const breakdown = {
        long: { count: signalSide === StrategySignalSide.LONG ? 1 : 0, avgConfidence: signalSide === StrategySignalSide.LONG ? confidence : 0 },
        short: { count: signalSide === StrategySignalSide.SHORT ? 1 : 0, avgConfidence: signalSide === StrategySignalSide.SHORT ? confidence : 0 },
        flat: { count: signalSide === StrategySignalSide.FLAT ? 1 : 0, avgConfidence: signalSide === StrategySignalSide.FLAT ? confidence : 0 },
    };
    return {
        signals: [signal],
        consensus: {
            timestampMs,
            side: consensusSide,
            confidence,
            quorumMet: true,
            riskGatePassed: gatePassed,
            contributingStrategies: 1,
            totalStrategies: 1,
            vetoApplied: !gatePassed && reasons.length > 0,
            breakdown,
            strategyIds: [signal.strategyId],
            shouldTrade: gatePassed && consensusSide !== 'FLAT',
        },
    };
}

function buildSignalDisplayFromStrategyDecision(decision: StrategyDecision | null) {
    const primaryAction = Array.isArray(decision?.actions) ? decision!.actions[0] : null;
    const score = Math.max(0, Math.min(100, Number(decision?.dfsPercentile || 0) * 100));
    const signal = (() => {
        if (!primaryAction?.side) return 'NONE';
        if (primaryAction.type === StrategyActionType.ENTRY) {
            if (decision?.regime === 'TR') {
                return primaryAction.side === 'LONG' ? 'TREND_LONG' : 'TREND_SHORT';
            }
            return primaryAction.side === 'LONG' ? 'ENTRY_LONG' : 'ENTRY_SHORT';
        }
        if (primaryAction.type === StrategyActionType.ADD) {
            return primaryAction.side === 'LONG' ? 'POSITION_LONG' : 'POSITION_SHORT';
        }
        return 'NONE';
    })();
    const vetoReason = decision
        ? (decision.gatePassed ? null : String(decision.reasons?.[0] || 'GATE_BLOCKED'))
        : null;

    return {
        signalDisplay: {
            signal,
            score,
            confidence: score >= 75 ? 'HIGH' as const : score >= 50 ? 'MEDIUM' as const : 'LOW' as const,
            vetoReason,
            candidate: null,
            reasons: Array.isArray(decision?.reasons) ? [...decision!.reasons] : [],
            gatePassed: Boolean(decision?.gatePassed),
            regime: decision?.regime ?? null,
            dfsPercentile: decision?.dfsPercentile ?? null,
        },
    };
}

function handleMsg(raw: any) {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg.data) return;

    const s = msg.data.s;
    if (!s) return;

    const meta = getMeta(s);
    meta.eventQueue.enqueue({
        ...msg.data,
        __streamEpoch: meta.streamEpoch,
    });
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
    precomputed?: { tasMetrics?: any; cvdMetrics?: any[]; legacyMetrics?: any; advancedBundle?: AdvancedMicrostructureBundle },
    receiptTimeMs?: number
) {
    const GLOBAL_MIN_GAP_MS = 75;
    const DEPTH_THROTTLE_MS = 350;
    const TRADE_THROTTLE_MS = 250;
    const meta = getMeta(s);
    if (leg) leg.updateOpenInterest();
    const now = Date.now();

    const intervalMs = now - meta.lastBroadcastTs;
    const sameReasonIntervalMs = reason === 'depth'
        ? now - meta.lastDepthBroadcastTs
        : now - meta.lastTradeBroadcastTs;
    const reasonThrottleMs = reason === 'depth' ? DEPTH_THROTTLE_MS : TRADE_THROTTLE_MS;
    if (intervalMs < GLOBAL_MIN_GAP_MS || sameReasonIntervalMs < reasonThrottleMs) {
        return;
    }

    const cvdM = precomputed?.cvdMetrics ?? cvd.computeMetrics(Number(eventTimeMs || now));
    const tasMetrics = precomputed?.tasMetrics ?? tas.computeMetrics();
    // Calculate OBI/Legacy if Orderbook has data (bids and asks exist)
    // This allows metrics to continue displaying during brief resyncs
    const hasBookData = ob.bids.length > 0 && ob.asks.length > 0;
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
    const spreadRatio = spreadPct == null ? null : (spreadPct / 100);
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
    if (dryRunSession.isTrackingSymbol(s)) {
        const trendPrice = Number(mid || legacyForUse?.price || 0);
        const contextVwap = Number(sessionVwap?.value || legacyForUse?.vwap || mid || 0);
        const bias15m: 'UP' | 'DOWN' | 'NEUTRAL' = deriveBias15m(htfSnapshot?.m15, trendPrice);
        const veto1h: 'NONE' | 'UP' | 'DOWN' | 'EXHAUSTION' = deriveVeto1h(htfSnapshot?.h1, trendPrice);
        const runtimeContext = deriveDryRunRuntimeContext({
            bias15m,
            trendinessScore: Number(advancedBundle.regimeMetrics?.trendinessScore || 0),
            deltaZ: deltaZForDecision,
            cvdSlope: cvdSlopeForDecision,
            obiWeighted: obiWeightedForDecision,
            trendPrice,
            sessionVwap: contextVwap,
            bookMidPrice: Number(mid || 0),
            referenceTradePrice: Number(legacyForUse?.price || 0),
        });
        dryRunSession.updateRuntimeContext(s, {
            timestampMs: canonicalTimeMs,
            bootstrapDone: bootstrapSnapshot.backfillDone,
            bootstrapBars1m: bootstrapSnapshot.barsLoaded1m,
            htfReady: Boolean(htfSnapshot?.m15?.close) && Boolean(htfSnapshot?.h1?.close),
            tradeStreamActive: Number(tasMetrics?.tradeCount || 0) > 0 || Number(tasMetrics?.printsPerSecond || 0) > 0,
            spreadPct: spreadRatio,
            bookMarkDeviationPct: runtimeContext.bookMarkDeviationPct,
            trendState: runtimeContext.trendState,
            trendConfidence: runtimeContext.trendConfidence,
            bias15m,
            veto1h,
        });
    }
    const riskSummary = syncRiskEngineRuntime(s, canonicalTimeMs, mid, receiptTimeMs);
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
        const currentSide = deriveStrategyExecutionSide(decision, rawStrategyPosition);
        if ((currentSide === 'BUY' || currentSide === 'SELL') && currentSide !== previousSide) {
            resiliencePatches.recordSideFlip(s, currentSide, decisionPrice, canonicalTimeMs);
            resilienceLastSideBySymbol.set(s, currentSide);
        } else if (currentSide == null && !resilienceLastSideBySymbol.has(s)) {
            resilienceLastSideBySymbol.set(s, null);
        }
        resilienceGuardResult = resiliencePatches.evaluate(s, canonicalTimeMs);
        resilienceStatus = resiliencePatches.getStatus(canonicalTimeMs);
    }
    let strategySignals: StrategySignal[] = [];
    let consensusDecision: StrategyConsensusSnapshot | null = null;

    try {
        const strategyTelemetry = buildStrategyTelemetryFromDecision(
            s,
            decision,
            rawStrategyPosition,
            Number(mid || legacyForUse?.price || 0),
            canonicalTimeMs
        );
        strategySignals = strategyTelemetry.signals;
        consensusDecision = strategyTelemetry.consensus;
        strategySignalsBySymbol.set(s, strategySignals.map((signal) => ({ ...signal })));
        observabilityMetrics.recordDecisionConfidence(
            Math.max(0, Math.min(1, Number(consensusDecision.confidence || 0)))
        );
        strategyConsensusBySymbol.set(s, {
            ...consensusDecision,
            strategyIds: [...consensusDecision.strategyIds],
            breakdown: {
                long: { ...consensusDecision.breakdown.long },
                short: { ...consensusDecision.breakdown.short },
                flat: { ...consensusDecision.breakdown.flat },
            },
        });
    } catch (error) {
        strategySignalsBySymbol.delete(s);
        strategyConsensusBySymbol.delete(s);
        log('STRATEGY_TELEMETRY_BUILD_ERROR', {
            symbol: s,
            error: (error as Error)?.message || 'strategy_telemetry_build_failed',
        });
    }

    if (RESILIENCE_PATCHES_ENABLED && resilienceGuardResult) {
        if (resilienceGuardResult.reasons.length > 0 || resilienceGuardResult.action !== 'ALLOW') {
            if (resilienceGuardResult.reasons.length === 0) {
                trackResilience('guard_action', s, resilienceGuardResult.action, canonicalTimeMs);
            } else {
                for (const reason of resilienceGuardResult.reasons) {
                    trackResilience(reason, s, resilienceGuardResult.action, canonicalTimeMs);
                }
            }
        }
        if (resilienceGuardResult.action === 'KILL_SWITCH' && RISK_ENGINE_ENABLED && institutionalRiskEngine.getRiskState() !== RiskState.KILL_SWITCH) {
            institutionalRiskEngine.activateKillSwitch(`ResiliencePatches blocked ${s}: ${resilienceGuardResult.reasons.join(',')}`);
        } else if (resilienceGuardResult.action === 'HALT' && RISK_ENGINE_ENABLED) {
            institutionalRiskEngine.getStateManager().transition(
                RiskStateTrigger.EXECUTION_TIMEOUT,
                `ResiliencePatches halt on ${s}: ${resilienceGuardResult.reasons.join(',')}`,
                { symbol: s, timestampMs: canonicalTimeMs }
            );
        }
    }

    const decisionView = buildSignalDisplayFromStrategyDecision(decision);
    const strategyPosition = rawStrategyPosition;
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
        server_sent_ms: now,
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
                peakPnlPct: Number((strategyPosition as any).peakPnlPct || 0),
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
        strategyConsensus: consensusDecision
            ? {
                timestampMs: consensusDecision.timestampMs,
                side: consensusDecision.side,
                confidence: Number(consensusDecision.confidence || 0),
                quorumMet: Boolean(consensusDecision.quorumMet),
                riskGatePassed: Boolean(consensusDecision.riskGatePassed),
                contributingStrategies: Number(consensusDecision.contributingStrategies || 0),
                totalStrategies: Number(consensusDecision.totalStrategies || 1),
                vetoApplied: Boolean(consensusDecision.vetoApplied),
                shouldTrade: Boolean(consensusDecision.shouldTrade),
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
    if (reason === 'depth') {
        meta.lastDepthBroadcastTs = now;
    } else {
        meta.lastTradeBroadcastTs = now;
    }
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
            bookLevels: { bids: ob.bids.length, asks: ob.asks.length }
        });
    }

}


function resolveDashboardSymbol(requested?: string): string | undefined {
    const normalized = String(requested || '').trim().toUpperCase();
    if (normalized && strategySignalsBySymbol.has(normalized)) {
        return normalized;
    }
    if (normalized && strategyConsensusBySymbol.has(normalized)) {
        return normalized;
    }
    const fromSignals = strategySignalsBySymbol.keys().next();
    if (!fromSignals.done) {
        return fromSignals.value;
    }
    const fromConsensus = strategyConsensusBySymbol.keys().next();
    if (!fromConsensus.done) {
        return fromConsensus.value;
    }
    const active = activeSymbols.values().next();
    if (!active.done) {
        return active.value;
    }
    return undefined;
}

function cloneStrategySignal(signal: StrategySignal): StrategySignal {
    return {
        ...signal,
        metadata: signal.metadata && typeof signal.metadata === 'object'
            ? { ...(signal.metadata as Record<string, unknown>) }
            : signal.metadata,
    };
}

function getAllDashboardStrategySignals(): StrategySignal[] {
    const allSignals: StrategySignal[] = [];
    for (const signals of strategySignalsBySymbol.values()) {
        for (const signal of signals) {
            allSignals.push(cloneStrategySignal(signal));
        }
    }
    return allSignals.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function getDashboardStrategySignals(symbol?: string): StrategySignal[] {
    if (!symbol) {
        return getAllDashboardStrategySignals();
    }
    const target = resolveDashboardSymbol(symbol);
    if (!target) return [];
    return (strategySignalsBySymbol.get(target) || []).map(cloneStrategySignal);
}

function getDashboardStrategyConsensus(symbol?: string) {
    if (!symbol) {
        const signals = getAllDashboardStrategySignals();
        if (signals.length === 0) {
            return null;
        }
        const buckets = {
            LONG: { count: 0, confidenceSum: 0 },
            SHORT: { count: 0, confidenceSum: 0 },
            FLAT: { count: 0, confidenceSum: 0 },
        };
        let latestTs = 0;
        const strategyIds = new Set<string>();
        for (const signal of signals) {
            const side = signal.side === StrategySignalSide.LONG
                ? 'LONG'
                : signal.side === StrategySignalSide.SHORT
                    ? 'SHORT'
                    : 'FLAT';
            buckets[side].count += 1;
            buckets[side].confidenceSum += Number(signal.confidence || 0);
            latestTs = Math.max(latestTs, Number(signal.timestamp || 0));
            if (signal.strategyId) {
                strategyIds.add(signal.strategyId);
            }
        }
        const rankedSides: Array<'LONG' | 'SHORT' | 'FLAT'> = ['LONG', 'SHORT', 'FLAT'];
        const dominantSide = rankedSides
            .sort((a: 'LONG' | 'SHORT' | 'FLAT', b: 'LONG' | 'SHORT' | 'FLAT') => {
                const diff = buckets[b].confidenceSum - buckets[a].confidenceSum;
                if (Math.abs(diff) > 1e-9) {
                    return diff > 0 ? 1 : -1;
                }
                return buckets[b].count - buckets[a].count;
            })[0];
        const dominantCount = buckets[dominantSide].count;
        const dominantConfidence = dominantCount > 0
            ? buckets[dominantSide].confidenceSum / dominantCount
            : 0;
        const dominantSignals = signals.filter((signal) => {
            if (dominantSide === 'LONG') return signal.side === StrategySignalSide.LONG;
            if (dominantSide === 'SHORT') return signal.side === StrategySignalSide.SHORT;
            return signal.side === StrategySignalSide.FLAT;
        });
        const riskGatePassed = dominantSide !== 'FLAT'
            && dominantSignals.some((signal) => (signal.metadata as Record<string, unknown> | undefined)?.gatePassed !== false);
        return {
            timestampMs: latestTs || Date.now(),
            side: dominantSide,
            confidence: Math.max(0, Math.min(1, dominantConfidence)),
            quorumMet: true,
            riskGatePassed,
            contributingStrategies: dominantCount,
            totalStrategies: Math.max(1, signals.length),
            vetoApplied: dominantSide !== 'FLAT' && !riskGatePassed,
            breakdown: {
                long: {
                    count: buckets.LONG.count,
                    avgConfidence: buckets.LONG.count > 0 ? buckets.LONG.confidenceSum / buckets.LONG.count : 0,
                },
                short: {
                    count: buckets.SHORT.count,
                    avgConfidence: buckets.SHORT.count > 0 ? buckets.SHORT.confidenceSum / buckets.SHORT.count : 0,
                },
                flat: {
                    count: buckets.FLAT.count,
                    avgConfidence: buckets.FLAT.count > 0 ? buckets.FLAT.confidenceSum / buckets.FLAT.count : 0,
                },
            },
            strategyIds: [...strategyIds],
            shouldTrade: riskGatePassed,
        };
    }
    const target = resolveDashboardSymbol(symbol);
    if (!target) return null;
    const consensus = strategyConsensusBySymbol.get(target);
    if (!consensus) return null;
    return {
        ...consensus,
        strategyIds: [...consensus.strategyIds],
        breakdown: {
            long: { ...consensus.breakdown.long },
            short: { ...consensus.breakdown.short },
            flat: { ...consensus.breakdown.flat },
        },
    };
}

function getDashboardRiskState(): RiskState {
    if (!RISK_ENGINE_ENABLED) {
        return RiskState.TRACKING;
    }
    return institutionalRiskEngine.getRiskState();
}

function buildStatusDecisionSnapshot(symbol: string) {
    const signals = strategySignalsBySymbol.get(symbol) || [];
    const latestSignal = signals.reduce<StrategySignal | null>((latest, signal) => {
        if (!latest) return signal;
        return Number(signal.timestamp || 0) >= Number(latest.timestamp || 0) ? signal : latest;
    }, null);
    const consensus = strategyConsensusBySymbol.get(symbol) || null;
    if (!latestSignal && !consensus) {
        return null;
    }
    const metadata = latestSignal?.metadata && typeof latestSignal.metadata === 'object'
        ? latestSignal.metadata as Record<string, unknown>
        : {};
    const signalSide = latestSignal?.side === StrategySignalSide.LONG
        ? 'LONG'
        : latestSignal?.side === StrategySignalSide.SHORT
            ? 'SHORT'
            : 'FLAT';
    return {
        side: consensus?.side || signalSide,
        confidence: Number(consensus?.confidence ?? latestSignal?.confidence ?? 0),
        shouldTrade: Boolean(consensus?.shouldTrade),
        gatePassed: typeof metadata.gatePassed === 'boolean'
            ? metadata.gatePassed
            : Boolean(consensus?.riskGatePassed),
        regime: typeof metadata.regime === 'string' ? metadata.regime : null,
        actionType: typeof metadata.actionType === 'string' ? metadata.actionType : null,
        reason: typeof metadata.reason === 'string' ? metadata.reason : null,
        reasons: Array.isArray(metadata.reasons) ? metadata.reasons.map((value) => String(value)) : [],
        timestampMs: Number(latestSignal?.timestamp ?? consensus?.timestampMs ?? 0),
    };
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
        decisionMode: 'strategy_v11',
        decisionEnabled: true,
        riskEngineEnabled: RISK_ENGINE_ENABLED,
        riskEngine: RISK_ENGINE_ENABLED ? institutionalRiskEngine.getRiskSummary() : null,
        resilienceEnabled: RESILIENCE_PATCHES_ENABLED,
        resilience: RESILIENCE_PATCHES_ENABLED ? resiliencePatches.getStatus(Date.now()) : null,
        decisionRuntime: {
            engine: STRATEGY_ENGINE_NAME,
            activeStrategyInstances: strategyMap.size,
            activeSymbols: Array.from(activeSymbols),
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
            orderbookTrusted: isOrderbookTrusted(s, now),
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
            reorderBufferedCount: ob.reorderBuffer.size,
            bufferedEventCount: meta.eventQueue.getQueueLength(),
            droppedEventCount: meta.eventQueue.getDroppedCount(),
            applyCount: ob.stats.applied,
            applyCount10s: meta.applyCount10s,
            dropCount: ob.stats.dropped,
            desyncCount: meta.desyncCount,
            lastSeenU_u: ob.lastSeenU_u,
            bookLevels: {
                bids: ob.bids.length,
                asks: ob.asks.length,
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

function extractSymbolCapitalConfigsFromBody(body: any, symbols: string[], totalWalletUsdt: number): SymbolCapitalConfig[] {
    const defaultInitialMarginUsdt = Number(body?.initialMarginUsdt ?? 200);
    const defaultLeverage = Number(body?.leverage ?? 10);
    const normalized = normalizeSymbolCapitalConfigs({
        symbols,
        symbolConfigs: body?.symbolConfigs,
        defaultInitialMarginUsdt,
        defaultLeverage,
        defaultReserveUsdt: Number(body?.sharedWalletStartUsdt ?? body?.walletBalanceStartUsdt ?? totalWalletUsdt ?? 0) / Math.max(1, symbols.length || 1),
    });

    if (normalized.length > 0) {
        return normalized;
    }

    const rawPairMargins = (body && typeof body.pairInitialMargins === 'object' && body.pairInitialMargins !== null)
        ? body.pairInitialMargins
        : {};
    const legacyLeverage = Math.max(1, Math.trunc(Number(body?.leverage ?? 10)));
    return symbols.map((symbol) => {
        const legacyMargin = Number(rawPairMargins[symbol] ?? body?.initialMarginUsdt ?? 0);
        const reserve = legacyMargin > 0 ? legacyMargin : Math.max(0, totalWalletUsdt / Math.max(1, symbols.length || 1));
        return {
            symbol,
            enabled: true,
            walletReserveUsdt: reserve,
            initialMarginUsdt: legacyMargin > 0 ? legacyMargin : reserve,
            leverage: legacyLeverage,
        };
    });
}

app.post('/api/execution/settings', async (req, res) => {
    const selectedSymbols = orchestrator.getExecutionStatus().selectedSymbols || [];
    const symbolConfigs = extractSymbolCapitalConfigsFromBody(
        req.body,
        selectedSymbols,
        Math.max(0, orchestrator.getExecutionStatus().wallet?.totalWalletUsdt || 0),
    );
    const settings = await orchestrator.updateCapitalSettings({
        symbolConfigs,
        leverage: Number(req.body?.leverage),
        pairInitialMargins: req.body?.pairInitialMargins,
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
        const previewPriority = Array.from(dryRunPreviewSymbols);
        const defaultPriority = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
        const symbols = prioritizeSymbols(
            Array.isArray(info?.symbols) && info.symbols.length > 0 ? info.symbols : fallbackSymbols,
            previewPriority.length > 1 ? previewPriority : defaultPriority,
        );
        res.json({ ok: true, symbols });
    } catch (e: any) {
        res.status(200).json({
            ok: true,
            symbols: prioritizeSymbols(buildSymbolFallbackList(), Array.from(dryRunPreviewSymbols).length > 1
                ? Array.from(dryRunPreviewSymbols)
                : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']),
            degraded: true,
        });
    }
});

function withRuntimeStrategyConfig(status: any): any {
    if (!status || typeof status !== 'object' || !status.perSymbol || typeof status.perSymbol !== 'object') {
        return {
            ...(status || {}),
            previewSymbols: Array.from(dryRunPreviewSymbols).sort(),
        };
    }
    const perSymbol = Object.fromEntries(
        Object.entries(status.perSymbol).map(([symbol, symbolStatus]) => {
            const nextStatus = symbolStatus && typeof symbolStatus === 'object'
                ? { ...(symbolStatus as Record<string, unknown>) }
                : symbolStatus;
            if (nextStatus && typeof nextStatus === 'object') {
                (nextStatus as Record<string, unknown>).decision = buildStatusDecisionSnapshot(symbol);
            }
            return [symbol, nextStatus];
        })
    );
    return {
        ...status,
        previewSymbols: Array.from(dryRunPreviewSymbols).sort(),
        perSymbol,
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

        const sharedWalletStartUsdt = Number(req.body?.sharedWalletStartUsdt ?? req.body?.walletBalanceStartUsdt ?? 5000);
        const symbolConfigs = extractSymbolCapitalConfigsFromBody(req.body, symbolsRequested, sharedWalletStartUsdt);
        const legacyConfigMigrated = !Array.isArray(req.body?.symbolConfigs);
        resetDryRunRuntimeState(sharedWalletStartUsdt);

        const status = dryRunSession.start({
            symbols: symbolsRequested,
            runId: req.body?.runId ? String(req.body.runId) : undefined,
            sharedWalletStartUsdt,
            symbolConfigs,
            startupMode: 'WAIT_MICRO_WARMUP',
            walletBalanceStartUsdt: Number(req.body?.walletBalanceStartUsdt ?? sharedWalletStartUsdt),
            initialMarginUsdt: Number(req.body?.initialMarginUsdt ?? 200),
            leverage: Number(req.body?.leverage ?? 10),
            makerFeeRate: req.body?.makerFeeRate != null ? Number(req.body.makerFeeRate) : undefined,
            takerFeeRate: req.body?.takerFeeRate != null ? Number(req.body.takerFeeRate) : undefined,
            maintenanceMarginRate: Number(req.body?.maintenanceMarginRate ?? 0.005),
            fundingRates,
            fundingIntervalMs: Number(req.body?.fundingIntervalMs ?? (8 * 60 * 60 * 1000)),
            heartbeatIntervalMs: Number(req.body?.heartbeatIntervalMs ?? 10_000),
        });

        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        dryRunPreviewSymbols.clear();
        for (const symbol of symbolsRequested) {
            dryRunForcedSymbols.add(symbol);
            dryRunPreviewSymbols.add(symbol);
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

        res.json({ ok: true, status: withRuntimeStrategyConfig(status), legacyConfigMigrated });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_start_failed' });
    }
});

app.post('/api/dry-run/stop', (req, res) => {
    try {
        const status = dryRunSession.stop();
        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        for (const symbol of status.symbols || []) {
            if (symbol) dryRunPreviewSymbols.add(String(symbol).toUpperCase());
        }
        updateStreams();
        res.json({ ok: true, status: withRuntimeStrategyConfig(status) });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_stop_failed' });
    }
});

app.post('/api/dry-run/reset', (req, res) => {
    try {
        const currentStatus = dryRunSession.getStatus();
        const resetEquity = Number(currentStatus.config?.sharedWalletStartUsdt || RISK_ENGINE_DEFAULT_EQUITY_USDT);
        const status = dryRunSession.reset();
        resetDryRunRuntimeState(resetEquity);
        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        updateStreams();
        res.json({ ok: true, status: withRuntimeStrategyConfig(status) });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_reset_failed' });
    }
});

app.post('/api/dry-run/preview-symbols', (req, res) => {
    try {
        const symbols = Array.isArray(req.body?.symbols)
            ? req.body.symbols.map((s: any) => String(s || '').toUpperCase()).filter(Boolean)
            : [];
        dryRunPreviewSymbols.clear();
        for (const symbol of symbols) {
            dryRunPreviewSymbols.add(symbol);
        }
        updateStreams();
        res.json({ ok: true, symbols: Array.from(dryRunPreviewSymbols).sort() });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'dry_run_preview_symbols_failed' });
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

app.use('/api/telemetry', createTelemetryRoutes({
    metricsCollector: observabilityMetrics.collector,
    latencyTracker,
    getUptimeMs: () => healthController.getUptime(),
    getActiveSymbols: () => Array.from(activeSymbols),
}));

app.use('/api/strategy', createStrategyRoutes({
    consensusEngine: strategyApiConsensusEngine,
    getCurrentSignals: (symbol?: string) => getDashboardStrategySignals(symbol),
    getCurrentConsensus: (symbol?: string) => getDashboardStrategyConsensus(symbol),
    getCurrentRiskState: (_symbol?: string) => getDashboardRiskState(),
}));

app.use('/api/risk', createRiskRoutes({
    getRiskStateManager: () => institutionalRiskEngine.getStateManager(),
    killSwitchManager: {
        isActive: () => institutionalRiskEngine.getGuards().killSwitch.isKillSwitchActive(),
        getLastTrigger: () => {
            const events = institutionalRiskEngine.getGuards().killSwitch.getKillSwitchEvents();
            const last = events.length > 0 ? events[events.length - 1] : null;
            if (!last) return null;
            return { timestamp: last.timestamp, reason: last.reason };
        },
    },
    getPositionExposure: () => {
        const summary = RISK_ENGINE_ENABLED ? institutionalRiskEngine.getRiskSummary() : null;
        const totalPositionNotional = Number(summary?.guards?.multiSymbol?.totalNotional || 0);
        const leverageBase = Math.max(1, Number(RISK_ENGINE_CONFIG.position.maxLeverage || 1));
        const totalMarginUsed = totalPositionNotional / leverageBase;
        const availableMargin = Math.max(0, riskEngineLastKnownEquity - totalMarginUsed);
        const marginUtilizationPercent = riskEngineLastKnownEquity > 0
            ? (totalMarginUsed / riskEngineLastKnownEquity) * 100
            : 0;
        return {
            totalPositionNotional,
            totalMarginUsed,
            availableMargin,
            marginUtilizationPercent,
        };
    },
    getRiskLimits: () => ({
        maxPositionNotional: Number(RISK_ENGINE_CONFIG.position.maxPositionNotional || 0),
        maxLeverage: Number(RISK_ENGINE_CONFIG.position.maxLeverage || 0),
        maxPositionQty: Number(RISK_ENGINE_CONFIG.position.maxPositionQty || 0),
        dailyLossLimit: Number(RISK_ENGINE_CONFIG.drawdown.dailyLossLimitRatio || 0) * riskEngineLastKnownEquity,
        reducedRiskPositionMultiplier: Number(RISK_ENGINE_CONFIG.state.reducedRiskPositionMultiplier || 1),
    }),
}));

app.use('/api/resilience', createResilienceRoutes({
    antiSpoofGuards: resiliencePatches.getAntiSpoofGuards(),
    deltaBurstFilters: resiliencePatches.getDeltaBurstFilters(),
    latencyTracker,
    flashCrashDetector: resiliencePatches.getFlashCrashDetector(),
    getGuardActions: () => resilienceGuardActions,
    getTriggerCounters: () => ({ ...resilienceTriggerCounters }),
}));

app.use('/api/analytics', createAnalyticsRoutes({
    analyticsEngine,
    getDryRunStatus: () => dryRunSession.getStatus(),
}));

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
    const requestedSyms = p.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const syms = sanitizeTelemetrySymbols(requestedSyms);
    if (requestedSyms.length !== syms.length) {
        log('WS_SYMBOLS_SANITIZED', {
            requested: requestedSyms,
            allowed: syms,
            selectedSymbols: orchestrator.getExecutionStatus().selectedSymbols || [],
            dryRunSymbols: dryRunSession.getActiveSymbols(),
            remoteAddress: req.socket.remoteAddress || null,
        });
    }
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

