/**
 * Analytics Types - Phase 4 Profitability Measurement Infrastructure
 * 
 * Defines all TypeScript interfaces for trade-level and session-level analytics.
 */

// ============================================================================
// EVENT TYPES (Event Sourcing)
// ============================================================================

export interface FillEvent {
  type: 'FILL';
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  fee: number;
  feeType: 'maker' | 'taker';
  timestamp: number;
  orderId: string;
  tradeId: string;
  isReduceOnly: boolean;
}

export interface PositionUpdateEvent {
  type: 'POSITION_UPDATE';
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  qty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  timestamp: number;
}

export interface PriceTickEvent {
  type: 'PRICE_TICK';
  symbol: string;
  markPrice: number;
  timestamp: number;
}

export interface FundingEvent {
  type: 'FUNDING';
  symbol: string;
  fundingRate: number;
  payment: number;
  timestamp: number;
}

export type AnalyticsEvent = FillEvent | PositionUpdateEvent | PriceTickEvent | FundingEvent;

// ============================================================================
// PnL METRICS
// ============================================================================

export interface RealizedPnL {
  symbol: string;
  totalRealizedPnl: number;
  grossPnl: number;
  totalFees: number;
  makerFees: number;
  takerFees: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
}

export interface UnrealizedPnL {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  qty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  notionalValue: number;
}

export interface FeeBreakdown {
  symbol: string;
  totalFees: number;
  makerFees: number;
  takerFees: number;
  makerVolume: number;
  takerVolume: number;
  makerFeeCount: number;
  takerFeeCount: number;
}

// ============================================================================
// EXECUTION & MICROSTRUCTURE
// ============================================================================

export interface SlippageMetrics {
  symbol: string;
  orderId: string;
  expectedPrice: number;
  executedPrice: number;
  slippageBps: number; // Basis points (1 bps = 0.01%)
  slippageType: 'positive' | 'negative' | 'neutral';
  side: 'BUY' | 'SELL';
  qty: number;
  timestamp: number;
}

export interface FlipMetrics {
  symbol: string;
  flipCount: number;
  totalTrades: number;
  flipRate: number; // Percentage
  lastFlipTimestamp: number | null;
  flips: Array<{
    from: 'LONG' | 'SHORT';
    to: 'SHORT' | 'LONG';
    timestamp: number;
    price: number;
  }>;
}

export interface AdverseSelectionMetrics {
  symbol: string;
  tradeId: string;
  entryPrice: number;
  entrySide: 'LONG' | 'SHORT';
  price1MinLater: number;
  priceChangeBps: number;
  isAdverse: boolean; // True if price moved against position
  severity: 'low' | 'medium' | 'high';
}

export interface TimeUnderWaterMetrics {
  symbol: string;
  tradeId: string;
  entryTimestamp: number;
  exitTimestamp: number | null;
  timeUnderWaterMs: number;
  maxDrawdownDuringTrade: number;
  recoveredAt: number | null;
}

// ============================================================================
// TRADE QUALITY
// ============================================================================

export interface MfeMaeMetrics {
  symbol: string;
  tradeId: string;
  entryPrice: number;
  exitPrice: number | null;
  side: 'LONG' | 'SHORT';
  
  // Maximum Favorable Excursion
  mfePrice: number;
  mfeValue: number;
  mfePercent: number;
  mfeTimestamp: number;
  
  // Maximum Adverse Excursion
  maePrice: number;
  maeValue: number;
  maePercent: number;
  maeTimestamp: number;
  
  // Ratios
  mfeMaeRatio: number;
  efficiencyRatio: number; // Actual PnL / MFE
}

export interface DrawdownMetrics {
  currentDrawdown: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  peakEquity: number;
  troughEquity: number;
  drawdownStart: number;
  drawdownEnd: number | null;
  recoveryTimeMs: number | null;
}

export interface TradeQualityScore {
  symbol: string;
  tradeId: string;
  overallScore: number; // 0-100
  
  // Component scores (0-100)
  mfeMaeScore: number;
  timingScore: number;
  executionScore: number;
  riskAdjustedScore: number;
  
  // Weights used
  weights: {
    mfeMae: number;
    timing: number;
    execution: number;
    riskAdjusted: number;
  };
  
  // Explanations
  explanations: string[];
}

// ============================================================================
// TRADE LIFECYCLE
// ============================================================================

