/**
 * FAZ-5 Strategy Framework - Type Definitions
 * 
 * This module defines the core types for the strategy framework,
 * including StrategyContext, signals, and lifecycle states.
 * 
 * All timestamps are explicit parameters (no Date.now()) for deterministic behavior.
 */

import { RiskState } from '../risk/RiskStateManager';

// ============================================================================
// STRATEGY CONTEXT - The unified input for all strategies
// ============================================================================

/**
 * StrategyContext provides a unified view of all relevant market and system state
 * that strategies need to make decisions. All fields are snapshot values at
 * a specific canonical time.
 */
export interface StrategyContext {
  /** Canonical timestamp for this context (milliseconds since epoch) */
  canonicalTime: number;

  /** Symbol being traded */
  symbol: string;

  /** Metrics snapshot (from existing metrics system) */
  metrics: {
    symbol: string;
    canonicalTime: number; // deterministic timestamp
    spreadPct: number | null;
    bestBid: number | null;
    bestAsk: number | null;
    obiDeep: number | null;      // Order Book Imbalance (deep levels)
    deltaZ: number | null;       // Delta Z-score
    cvdSlope: number | null;     // Cumulative Volume Delta slope
    volatilityIndex: number | null;
    m1TrendScore: number | null;  // 1-minute trend score
    m3TrendScore: number | null;  // 3-minute trend score
    m5TrendScore: number | null;  // 5-minute trend score
    m15TrendScore: number | null; // 15-minute trend score
    fundingRate: number | null;
    printsPerSecond: number | null;
  };

  /** Orderbook state derived from metrics */
  orderbook: {
    bidDepth: number;
    askDepth: number;
    imbalance: number; // -1 to 1, negative = more asks, positive = more bids
  };

  /** Position state from position management system */
  position: {
    hasPosition: boolean;
    side: 'LONG' | 'SHORT' | null;
    size: number;
    entryPrice: number | null;
    unrealizedPnl: number | null;
  };

  /** Risk state from RiskStateManager */
  riskState: RiskState;

  /** Risk multiplier affects position sizing (0.5 for REDUCED_RISK, 0 for HALTED/KILL_SWITCH) */
  riskMultiplier: number;

  /** Market regime detection */
  regime: {
    current: MarketRegime | null;
    confidence: number; // 0 to 1
  };
}

// ============================================================================
// MARKET REGIMES
// ============================================================================

/**
 * Market regime types for strategy selection and parameter adjustment
 */
export type MarketRegime = 
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGING'
  | 'VOLATILE'
  | 'ACCUMULATING'
  | 'DISTRIBUTING'
  | 'BREAKOUT'
  | 'UNKNOWN';

/**
 * Regime classification result from regime detector
 */
export interface RegimeClassification {
  regime: MarketRegime;
  confidence: number;
  features: {
    trendStrength: number;
    volatilityPercentile: number;
    volumeProfile: 'HIGH' | 'NORMAL' | 'LOW';
    momentumScore: number;
  };
}

// ============================================================================
// STRATEGY SIGNALS
// ============================================================================

/**
 * Direction of a trading signal
 */
export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

/**
 * Type of action the signal recommends
 */
export type SignalAction = 
  | 'ENTER'      // Open new position
  | 'EXIT'       // Close existing position
  | 'ADD'        // Add to existing position
  | 'REDUCE'     // Reduce existing position
  | 'HOLD'       // Maintain current position
  | 'REVERSE';   // Flip position direction

/**
 * Individual strategy signal output
 */
export interface StrategySignal {
  /** Unique identifier for this signal */
  id: string;

  /** Strategy that generated this signal */
  strategyId: string;

  /** Strategy name for display/logging */
  strategyName: string;

  /** Signal timestamp (when generated) */
  timestamp: number;

  /** Signal expiration time (TTL) */
  validUntil: number;

  /** Current lifecycle state */
  state: StrategySignalState;

  /** Trading direction */
  direction: SignalDirection;

  /** Recommended action */
  action: SignalAction;

