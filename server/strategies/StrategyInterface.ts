/**
 * StrategyInterface.ts
 * 
 * Base interface and abstract class for all trading strategies.
 * Part of FAZ-5 Strategy Framework.
 */

/** Signal side enumeration */
export enum SignalSide {
  FLAT = 'FLAT',
  LONG = 'LONG',
  SHORT = 'SHORT'
}

/** Signal confidence levels */
export enum ConfidenceLevel {
  VERY_LOW = 0.2,
  LOW = 0.4,
  MEDIUM = 0.6,
  HIGH = 0.8,
  VERY_HIGH = 1.0
}

/** Strategy signal output */
export interface StrategySignal {
  /** Unique strategy identifier */
  strategyId: string;
  /** Strategy name */
  strategyName: string;
  /** Signal side (LONG, SHORT, or FLAT) */
  side: SignalSide;
  /** Confidence level (0.0 to 1.0) */
  confidence: number;
  /** Timestamp when signal was generated */
  timestamp: number;
  /** Signal validity duration in milliseconds */
  validityDurationMs: number;
  /** Optional metadata for debugging/analysis */
  metadata?: Record<string, unknown>;
}

/** Strategy context input */
export interface StrategyContext {
  /** Symbol being traded */
  symbol: string;
  /** Current timestamp (deterministic) */
  timestamp: number;
  /** 3-minute trend score (-1.0 to 1.0) */
  m3TrendScore: number;
  /** 5-minute trend score (-1.0 to 1.0) */
  m5TrendScore: number;
  /** Order book imbalance (deep levels) */
  obiDeep: number;
  /** Delta Z-score */
  deltaZ: number;
  /** Volatility index */
  volatilityIndex: number;
  /** Current price */
  currentPrice: number;
  /** Additional market data */
  marketData?: Record<string, unknown>;
}

/** Base strategy interface */
export interface Strategy {
  /** Unique strategy identifier */
  readonly id: string;
  /** Human-readable strategy name */
  readonly name: string;
  /** Strategy version (semver) */
  readonly version: string;
  /** Optional description */
  readonly description?: string;

  /**
   * Evaluate the strategy and generate a signal
   * @param ctx - Strategy context with market data
   * @returns Strategy signal
   */
  evaluate(ctx: StrategyContext): StrategySignal;

  /**
   * Check if a signal is still valid at the given time
   * @param signal - The signal to validate
   * @param currentTime - Current timestamp
   * @returns True if signal is still valid
   */
  isValid(signal: StrategySignal, currentTime: number): boolean;

  /**
   * Check if this strategy can veto other signals
   * Used for filter strategies (e.g., chop filter)
   * @returns True if strategy can veto
   */
  canVeto(): boolean;
}

/** Abstract base strategy with common validation logic */
export abstract class BaseStrategy implements Strategy {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  readonly description?: string;

  /** Default validity duration in milliseconds (5 seconds) */
  protected readonly defaultValidityDurationMs: number = 5000;

  /**
   * Abstract evaluate method - must be implemented by subclasses
   */
  abstract evaluate(ctx: StrategyContext): StrategySignal;

  /**
   * Check if a signal is still valid at the given time
   * Signals expire after their validity duration
   */
  isValid(signal: StrategySignal, currentTime: number): boolean {
    const expirationTime = signal.timestamp + signal.validityDurationMs;
    return currentTime <= expirationTime;
  }

  /**
   * Default implementation - strategies cannot veto unless overridden
   */
  canVeto(): boolean {
    return false;
  }

  /**
   * Helper method to create a signal with default values
   */
  protected createSignal(
    side: SignalSide,
    confidence: number,
    timestamp: number,
    metadata?: Record<string, unknown>
  ): StrategySignal {
    // Clamp confidence to [0, 1]
    const clampedConfidence = Math.max(0, Math.min(1, confidence));

    return {
      strategyId: this.id,
      strategyName: this.name,
      side,
      confidence: clampedConfidence,
      timestamp,
      validityDurationMs: this.defaultValidityDurationMs,
      metadata
    };
  }

  /**
   * Helper method to create a FLAT signal (no trade)
   */
  protected createFlatSignal(
    timestamp: number,
    reason?: string
  ): StrategySignal {
    return this.createSignal(
      SignalSide.FLAT,
      0,
      timestamp,
      reason ? { reason } : undefined
    );
  }

  /**
   * Helper to check if a value is within a range
   */
  protected inRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  }

  /**
   * Helper to normalize a value to [0, 1] range
   */
  protected normalize(value: number, min: number, max: number): number {
    if (max === min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  /**
   * Helper to clamp a value to a range
   */
  protected clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
