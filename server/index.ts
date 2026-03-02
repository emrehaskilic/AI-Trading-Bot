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
    createOrderbookState,
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
import { AIDryRunController } from './ai/AIDryRunController';
import { DecisionProvider } from './ai/DecisionProvider';
import { NoopDecisionProvider } from './ai/NoopDecisionProvider';
import { DryRunConfig, DryRunEngine, DryRunEventInput, DryRunSessionService, isUpstreamGuardError } from './dryrun';
import { logger, requestLogger, serializeError } from './utils/logger';
import { WebSocketManager } from './ws/WebSocketManager';
import { AlertService } from './notifications/AlertService';
import { getAlertConfig } from './config/alertConfig';
import { NotificationService } from './notifications/NotificationService';
import { HealthController } from './health/HealthController';
import { MarketDataArchive } from './backfill/MarketDataArchive';
import { SignalReplay } from './backfill/SignalReplay';
import { ABTestManager } from './abtesting';
import { PortfolioMonitor } from './risk/PortfolioMonitor';
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
import { BiasConfidenceTracker } from './orchestrator_v1/BiasConfidenceTracker';

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all interfaces for Nginx proxy
const BINANCE_REST_BASE = 'https://fapi.binance.com';
const BINANCE_WS_BASE = 'wss://fstream.binance.com/stream';
const BIAS_DEBUG_FIELDS = ['1', 'true', 'yes', 'on'].includes(String(process.env.BIAS_DEBUG_FIELDS || '').trim().toLowerCase());
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

function normalizeDecisionMode(raw: string | undefined): 'off' | 'orchestrator_v1' {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'off') return 'off';
    if (normalized === 'orchestrator_v1') return 'orchestrator_v1';
    logger.error('INVALID_DECISION_MODE', {
        provided: String(raw || ''),
        allowed: ['off', 'orchestrator_v1'],
    });
    process.exit(1);
}

const EXECUTION_ENABLED_DEFAULT = parseEnvFlag(process.env.EXECUTION_ENABLED);
let EXECUTION_ENABLED = EXECUTION_ENABLED_DEFAULT;
const EXECUTION_ENV = 'testnet';
const DECISION_MODE = normalizeDecisionMode(process.env.DECISION_MODE || 'off');
let SUPER_SCALP_ENABLED = parseEnvFlag(process.env.SUPER_SCALP_ENABLED);

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
}

const symbolMeta = new Map<string, SymbolMeta>();
const orderbookMap = new Map<string, OrderbookState>();

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
const orchestrator = createOrchestratorFromEnv(alertService);
const dryRunSession = new DryRunSessionService(alertService);
const aiDryRun = new AIDryRunController(dryRunSession, decisionLog, log);
const decisionProvider: DecisionProvider = new NoopDecisionProvider();
const orchestratorV1 = new OrchestratorV1();
const biasConfidenceTracker = new BiasConfidenceTracker();
const abTestManager = new ABTestManager(alertService);
const marketArchive = new MarketDataArchive();
const signalReplay = new SignalReplay(marketArchive);
const portfolioMonitor = new PortfolioMonitor();
const latencyTracker = new LatencyTracker();
const marketDataValidator = new MarketDataValidator(alertService);
const marketDataMonitor = new MarketDataMonitor(alertService, {
    maxSilenceMs: Number(process.env.MARKET_DATA_MAX_SILENCE_MS || 10_000),
});
marketDataMonitor.startMonitoring();
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
    decisionMode: DECISION_MODE,
    decisionEnabled: DECISION_MODE === 'orchestrator_v1',
    superScalpEnabled: SUPER_SCALP_ENABLED,
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
        else if (timedOutNow && DECISION_MODE !== 'orchestrator_v1') fallbackBlockedReason = 'CONFIG_BLOCK';
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

// =============================================================================
// Helpers
// =============================================================================