  /** Confidence score (0 to 1) */
  confidence: number;

  /** Suggested position size as fraction of max (0 to 1) */
  suggestedSize: number;

  /** Entry price level (if applicable) */
  entryPrice: number | null;

  /** Stop loss price level (if applicable) */
  stopLoss: number | null;

  /** Take profit price level (if applicable) */
  takeProfit: number | null;

  /** Reasoning for this signal (for logging/debugging) */
  reasoning: string;

  /** Metadata for strategy-specific data */
  metadata: Record<string, unknown>;
}

// ============================================================================
// STRATEGY LIFECYCLE
// ============================================================================

/**
 * Strategy signal lifecycle states
 * 
 * VALID -> EXPIRED (time-based)
 * VALID -> INVALIDATED (event-based)
 * VALID -> SUPERSEDED (newer signal replaces it)
 */
export enum StrategySignalState {
  /** Signal is active and can be used for decision making */
  VALID = 'VALID',

  /** Signal has exceeded its TTL and is no longer valid */
  EXPIRED = 'EXPIRED',

  /** Signal was invalidated due to new information or conditions */
  INVALIDATED = 'INVALIDATED',

  /** Signal was replaced by a newer signal from the same strategy */
  SUPERSEDED = 'SUPERSEDED'
}

/**
 * TTL (Time To Live) configuration for signals
 */
export interface TTLConfig {
  /** Default TTL in milliseconds */
  defaultTTLMs: number;

  /** Maximum allowed TTL in milliseconds */
  maxTTLMs: number;

  /** Minimum allowed TTL in milliseconds */
  minTTLMs: number;

  /** TTL adjustments based on market regime */
  regimeAdjustments?: Partial<Record<MarketRegime, number>>;

  /** TTL adjustments based on volatility */
  volatilityMultiplier?: {
    high: number;   // Multiply TTL by this when volatility is high
    normal: number; // Multiply TTL by this when volatility is normal
    low: number;    // Multiply TTL by this when volatility is low
  };
}

/**
 * Signal invalidation reason
 */
export interface InvalidationReason {
  code: string;
  description: string;
  timestamp: number;
}

// ============================================================================
// STRATEGY INTERFACE
// ============================================================================

/**
 * Base interface for all trading strategies
 */
export interface IStrategy {
  /** Unique strategy identifier */
  readonly id: string;

  /** Human-readable strategy name */
  readonly name: string;

  /** Strategy version for tracking changes */
  readonly version: string;

  /** Strategy description */
  readonly description: string;

  /**
   * Evaluate market conditions and generate a signal
   * @param context - Current strategy context
   * @param timestamp - Explicit timestamp for deterministic evaluation
   * @returns Strategy signal or null if no signal
   */
  evaluate(context: StrategyContext, timestamp: number): StrategySignal | null;

  /**
   * Check if this strategy is applicable in current market conditions
   * @param context - Current strategy context
   * @returns true if strategy can be used
   */
  isApplicable(context: StrategyContext): boolean;

  /**
   * Get the TTL configuration for this strategy
   */
  getTTLConfig(): TTLConfig;

  /**
   * Reset strategy internal state
   */
  reset(): void;
}

// ============================================================================
// CONSENSUS TYPES
// ============================================================================

/**
 * Configuration for signal consensus/aggregation
 */
export interface ConsensusConfig {
  /** Minimum number of strategies required for consensus */
  minStrategyCount: number;

  /** Minimum confidence threshold for a signal to be considered */
  minConfidenceThreshold: number;

  /** Whether to use weighted voting based on confidence */
  useWeightedVoting: boolean;

  /** Whether veto power is enabled for high-confidence signals */
  vetoEnabled: boolean;

  /** How to resolve conflicts between opposing signals */
  conflictResolution: 'CONFIDENCE' | 'MAJORITY' | 'UNANIMOUS' | 'CONSERVATIVE';

  /** Minimum net score for a consensus decision (weighted sum) */
  minNetScore?: number;

  /** Whether to require signals from different strategy categories */
  requireDiverseCategories?: boolean;
}