export interface TradeLifecycle {
  tradeId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  
  // Entry
  entryTimestamp: number;
  entryPrice: number;
  entryQty: number;
  entryOrderId: string;
  entrySlippageBps: number;
  
  // Exit (null if still open)
  exitTimestamp: number | null;
  exitPrice: number | null;
  exitQty: number | null;
  exitOrderId: string | null;
  exitSlippageBps: number | null;
  
  // State
  status: 'OPEN' | 'CLOSED';
  
  // PnL
  realizedPnl: number;
  fees: number;
  netPnl: number;
  
  // Quality metrics
  mfeMae: MfeMaeMetrics | null;
  timeUnderWater: TimeUnderWaterMetrics | null;
  adverseSelection: AdverseSelectionMetrics | null;
  
  // Price history for MFE/MAE calculation
  priceHistory: Array<{
    timestamp: number;
    price: number;
    markPrice: number;
  }>;
}

// ============================================================================
// SESSION SUMMARY
// ============================================================================

export interface SessionSummary {
  metadata: {
    sessionId: string;
    generatedAt: string;
    version: string;
    startTime: number;
    endTime: number | null;
    durationMs: number;
  };
  
  summary: {
    totalTrades: number;
    openPositions: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    
    totalRealizedPnl: number;
    unrealizedPnl: number;
    totalFees: number;
    netPnl: number;
    
    avgTradePnl: number;
    avgReturnPerTradePct: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    
    maxDrawdown: number;
    maxDrawdownPercent: number;
    
    totalVolume: number;
    makerVolume: number;
    takerVolume: number;
  };
  
  bySymbol: Record<string, {
    trades: number;
    realizedPnl: number;
    unrealizedPnl: number;
    fees: number;
    volume: number;
    flipRate: number;
    openPosition: boolean;
    positionSide: 'LONG' | 'SHORT' | 'FLAT';
    positionQty: number;
  }>;
  
  execution: {
    avgSlippageBps: number;
    slippageP95Bps: number;
    slippageMaxBps: number;
    slippageSamples: number;
    positiveSlippageCount: number;
    negativeSlippageCount: number;
    totalFlips: number;
    avgFlipRate: number;
    adverseSelectionCount: number;
    adverseSelectionRate: number;
  };
  
  quality: {
    avgMfeMaeRatio: number;
    avgTradeScore: number;
    goodTrades: number; // Score >= 70
    badTrades: number;  // Score < 40
  };

  performance: {
    sharpeRatio: number;
    sortinoRatio: number;
    returnVolatility: number;
    downsideDeviation: number;
    expectancy: number;
  };

  positions: UnrealizedPnL[];
  
  trades: TradeLifecycle[];
  drawdown: DrawdownMetrics;
}

// ============================================================================
// EVIDENCE PACK
// ============================================================================

export interface EvidencePack {
  schema: 'analytics-evidence-pack-v1';
  metadata: {
    generatedAt: string;
    sessionId: string;
    version: string;
    source: string;
  };
  
  pnl: {
    realized: RealizedPnL[];
    unrealized: UnrealizedPnL[];
    fees: FeeBreakdown[];
  };
  
  execution: {
    slippage: SlippageMetrics[];
    flips: FlipMetrics[];
    adverseSelection: AdverseSelectionMetrics[];
    timeUnderWater: TimeUnderWaterMetrics[];
  };
  
  quality: {
    mfeMae: MfeMaeMetrics[];
    scores: TradeQualityScore[];
    drawdown: DrawdownMetrics;
  };
  
  session: SessionSummary;
}

// ============================================================================
// ANALYTICS ENGINE CONFIG
// ============================================================================

export interface AnalyticsEngineConfig {
  // Throttling
  snapshotIntervalMs: number;
  priceHistoryMaxLength: number;
  
  // Scoring weights
  scoringWeights: {
    mfeMae: number;
    timing: number;
    execution: number;
    riskAdjusted: number;
  };
  
  // Thresholds
  adverseSelectionThresholdBps: number;
  slippageThresholdBps: number;
  
  // Persistence
  persistToDisk: boolean;
  outputDir: string;
}

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsEngineConfig = {
  snapshotIntervalMs: 30000, // 30 seconds
  priceHistoryMaxLength: 1000,
  scoringWeights: {
    mfeMae: 0.35,
    timing: 0.25,
    execution: 0.20,
    riskAdjusted: 0.20,
  },
  adverseSelectionThresholdBps: 10,
  slippageThresholdBps: 5,
  persistToDisk: true,
  outputDir: './logs/analytics',
};