function getMeta(symbol: string): SymbolMeta {
    let meta = symbolMeta.get(symbol);
    if (!meta) {
        meta = {
            lastSnapshotAttempt: 0,
            lastSnapshotOk: 0,
            backoffMs: MIN_BACKOFF_MS,
            consecutiveErrors: 0,
            isResyncing: false,
            lastResyncTs: 0,
            depthMsgCount: 0,
            depthMsgCount10s: 0,
            lastDepthMsgTs: Date.now(), // Avoid immediate stale check
            tradeMsgCount: 0,
            desyncCount: 0,
            snapshotCount: 0,
            lastSnapshotHttpStatus: 0,
            snapshotLastUpdateId: 0,
            // Broadcast tracking
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
            // [PHASE 1] Deterministic Queue
            eventQueue: new SymbolEventQueue(symbol, async (ev) => {
                await processSymbolEvent(symbol, ev);
            }),
            // [PHASE 1] Snapshot tracker
            snapshotTracker: new SnapshotTracker(),
            lastStrategyEvalTs: 0,
            lastStrategyDecision: null,
        };
        symbolMeta.set(symbol, meta);
    }
    return meta;
}

function getOrderbook(symbol: string): OrderbookState {
    let state = orderbookMap.get(symbol);
    if (!state) {
        state = createOrderbookState();
        orderbookMap.set(symbol, state);
    }
    return state;
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
    const meta = getMeta(symbol);
    meta.lastStateTransitionTs = Date.now();
    if (to === 'LIVE') {
        meta.lastLiveTs = meta.lastStateTransitionTs;
    }
    log('ORDERBOOK_STATE_TRANSITION', { symbol, from, to, trigger, ...detail });
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

async function fetchSnapshot(symbol: string, trigger: string, force = false) {
    const meta = getMeta(symbol);
    const ob = getOrderbook(symbol);
    const now = Date.now();

    if (now < globalBackoffUntil) {
        log('SNAPSHOT_SKIP_GLOBAL', { symbol, wait: globalBackoffUntil - now });
        return;
    }

    const waitMs = Math.max(SNAPSHOT_MIN_INTERVAL_MS, meta.backoffMs);
    if (now - meta.lastSnapshotAttempt < waitMs) {
        meta.snapshotSkipEvents.push(now);
        log('SNAPSHOT_SKIP_LOCAL', { symbol, trigger, force, wait: waitMs - (now - meta.lastSnapshotAttempt) });
        return;
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

        if (snapshotResult.ok) {
            getIntegrity(symbol).resetAfterSnapshot(now);
            // Directly transition to LIVE as per c4c8a70 logic
            transitionOrderbookState(symbol, 'LIVE', 'snapshot_applied_success');
            log('SNAPSHOT_OK', { symbol, trigger, lastUpdateId: data.lastUpdateId });
            // Ensure live sample is recorded immediately
            recordLiveSample(symbol, true);
        } else {
            // Only go to RESYNCING if buffer gap detected
            transitionOrderbookState(symbol, 'RESYNCING', 'snapshot_buffer_gap_detected');
            log('SNAPSHOT_BUFFER_GAP', { symbol, trigger, lastUpdateId: data.lastUpdateId });
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
});

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
            if (ob.uiState === 'INIT' || ob.lastUpdateId === 0) {
                transitionOrderbookState(symbol, 'SNAPSHOT_PENDING', 'ws_open_seed');
                fetchSnapshot(symbol, 'ws_open_seed', true).catch(() => { });
            }
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
        setTimeout(updateStreams, 5000);
    });

    socket.on('error', (e) => {
        if (ws !== socket) return;
        log('WS_ERROR', { msg: e.message });
    });
}




function enqueueDepthUpdate(symbol: string, update: { U: number; u: number; pu?: number; b: [string, string][]; a: [string, string][]; eventTimeMs: number; receiptTimeMs: number }) {
    const meta = getMeta(symbol);
    meta.depthQueue.push(update);
    if (meta.depthQueue.length > DEPTH_QUEUE_MAX) {
        meta.depthQueue = [];
        meta.desyncCount++;
        meta.desyncEvents.push(Date.now());
        meta.goodSequenceStreak = 0;
        transitionOrderbookState(symbol, 'RESYNCING', 'queue_overflow', { max: DEPTH_QUEUE_MAX });
        fetchSnapshot(symbol, 'queue_overflow', true).catch(() => { });
        return;
    }
    processDepthQueue(symbol).catch((e) => {
        log('DEPTH_QUEUE_PROCESS_ERR', { symbol, error: e.message });
    });
}

