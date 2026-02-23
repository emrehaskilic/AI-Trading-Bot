export interface SignalDisplay {
  signal:
    | 'SWEEP_FADE_LONG'
    | 'SWEEP_FADE_SHORT'
    | 'BREAKOUT_LONG'
    | 'BREAKOUT_SHORT'
    | 'ENTRY_LONG'
    | 'ENTRY_SHORT'
    | 'TREND_LONG'
    | 'TREND_SHORT'
    | 'BIAS_LONG'
    | 'BIAS_SHORT'
    | 'POSITION_LONG'
    | 'POSITION_SHORT'
    | null;
  score: number;
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
  vetoReason: string | null;
  candidate: {
    entryPrice: number;
    tpPrice: number;
    slPrice: number;
  } | null;
  boost?: {
    score: number;
    contributions: Record<string, number>;
    timeframeMultipliers: Record<string, number>;
  };
}

export interface StrategyPositionSnapshot {
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  unrealizedPnlPct: number;
  addsUsed: number;
  timeInPositionMs: number;
}

export interface AIBiasSnapshot {
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  source: 'POSITION_LOCK' | 'TREND_LOCK' | 'STATE' | 'EXIT_SIGNAL';
  lockedByPosition: boolean;
  breakConfirm: number;
  reason: string | null;
  timestampMs: number;
}

export interface SnapshotMetadata {
  eventId: number;
  stateHash: string;
  ts: number;
}
export interface CvdTfMetrics {
  cvd: number;
  delta: number;
  state: 'Normal' | 'High Vol' | 'Extreme';
}

/**
 * Legacy orderflow metrics that were formerly computed in the
 * frontend.  These values are derived from both trades and the
 * orderbook on the server.  They maintain parity with the original
 * "Orderflow Matrix" UI.
 */
export interface LegacyMetrics {
  price: number;
  obiWeighted: number;
  obiDeep: number;
  obiDivergence: number;
  delta1s: number;
  delta5s: number;
  deltaZ: number;
  cvdSession: number;
  cvdSlope: number;
  vwap: number;
  totalVolume: number;
  totalNotional: number;
  tradeCount: number;
}

/**
 * Time and sales summary metrics derived from the trade tape.  These
 * values summarise aggressive buy and sell volume, trade counts and
 * distribution, bid/ask dominance and microburst detection.
 */
export interface TimeAndSalesMetrics {
  aggressiveBuyVolume: number;
  aggressiveSellVolume: number;
  tradeCount: number;
  smallTrades: number;
  midTrades: number;
  largeTrades: number;
  bidHitAskLiftRatio: number;
  consecutiveBurst: {
    side: 'buy' | 'sell';
    count: number;
  };
  printsPerSecond: number;
}

/**
 * Open interest metrics (futures context).  Delta is the change in
 * open interest since the previous update.  Source describes whether
 * the data comes from the real exchange or a mock feed.
 */
export interface OpenInterestMetrics {
  openInterest: number;
  oiChangeAbs: number;
  oiChangePct: number;
  oiDeltaWindow: number;
  lastUpdated: number;
  source: 'real' | 'mock';
  stabilityMsg?: string;
}

/**
 * Funding rate metrics.  ``rate`` is the current funding rate,
 * ``timeToFundingMs`` is the milliseconds until the next funding
 * event and ``trend`` indicates whether the rate is rising, falling
 * or flat.  Source indicates real or mock.
 */
export interface FundingContext {
  rate: number;
  timeToFundingMs: number;
  trend: 'up' | 'down' | 'flat';
  source: 'real' | 'mock';
  markPrice?: number | null;
  indexPrice?: number | null;
}

export interface LiquidityMetrics {
  microPrice: number | null;
  imbalanceCurve: {
    level1: number;
    level5: number;
    level10: number;
    level20: number;
    level50: number;
  };
  bookSlopeBid: number;
  bookSlopeAsk: number;
  bookConvexity: number;
  liquidityWallScore: number;
  voidGapScore: number;
  expectedSlippageBuy: number;
  expectedSlippageSell: number;
  resiliencyMs: number;
  effectiveSpread: number;
  realizedSpreadShortWindow: number;
}