/**
 * Aggregated consensus result from multiple strategies
 */
export interface ConsensusResult {
  /** Whether consensus was achieved */
  hasConsensus: boolean;

  /** Consensus direction if achieved */
  direction: SignalDirection | null;

  /** Consensus action if achieved */
  action: SignalAction | null;

  /** Aggregated confidence score */
  confidence: number;

  /** Number of strategies that contributed */
  contributingStrategies: number;

  /** Individual signals that contributed to consensus */
  contributingSignals: StrategySignal[];

  /** Signals that were excluded and why */
  excludedSignals: Array<{ signal: StrategySignal; reason: string }>;

  /** Consensus timestamp */
  timestamp: number;

  /** Human-readable consensus summary */
  summary: string;
}

/**
 * Strategy category for diversity requirements
 */
export enum StrategyCategory {
  TREND_FOLLOWING = 'TREND_FOLLOWING',
  MEAN_REVERSION = 'MEAN_REVERSION',
  MOMENTUM = 'MOMENTUM',
  BREAKOUT = 'BREAKOUT',
  SCALPING = 'SCALPING',
  ARBITRAGE = 'ARBITRAGE'
}

// ============================================================================
// POSITION STATE (for integration with position management)
// ============================================================================

/**
 * Position state from the position management system
 * This mirrors the existing position system's interface
 */
export interface PositionState {
  symbol: string;
  hasPosition: boolean;
  side: 'LONG' | 'SHORT' | null;
  size: number;
  entryPrice: number | null;
  averageEntryPrice: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  leverage: number;
  liquidationPrice: number | null;
  marginUsed: number;
  lastUpdateTime: number;
}

// ============================================================================
// ORCHESTRATOR INTEGRATION TYPES
// ============================================================================

/**
 * Input from orchestrator metrics system
 * This mirrors the existing OrchestratorMetricsInput interface
 */
export interface OrchestratorMetricsInput {
  symbol: string;
  timestamp: number;
  metrics: {
    spreadPct?: number;
    bestBid?: number;
    bestAsk?: number;
    obiDeep?: number;
    deltaZ?: number;
    cvdSlope?: number;
    volatilityIndex?: number;
    m1TrendScore?: number;
    m3TrendScore?: number;
    m5TrendScore?: number;
    m15TrendScore?: number;
    fundingRate?: number;
    printsPerSecond?: number;
    bidDepth?: number;
    askDepth?: number;
  };
  position?: PositionState;
}

/**
 * Gate result from risk checks
 * Mirrors existing GateResult interface
 */
export interface GateResult {
  passed: boolean;
  reason?: string;
  riskMultiplier: number;
}

/**
 * Final decision action
 * Mirrors existing DecisionAction type
 */
export type DecisionAction = 
  | { type: 'ENTER_LONG'; size: number; price?: number }
  | { type: 'ENTER_SHORT'; size: number; price?: number }
  | { type: 'EXIT'; size: number; price?: number }
  | { type: 'ADD_TO_POSITION'; size: number; price?: number }
  | { type: 'REDUCE_POSITION'; size: number; price?: number }
  | { type: 'HOLD' }
  | { type: 'NO_ACTION'; reason: string };

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Strategy evaluation result with metadata
 */
export interface StrategyEvaluationResult {
  signal: StrategySignal | null;
  durationMs: number;
  error?: string;
  context: {
    wasApplicable: boolean;
    skippedReason?: string;
  };
}

/**
 * Performance metrics for a strategy
 */
export interface StrategyPerformanceMetrics {
  strategyId: string;
  totalEvaluations: number;
  signalsGenerated: number;
  avgConfidence: number;
  avgExecutionTimeMs: number;
  lastEvaluationTime: number;
  successRate: number;
}

/**
 * Strategy framework configuration
 */
export interface StrategyFrameworkConfig {
  enabledStrategies: string[];
  consensusConfig: ConsensusConfig;
  defaultTTLConfig: TTLConfig;
  maxConcurrentSignals: number;
  enableSignalDeduplication: boolean;
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}