async function processDepthQueue(symbol: string) {
    const meta = getMeta(symbol);
    if (meta.isProcessingDepthQueue) {
        return;
    }
    meta.isProcessingDepthQueue = true;
    try {
        while (meta.depthQueue.length > 0) {
            const update = meta.depthQueue.shift()!;
            const now = Date.now();
            const lagMs = now - update.receiptTimeMs;
            latencyTracker.record('depth_ingest_ms', Math.max(0, now - Number(update.eventTimeMs || now)));
            if (lagMs > DEPTH_LAG_MAX_MS) {
                meta.desyncCount++;
                meta.desyncEvents.push(now);
                meta.goodSequenceStreak = 0;
                meta.depthQueue = [];
                transitionOrderbookState(symbol, 'RESYNCING', 'lag_too_high', { lagMs, max: DEPTH_LAG_MAX_MS });
                await fetchSnapshot(symbol, 'lag_too_high', true);
                break;
            }

            const ob = getOrderbook(symbol);
            ob.lastSeenU_u = `${update.U}-${update.u}`;
            ob.lastDepthTime = now;

            const applied = applyDepthUpdate(ob, update);
            if (!applied.ok && applied.gapDetected) {
                meta.desyncCount++;
                meta.desyncEvents.push(now);
                meta.goodSequenceStreak = 0;
                // Drop queued updates from the broken sequence and resync from fresh snapshot.
                meta.depthQueue = [];
                log('DEPTH_DESYNC', { symbol, U: update.U, u: update.u, lastUpdateId: ob.lastUpdateId });
                transitionOrderbookState(symbol, 'RESYNCING', 'sequence_gap', { U: update.U, u: update.u, lastUpdateId: ob.lastUpdateId });
                await fetchSnapshot(symbol, 'sequence_gap', true);
                break;
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
                    meta.lastResyncTs = now;
                    getIntegrity(symbol).markReconnect(now);
                    meta.depthQueue = [];
                    transitionOrderbookState(symbol, 'RESYNCING', 'integrity_reconnect', {
                        level: integrity.level,
                        message: integrity.message,
                    });
                    await fetchSnapshot(symbol, 'integrity_reconnect', true);
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
        meta.isProcessingDepthQueue = false;
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
            meta.lastResyncTs = now;
            // Only transition if we are actually going to fetch
            transitionOrderbookState(symbol, 'RESYNCING', 'live_criteria_failed_throttled', {
                fresh: snapshotFresh,
                dataFlowing,
                dataLag: now - meta.lastDepthMsgTs,
                hasBook,
                timeSinceResync
            });
            fetchSnapshot(symbol, 'watchdog_resync', true).catch(() => { });
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
        const decisionFlowEnabled = decisionProvider.isDecisionEnabled();
        let decision = decisionFlowEnabled ? meta.lastStrategyDecision : null;
        let tasMetrics: any = null;
        let legMetrics: any = null;
        let spreadPct: number | null = null;
        let spreadRatio: number | null = null;
        let mid = p;

        const shouldEvaluateStrategy = decisionFlowEnabled
            && (!decision || (now - meta.lastStrategyEvalTs) >= STRATEGY_EVAL_MIN_INTERVAL_MS);
        if (shouldEvaluateStrategy) {
            const calcStart = Date.now();
            legMetrics = leg.computeMetrics(ob);
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
        const aiActive = aiDryRun.isActive() && aiDryRun.isTrackingSymbol(s);
        if (shouldEvaluateStrategy && decision) {
            if (aiActive) {
                const snapshotTs = Number(t || now);
                const rawPosition = dryRunSession.getStrategyPosition(s);
                const riskState = dryRunSession.getAIDryRunRiskState(s, snapshotTs);
                const executionState = dryRunSession.getAIDryRunExecutionState(s, snapshotTs);
                const blockedReasons: string[] = [];

                void aiDryRun.onMetrics({
                    symbol: s,
                    timestampMs: snapshotTs,
                    decision: {
                        regime: decision.regime,
                        dfs: decision.dfs,
                        dfsPercentile: decision.dfsPercentile,
                        volLevel: decision.volLevel,
                        gatePassed: decision.gatePassed,
                        thresholds: decision.log.thresholds,
                    },
                    market: {
                        price: p,
                        vwap: legMetrics?.vwap || mid || p,
                        spreadPct: spreadRatio,
                        delta1s: legMetrics?.delta1s || 0,
                        delta5s: legMetrics?.delta5s || 0,
                        deltaZ: legMetrics?.deltaZ || 0,
                        cvdSlope: legMetrics?.cvdSlope || 0,
                        obiWeighted: legMetrics?.obiWeighted || 0,
                        obiDeep: legMetrics?.obiDeep || 0,
                        obiDivergence: legMetrics?.obiDivergence || 0,
                    },
                    trades: {
                        printsPerSecond: tasMetrics?.printsPerSecond || 0,
                        tradeCount: tasMetrics?.tradeCount || 0,
                        aggressiveBuyVolume: tasMetrics?.aggressiveBuyVolume || 0,
                        aggressiveSellVolume: tasMetrics?.aggressiveSellVolume || 0,
                        burstCount: tasMetrics?.consecutiveBurst?.count || 0,
                        burstSide: tasMetrics?.consecutiveBurst?.side || null,
                    },
                    liquidityMetrics: advancedBundle.liquidityMetrics,
                    passiveFlowMetrics: advancedBundle.passiveFlowMetrics,
                    derivativesMetrics: advancedBundle.derivativesMetrics,
                    toxicityMetrics: advancedBundle.toxicityMetrics,
                    regimeMetrics: advancedBundle.regimeMetrics,
                    crossMarketMetrics: advancedBundle.crossMarketMetrics,
                    enableCrossMarketConfirmation: advancedBundle.enableCrossMarketConfirmation,
                    openInterest: { oiChangePct: oiMetrics ? oiMetrics.oiChangePct : null },
                    absorption: { value: absVal, side: absVal ? side : null },
                    volatility: backfill.getState().atr || 0,
                    blockedReasons,
                    riskState,
                    executionState,
                    position: rawPosition ? {
                        ...rawPosition,
                        timeInPositionMs: Math.max(0, Number(rawPosition.timeInPositionMs || 0)),
                    } : null,
                });
            } else if (isDryRunTracked) {
                if (Math.random() < 0.05) {
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

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function deriveRawBiasConfidence(decision: OrchestratorV1Decision): number {
    const smoothed = decision.telemetry?.smoothed || { deltaZ: 0, cvdSlope: 0, obiWeighted: 0 };
    const deltaZ = Number.isFinite(Number(smoothed.deltaZ)) ? Number(smoothed.deltaZ) : 0;
    const cvdSlope = Number.isFinite(Number(smoothed.cvdSlope)) ? Number(smoothed.cvdSlope) : 0;
    const obiWeighted = Number.isFinite(Number(smoothed.obiWeighted)) ? Number(smoothed.obiWeighted) : 0;

    const deltaStrength = Math.min(1, Math.abs(deltaZ) / 2.5);
    const cvdStrength = Math.min(1, Math.abs(cvdSlope) / 0.08);
    const obiStrength = Math.min(1, Math.abs(obiWeighted) / 0.35);
    const flowStrength = (deltaStrength + cvdStrength + obiStrength) / 3;

    const gatePassRatio = (
        Number(Boolean(decision.gateA?.passed))
        + Number(Boolean(decision.gateB?.passed))
        + Number(Boolean(decision.gateC?.passed))
    ) / 3;
    const readinessPenalty = decision.readiness.ready ? 1 : 0.85;
    const base = decision.position.isOpen ? 0.82 : 0.45;
    const confidence = (base + 0.28 * gatePassRatio + 0.22 * flowStrength) * readinessPenalty;
    return Number(clamp01(confidence).toFixed(4));
}

function buildDecisionViewFromOrchestrator(decision: OrchestratorV1Decision, nowMs: number) {
    const side = decision.side === 'BUY' ? 'LONG' : (decision.side === 'SELL' ? 'SHORT' : 'NONE');
    const readinessReady = Boolean(decision.readiness.ready);
    const rawConfidence = deriveRawBiasConfidence(decision);
    const biasResolution = biasConfidenceTracker.resolveWithDebug({
        symbol: decision.symbol,
        side,
        hasOpenPosition: Boolean(decision.position.isOpen),
        allGatesPassed: Boolean(decision.allGatesPassed),
        readinessReady,
        rawConfidence,
    });
    const hasRaw = Number.isFinite(rawConfidence);
    const biasConfidence = biasResolution.confidence;
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

    const aiBias: any = {
        side,
        confidence: biasConfidence,
        source: 'STATE' as const,
        lockedByPosition: decision.position.isOpen,
        breakConfirm: decision.chase.repricesUsed + decision.position.addsUsed,
        reason: vetoReason,
        timestampMs: nowMs,
    };
    if (BIAS_DEBUG_FIELDS) {
        aiBias.rawBias = biasResolution.rawBias;
        aiBias.normalizedBias = biasResolution.normalizedBias;
        aiBias.clampedBias = biasResolution.clampedBias;
        aiBias.branchUsed = biasResolution.branchUsed;
        aiBias.rawConfidence = rawConfidence;
        aiBias.hasRaw = hasRaw;
        aiBias.readinessReady = readinessReady;
    }

    return {
        aiTrend: {
            side,
            score: Number((decision.allGatesPassed ? 1 : (decision.position.isOpen ? 0.7 : 0)).toFixed(4)),
            intact: decision.chase.active || decision.position.isOpen,
            ageMs: decision.chase.startedAtMs ? Math.max(0, nowMs - decision.chase.startedAtMs) : 0,
            breakConfirm: decision.chase.repricesUsed + decision.position.addsUsed,
            source: 'runtime' as const,
        },
        aiBias,
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

    // ── Dry Run integration: forward OrchestratorV1 decisions to dryRunSession ──
    const isDryRunTracked = dryRunSession.isTrackingSymbol(symbol);
    if (isDryRunTracked && (decision.intent === 'ENTRY' || decision.intent === 'ADD' || decision.intent === 'EXIT_RISK' || decision.intent === 'EXIT_FLIP')) {
        const currentPos = dryRunSession.getStrategyPosition(symbol);
        if (decision.intent === 'ENTRY' && decision.side) {
            const signalType = decision.side === 'BUY' ? 'ENTRY_LONG' : 'ENTRY_SHORT';
            dryRunSession.submitStrategySignal(symbol, {
                signal: signalType,
                score: 100,
                vetoReason: null,
                candidate: null,
            }, decision.timestampMs);
        } else if (decision.intent === 'ADD' && decision.side) {
            const signalType = decision.side === 'BUY' ? 'ENTRY_LONG' : 'ENTRY_SHORT';
            dryRunSession.submitStrategySignal(symbol, {
                signal: signalType,
                score: 80,
                vetoReason: null,
                candidate: null,
            }, decision.timestampMs);
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
        if (order.kind === 'TAKER_ENTRY_FALLBACK') {
            decisionRuntimeStats.entryTakerNotionalPct = Math.max(
                decisionRuntimeStats.entryTakerNotionalPct,
                Number(order.notionalPct || 0)
            );
            decisionRuntimeStats.takerFillsCount += 1;
        }
    }
    log('ORCHESTRATOR_V1_ORDERS', {
        symbol,
        intent: decision.intent,
        side: decision.side,
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

    const cvdM = precomputed?.cvdMetrics ?? cvd.computeMetrics();
    const tasMetrics = precomputed?.tasMetrics ?? tas.computeMetrics();
    // Calculate OBI/Legacy if Orderbook has data (bids and asks exist)
    // This allows metrics to continue displaying during brief resyncs
    const hasBookData = ob.bids.size > 0 && ob.asks.size > 0;
    const legacyM = precomputed && Object.prototype.hasOwnProperty.call(precomputed, 'legacyMetrics')
        ? precomputed.legacyMetrics
        : (hasBookData ? leg.computeMetrics(ob) : null);

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
    const aiTrendStatus = decisionProvider.isDecisionEnabled() ? aiDryRun.getTrendStatus(s, now) : null;
    const aiBiasStatus = decisionProvider.isDecisionEnabled() ? aiDryRun.getBiasStatus(s, now) : null;
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
    let orchestratorV1Decision: OrchestratorV1Decision | null = null;
    if (DECISION_MODE === 'orchestrator_v1') {
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

        const dryRunPosition = dryRunSession.isTrackingSymbol(s) ? buildDrpSnapshot(s) : null;
        const btcDryRunPosition = (s !== 'BTCUSDT' && crossMarketRuntimeActive && dryRunSession.isTrackingSymbol('BTCUSDT'))
            ? buildDrpSnapshot('BTCUSDT')
            : null;

        orchestratorV1Decision = orchestratorV1.evaluate({
            symbol: s,
            nowMs: Number(eventTimeMs || now),
            price: Number(mid || legacyM?.price || 0),
            bestBid: bestBidPx,
            bestAsk: bestAskPx,
            spreadPct: spreadRatio,
            printsPerSecond: Number(tasMetrics?.printsPerSecond || 0),
            deltaZ: Number(legacyM?.deltaZ ?? tf1m?.delta ?? 0),
            cvdSlope: Number(legacyM?.cvdSlope ?? tf5m?.delta ?? 0),
            cvdTf5mState,
            obiDeep: Number(legacyM?.obiDeep || 0),
            obiWeighted: Number(legacyM?.obiWeighted || 0),
            trendinessScore: Number(advancedBundle.regimeMetrics?.trendinessScore || 0),
            chopScore: Number(advancedBundle.regimeMetrics?.chopScore || 0),
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
            dryRunPosition,
            btcDryRunPosition,
        });
    }
    const resolvedOrchestratorDecision = orchestratorV1Decision || defaultOrchestratorDecision(s, now);
    const orchestratorDebug = DECISION_MODE === 'orchestrator_v1'
        ? updateOrchestratorDiagnostics(s, resolvedOrchestratorDecision, Number(eventTimeMs || now))
        : {
            blockReason: 'DISABLED',
            gateA: false,
            gateB: false,
            gateC: false,
            impulse: false,
            chaseActive: false,
        };
    const decisionView = DECISION_MODE === 'orchestrator_v1'
        ? buildDecisionViewFromOrchestrator(resolvedOrchestratorDecision, now)
        : decisionProvider.evaluate({
            symbol: s,
            nowMs: now,
            decision,
            aiTrendStatus,
            aiBiasStatus,
            strategyPosition: rawStrategyPosition,
            defaultVetoReason: bf.vetoReason || 'BIAS_NEUTRAL',
        });
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
        aiTrend: decisionView.aiTrend,
        aiBias: decisionView.aiBias,
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
        legacyMetrics: legacyM,
        sessionVwap,
        htf: {
            m15: htfSnapshot.m15,
            h1: htfSnapshot.h1,
            h4: htfSnapshot.h4,
        },
        bootstrap: bootstrapSnapshot,
        orderbookIntegrity: integrity,
        signalDisplay: decisionView.signalDisplay,
        orchestratorV1: DECISION_MODE === 'orchestrator_v1' ? {
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
        } : null,
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
            obiWeighted: legacyM?.obiWeighted ?? null,
            obiDeep: legacyM?.obiDeep ?? null,
            obiDivergence: legacyM?.obiDivergence ?? null,
            integrityLevel: integrity.level
        });

        // Debug: METRICS_SYMBOL_BIND for integrity check
        log('METRICS_SYMBOL_BIND', {
            symbol: s,
            bestBid: bestBid(ob),
            bestAsk: bestAsk(ob),
            obiWeighted: legacyM?.obiWeighted ?? null,
            obiDeep: legacyM?.obiDeep ?? null,
            bookLevels: { bids: ob.bids.size, asks: ob.asks.size }
        });
    }

    if (eventTimeMs > 0 && DECISION_MODE === 'orchestrator_v1') {
        applyOrchestratorOrders(s, resolvedOrchestratorDecision);
    } else if (eventTimeMs > 0) {
        decisionRuntimeStats.executorEntrySkipped += 1;
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

app.get('/health/liveness', healthController.liveness);
app.get('/health/readiness', healthController.readiness);
app.get('/health/metrics', healthController.metrics);

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        executionEnabled: EXECUTION_ENABLED,
        killSwitch: KILL_SWITCH,
        decisionMode: DECISION_MODE,
        decisionEnabled: DECISION_MODE === 'orchestrator_v1',
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
            orchestratorRuntime: DECISION_MODE === 'orchestrator_v1' ? orchestratorV1.getRuntimeSnapshot() : null,
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
    orchestrator.setKillSwitch(KILL_SWITCH);
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
            trades: meta.tradeMsgCount
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

app.get('/api/ai-dry-run/status', (req, res) => {
    res.json({
        ok: true,
        status: withRuntimeStrategyConfig(dryRunSession.getStatus()),
        ai: aiDryRun.getStatus(),
        runtime: { superScalpEnabled: SUPER_SCALP_ENABLED },
    });
});

app.post('/api/ai-dry-run/super-scalp', (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    SUPER_SCALP_ENABLED = enabled;
    res.json({
        ok: true,
        superScalpEnabled: SUPER_SCALP_ENABLED,
        status: withRuntimeStrategyConfig(dryRunSession.getStatus()),
        ai: aiDryRun.getStatus(),
    });
});

app.post('/api/ai-dry-run/start', async (req, res) => {
    try {
        const rawSymbols = Array.isArray(req.body?.symbols)
            ? req.body.symbols.map((s: any) => String(s || '').toUpperCase())
            : [];
        const fallbackSymbol = String(req.body?.symbol || '').toUpperCase();
        const symbolsRequested: string[] = rawSymbols.length > 0
            ? rawSymbols.filter((s: string, idx: number, arr: string[]) => Boolean(s) && arr.indexOf(s) === idx)
            : (fallbackSymbol ? [fallbackSymbol] : []);

        if (symbolsRequested.length === 0) {
            res.status(400).json({ ok: false, error: 'symbols_required' });
            return;
        }

        if (typeof req.body?.superScalpEnabled !== 'undefined') {
            SUPER_SCALP_ENABLED = Boolean(req.body.superScalpEnabled);
        }

        const apiKey = String(req.body?.apiKey || '').trim();
        const model = String(req.body?.model || '').trim();
        const localPolicyTestMode = ['1', 'true', 'yes', 'on']
            .includes(String(process.env.AI_TEST_LOCAL_POLICY || 'false').trim().toLowerCase());
        const localOnly = localPolicyTestMode && Boolean(req.body?.localOnly);

        const info = await fetchExchangeInfo();
        const symbols = Array.isArray(info?.symbols) ? info.symbols : [];
        const unsupported = symbolsRequested.filter((s: string) => !symbols.includes(s));
        if (unsupported.length > 0) {
            res.status(400).json({ ok: false, error: 'symbol_not_supported', unsupported });
            return;
        }

        const bootstrapTrendEnabled = req.body?.bootstrapTrendEnabled !== false;
        if (bootstrapTrendEnabled) {
            await Promise.allSettled(symbolsRequested.map((symbol: string) => backfillCoordinator.ensure(symbol)));
        }

        const fundingRates: Record<string, number> = {};
        for (const symbol of symbolsRequested) {
            fundingRates[symbol] = lastFunding.get(symbol)?.rate ?? Number(req.body?.fundingRate ?? 0);
        }

        const status = dryRunSession.start({
            symbols: symbolsRequested,
            runId: req.body?.runId ? String(req.body.runId) : `ai-${Date.now()}`,
            walletBalanceStartUsdt: Number(req.body?.walletBalanceStartUsdt ?? 5000),
            initialMarginUsdt: Number(req.body?.initialMarginUsdt ?? 200),
            leverage: Number(req.body?.leverage ?? 10),
            makerFeeRate: req.body?.makerFeeRate != null ? Number(req.body.makerFeeRate) : undefined,
            takerFeeRate: req.body?.takerFeeRate != null ? Number(req.body.takerFeeRate) : undefined,
            maintenanceMarginRate: Number(req.body?.maintenanceMarginRate ?? 0.005),
            fundingRates,
            fundingIntervalMs: Number(req.body?.fundingIntervalMs ?? (8 * 60 * 60 * 1000)),
            heartbeatIntervalMs: Number(req.body?.heartbeatIntervalMs ?? 10_000),
            debugAggressiveEntry: Boolean(req.body?.debugAggressiveEntry ?? false),
        });

        aiDryRun.start({
            symbols: symbolsRequested,
            apiKey,
            model,
            decisionIntervalMs: Number(req.body?.decisionIntervalMs ?? 250),
            temperature: Number(req.body?.temperature ?? 0),
            maxOutputTokens: Number(req.body?.maxOutputTokens ?? 256),
            localOnly,
            bootstrapTrendBySymbol: {},
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
                transitionOrderbookState(symbol, 'SNAPSHOT_PENDING', 'ai_dry_run_start');
                fetchSnapshot(symbol, 'ai_dry_run_start', true).catch((e) => {
                    log('AI_DRY_RUN_SNAPSHOT_ERROR', { symbol, error: e?.message || 'ai_dry_run_snapshot_failed' });
                });
            }
        }

        res.json({
            ok: true,
            status: withRuntimeStrategyConfig(status),
            ai: aiDryRun.getStatus(),
            runtime: { superScalpEnabled: SUPER_SCALP_ENABLED },
            bootstrapTrend: {
                enabled: bootstrapTrendEnabled,
                mode: 'DISABLED_FOR_DECISION',
                seededSymbols: [],
            },
            bootstrapBackfill: {
                limit1m: BOOTSTRAP_1M_LIMIT,
                symbols: symbolsRequested.reduce((acc: Record<string, any>, symbol: string) => {
                    acc[symbol] = backfillCoordinator.getState(symbol);
                    return acc;
                }, {}),
            },
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'ai_dry_run_start_failed' });
    }
});

app.post('/api/ai-dry-run/stop', (req, res) => {
    try {
        aiDryRun.stop();
        const status = dryRunSession.stop();
        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        updateStreams();
        res.json({
            ok: true,
            status: withRuntimeStrategyConfig(status),
            ai: aiDryRun.getStatus(),
            runtime: { superScalpEnabled: SUPER_SCALP_ENABLED },
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'ai_dry_run_stop_failed' });
    }
});

app.post('/api/ai-dry-run/reset', (req, res) => {
    try {
        aiDryRun.stop();
        const status = dryRunSession.reset();
        updateDryRunHealthFlag();
        dryRunForcedSymbols.clear();
        updateStreams();
        res.json({
            ok: true,
            status: withRuntimeStrategyConfig(status),
            ai: aiDryRun.getStatus(),
            runtime: { superScalpEnabled: SUPER_SCALP_ENABLED },
        });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message || 'ai_dry_run_reset_failed' });
    }
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
        aiDryRun.stop();
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
        aiDryRun.stop();
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
        if (ob.uiState === 'INIT') {
            transitionOrderbookState(s, 'SNAPSHOT_PENDING', 'client_subscribe_init');
            fetchSnapshot(s, 'client_subscribe_init', true);
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
            transitionOrderbookState(symbol, 'RESYNCING', 'desync_rate_high', { desyncRate10s });
            fetchSnapshot(symbol, 'desync_rate_high', true).catch(() => { });
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
