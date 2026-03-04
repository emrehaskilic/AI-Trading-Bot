/**
 * Shared TypeScript Types for Trading Bot UI
 * Frontend-Backend Integration Types
 */

// =============================================================================
// Health & Status Types
// =============================================================================

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  version: string;
  timestamp: string;
}

export interface ReadinessStatus {
  ready: boolean;
  reasons?: string[];
  dependencies: Record<string, boolean>;
}

export interface SystemStatus {
  ok: boolean;
  executionEnabled: boolean;
  killSwitch: boolean;
  decisionMode: string;
  decisionEnabled: boolean;
  riskEngineEnabled: boolean;
  riskEngine: RiskSummary | null;
  resilienceEnabled: boolean;
  resilience: ResilienceStatus | null;
  activeSymbols: string[];
  wsClients: number;
  wsState: string;
}

// =============================================================================
// Risk Engine Types
// =============================================================================

export type RiskState = 'TRACKING' | 'REDUCED_RISK' | 'HALTED' | 'KILL_SWITCH';

export interface RiskSummary {
  state: RiskState;
  killSwitchActive: boolean;
  tradingEnabled: boolean;
  paperMode: boolean;
  lastTriggers: Array<{
    action: string;
    reason: string;
    timestamp: string;
  }>;
}

export interface RiskSnapshot {
  state: RiskState;
  killSwitchActive: boolean;
  tradingEnabled: boolean;
  paperMode: boolean;
  lastTriggers: Array<{
    action: string;
    reason: string;
    timestamp: string;
  }>;
}

export interface RiskStatusResponse {
  ok: boolean;
  enabled: boolean;
  defaultEquityUsdt: number;
  summary: RiskSummary | null;
}

// =============================================================================
// Telemetry Types
// =============================================================================

export interface TelemetrySnapshot {
  wsLatency: {
    p50: number;
    p95: number;
    p99: number;
  };
  strategyConfidence: {
    p50: number;
    p95: number;
  };
  tradeAttempts: number;
  tradeRejected: number;
  killSwitchTriggered: number;
  analyticsPnl: number;
}

export interface LatencySnapshot {
  records: Array<{
    name: string;
    p50: number;
    p95: number;
    p99: number;
    count: number;
  }>;
}

// =============================================================================
// Strategy Types
// =============================================================================

export type SignalSide = 'LONG' | 'SHORT' | 'FLAT';
export type ActionSide = 'buy' | 'sell' | 'neutral';

export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  side: SignalSide;
  confidence: number;
  reasonCodes: string[];
  validUntil: string;
  timestamp: number;
  validityDurationMs: number;
}

export interface StrategyConsensus {
  timestampMs: number;
  side: SignalSide;
  confidence: number;
  quorumMet: boolean;
  riskGatePassed: boolean;
  contributingStrategies: number;
  totalStrategies: number;
  vetoApplied: boolean;
  shouldTrade: boolean;
  signals: StrategySignal[];
}

export interface StrategySnapshot {
  consensus: {
    side: ActionSide;
    action: string;
    confidence: number;
    quorum: number;
    conflictResolution: string;
  };
  signals: Array<{
    strategyId: string;
    side: string;
    confidence: number;
    reasonCodes: string[];
    validUntil: string;
  }>;
}

// =============================================================================
// Analytics Types
// =============================================================================

export interface AnalyticsSnapshot {
  pnl: number;
  fees: number;
  slippage: number;
  drawdown: number;
  tradeQualityScores: Array<{
    tradeId: string;
    score: number;
  }>;
}