export interface PassiveFlowMetrics {
  bidAddRate: number;
  askAddRate: number;
  bidCancelRate: number;
  askCancelRate: number;
  depthDeltaDecomposition: {
    addVolume: number;
    cancelVolume: number;
    tradeRelatedVolume: number;
    netDepthDelta: number;
  };
  queueDeltaBestBid: number;
  queueDeltaBestAsk: number;
  spoofScore: number;
  refreshRate: number;
}

export interface DerivativesMetrics {
  markLastDeviationPct: number | null;
  indexLastDeviationPct: number | null;
  perpBasis: number | null;
  perpBasisZScore: number;
  liquidationProxyScore: number;
}

export interface ToxicityMetrics {
  vpinApprox: number;
  signedVolumeRatio: number;
  priceImpactPerSignedNotional: number;
  tradeToBookRatio: number;
  burstPersistenceScore: number;
}

export interface RegimeMetrics {
  realizedVol1m: number;
  realizedVol5m: number;
  realizedVol15m: number;
  volOfVol: number;
  microATR: number;
  chopScore: number;
  trendinessScore: number;
}

export interface CrossMarketMetrics {
  spotPerpDivergence: number | null;
  betaToBTC: number;
  betaToETH: number;
  crossVenueImbalanceDiff: number | null;
}

/**
 * The structure of a single ``metrics`` message from the server.
 * Each message contains data for one symbol.  The UI should not
 * perform any calculations on these fields; they are ready for
 * rendering.
 */
export interface MetricsMessage {
  type: 'metrics';
  symbol: string;
  state: 'LIVE' | 'STALE' | 'RESYNCING' | 'UNKNOWN';
  snapshot: SnapshotMetadata;
  timeAndSales: TimeAndSalesMetrics;
  cvd: {
    tf1m: CvdTfMetrics;
    tf5m: CvdTfMetrics;
    tf15m: CvdTfMetrics;
  };
  absorption: number | null;
  openInterest: OpenInterestMetrics | null;
  funding: FundingContext | null;
  aiTrend?: {
    side: 'LONG' | 'SHORT' | null;
    score: number;
    intact: boolean;
    ageMs: number | null;
    breakConfirm: number;
    source?: 'runtime' | 'bootstrap';
  } | null;
  aiBias?: AIBiasSnapshot | null;
  legacyMetrics: LegacyMetrics;
  orderbookIntegrity?: {
    symbol: string;
    level: 'OK' | 'DEGRADED' | 'CRITICAL';
    message: string;
    lastUpdateTimestamp: number;
    sequenceGapCount: number;
    crossedBookDetected: boolean;
    avgStalenessMs: number;
    reconnectCount: number;
    reconnectRecommended: boolean;
  };
  signalDisplay: SignalDisplay;
  strategyPosition?: StrategyPositionSnapshot | null;
  advancedMetrics: {
    sweepFadeScore: number;
    breakoutScore: number;
    volatilityIndex: number;
  };
  liquidityMetrics?: LiquidityMetrics;
  passiveFlowMetrics?: PassiveFlowMetrics;
  derivativesMetrics?: DerivativesMetrics;
  toxicityMetrics?: ToxicityMetrics;
  regimeMetrics?: RegimeMetrics;
  crossMarketMetrics?: CrossMarketMetrics | null;
  enableCrossMarketConfirmation?: boolean;
  bids: [number, number, number][];
  asks: [number, number, number][];
  midPrice: number | null;
  lastUpdateId?: number;
}

/**
 * Per symbol state stored in the Dashboard.  Each symbol maps to
 * its latest metrics message.  We do not store derived values on
 * the client.
 */
export type MetricsState = Record<string, MetricsMessage>;