export interface AnalyticsSummary {
  netPnl: number;
  totalFees: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgTradePnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export interface AnalyticsSnapshotResponse {
  ok: boolean;
  summary?: AnalyticsSummary;
  positions?: PositionAnalytics[];
  trades?: TradeAnalytics[];
}

export interface PositionAnalytics {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  qty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export interface TradeAnalytics {
  tradeId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  fees: number;
  timestamp: number;
}

// =============================================================================
// Resilience Types
// =============================================================================

export interface ResilienceSnapshot {
  lastGuardActions: Array<{
    action: string;
    reason: string;
    timestamp: string;
  }>;
  triggerCounts: {
    antiSpoof: number;
    deltaBurst: number;
    latency: number;
    flashCrash: number;
  };
}

export interface ResilienceStatus {
  action: 'ALLOW' | 'SUPPRESS' | 'HALT' | 'KILL_SWITCH' | 'NO_TRADE';
  allow: boolean;
  confidenceMultiplier: number;
  reasons: string[];
  spoofAwareObi?: {
    obi: number;
    obiWeighted: number;
    spoofAdjusted: boolean;
  } | null;
}

// =============================================================================
// Dry Run Types
// =============================================================================

export interface DryRunStatus {
  running: boolean;
  runId: string | null;
  symbols: string[];
  summary: {
    totalEquity: number;
    walletBalance: number;
    totalUnrealizedPnl: number;
    totalRealizedPnl: number;
    totalFees: number;
  };
  perSymbol: Record<string, DryRunSymbolStatus>;
  config?: {
    superScalpEnabled?: boolean;
  };
}

export interface DryRunSymbolStatus {
  position: {
    side: 'LONG' | 'SHORT' | null;
    qty: number;
    entryPrice: number;
    notionalUsdt: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
    addsUsed: number;
    timeInPositionMs: number;
  } | null;
  metrics: {
    markPrice: number;
    realizedPnl: number;
    unrealizedPnl: number;
  };
  risk: {
    dynamicLeverage: number;
    liquidationDistancePct: number;
  };
}

export interface DryRunStartRequest {
  symbols?: string[];
  symbol?: string;
  runId?: string;
  walletBalanceStartUsdt?: number;
  initialMarginUsdt?: number;
  leverage?: number;
  makerFeeRate?: number;
  takerFeeRate?: number;
  maintenanceMarginRate?: number;
  fundingRates?: Record<string, number>;
  fundingIntervalMs?: number;
  heartbeatIntervalMs?: number;
  debugAggressiveEntry?: boolean;
  superScalpEnabled?: boolean;
}

// =============================================================================
// Execution Types
// =============================================================================

export interface ExecutionStatus {
  connected: boolean;
  connection: {
    state: string;
    ready: boolean;
    readyReason: string | null;
    hasCredentials: boolean;
  };
  symbols: string[];
  settings: {
    leverage: number;
    pairInitialMargins: Record<string, number>;
  };
}

export interface ExecutionConnectRequest {
  apiKey: string;
  apiSecret: string;
}

export interface ExecutionSettingsRequest {
  leverage?: number;
  pairInitialMargins?: Record<string, number>;
}

// =============================================================================
// Orderbook & Market Data Types
// =============================================================================

export interface OrderbookLevel {
  price: number;
  qty: number;
}

export interface OrderbookSnapshot {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  lastUpdateId: number;
  timestamp: number;
}

export interface MarketMetrics {
  symbol: string;
  state: string;
  midPrice: number | null;
  spreadPct: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  eventTimeMs: number;
}

export interface CvdMetrics {
  cvd: number;
  delta: number;
  state: 'Normal' | 'Elevated' | 'Extreme';
  timeframe: string;
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

export type WebSocketMessageType = 
  | 'metrics'
  | 'health'
  | 'error'
  | 'subscribed'
  | 'unsubscribed';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  symbol?: string;
  timestamp?: number;
  data?: unknown;
  error?: string;
}

export interface MetricsMessage extends WebSocketMessage {
  type: 'metrics';
  symbol: string;
  state: string;
  event_time_ms: number;
  riskEngine: RiskSummary | null;
  cvd: {
    tf1m: CvdMetrics;
    tf5m: CvdMetrics;
    tf15m: CvdMetrics;
  };
  strategyConsensus: StrategyConsensus | null;
  resilience: ResilienceStatus | null;
  bestBid: number | null;
  bestAsk: number | null;
  spreadPct: number | null;
  midPrice: number | null;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// =============================================================================
// Polling Types
// =============================================================================

export interface PollingOptions {
  intervalMs: number;
  enabled?: boolean;
  retryOnError?: boolean;
  maxRetries?: number;
  onError?: (error: Error) => void;
}

export interface PollingState<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: number | null;
  retryCount: number;
}

// =============================================================================
// Portfolio Types
// =============================================================================

export interface PortfolioSnapshot {
  exposures: Record<string, number>;
  totalExposure: number;
  netExposure: number;
  grossExposure: number;
  concentration: {
    maxSingleExposure: number;
    maxSingleExposureSymbol: string | null;
  };
}

// =============================================================================
// Backtest Types
// =============================================================================

export interface MonteCarloResult {
  finalCapitals: number[];
  maxDrawdowns: number[];
  sharpeRatios: number[];
  winRates: number[];
}

export interface WalkForwardReport {
  windowStart: number;
  windowEnd: number;
  bestThreshold: number;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
}

export interface BacktestRequest {
  symbol: string;
  fromMs?: number;
  toMs?: number;
  runs?: number;
  seed?: number;
  initialCapital?: number;
  ruinThreshold?: number;
}
