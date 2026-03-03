/**
 * FAZ-5 Strategy Framework - Signal Lifecycle Manager
 * 
 * This module manages the lifecycle of strategy signals:
 * - VALID -> EXPIRED (time-based)
 * - VALID -> INVALIDATED (event-based)
 * - VALID -> SUPERSEDED (newer signal replaces it)
 * 
 * All timestamp checks use explicit parameters for deterministic behavior.
 */

import {
  StrategySignal,
  StrategySignalState,
  TTLConfig,
  InvalidationReason,
  SignalDirection,
  SignalAction
} from './types';

/**
 * Configuration for SignalLifecycleManager
 */
export interface SignalLifecycleConfig {
  /** Default TTL configuration */
  ttlConfig: TTLConfig;

  /** Whether to auto-expire signals on check */
  autoExpireOnCheck: boolean;

  /** Maximum number of signals to keep per strategy */
  maxSignalsPerStrategy: number;

  /** Whether to deduplicate signals from same strategy */
  enableDeduplication: boolean;

  /** Cleanup interval in milliseconds (0 = no auto-cleanup) */
  cleanupIntervalMs: number;
}

/**
 * Default lifecycle configuration
 */
export const DEFAULT_LIFECYCLE_CONFIG: SignalLifecycleConfig = {
  ttlConfig: {
    defaultTTLMs: 30000,    // 30 seconds
    maxTTLMs: 300000,       // 5 minutes
    minTTLMs: 5000,         // 5 seconds
    regimeAdjustments: {
      'TRENDING_UP': 1.5,
      'TRENDING_DOWN': 1.5,
      'RANGING': 0.8,
      'VOLATILE': 0.5,
      'BREAKOUT': 0.5
    },
    volatilityMultiplier: {
      high: 0.5,
      normal: 1.0,
      low: 1.5
    }
  },
  autoExpireOnCheck: true,
  maxSignalsPerStrategy: 5,
  enableDeduplication: true,
  cleanupIntervalMs: 60000  // 1 minute
};

/**
 * Internal signal storage with metadata
 */
interface SignalMetadata {
  signal: StrategySignal;
  registeredAt: number;
  expiredAt: number | null;
  invalidatedAt: number | null;
  invalidationReason: InvalidationReason | null;
  supersededBy: string | null;
}

/**
 * Statistics for signal lifecycle
 */
export interface LifecycleStatistics {
  totalRegistered: number;
  currentlyValid: number;
  totalExpired: number;
  totalInvalidated: number;
  totalSuperseded: number;
  byStrategy: Map<string, {
    registered: number;
    valid: number;
    expired: number;
    invalidated: number;
  }>;
}

/**
 * SignalLifecycleManager handles the complete lifecycle of strategy signals.
 * 
 * Key responsibilities:
 * - Register new signals with TTL
 * - Check signal validity against explicit timestamps
 * - Expire signals when TTL is exceeded
 * - Invalidate signals based on external events
 * - Supersede signals when newer ones arrive
 * - Provide query methods for valid signals
 */
export class SignalLifecycleManager {
  private signals: Map<string, SignalMetadata> = new Map();
  private config: SignalLifecycleConfig;
  private statistics = {
    totalRegistered: 0,
    totalExpired: 0,
    totalInvalidated: 0,
    totalSuperseded: 0
  };

  constructor(config: Partial<SignalLifecycleConfig> = {}) {
    this.config = {
      ...DEFAULT_LIFECYCLE_CONFIG,
      ...config
    };
  }

  // ============================================================================
  // SIGNAL REGISTRATION
  // ============================================================================

  /**
   * Register a new signal in the lifecycle manager
   * 
   * @param signal - The strategy signal to register
   * @throws Error if signal is invalid or duplicate (when deduplication enabled)
   */
  public registerSignal(signal: StrategySignal): void {
    // Validate signal
    this.validateSignal(signal);

    // Check for duplicates from same strategy
    if (this.config.enableDeduplication) {
      const existingSignal = this.findLatestSignalByStrategy(signal.strategyId);
      if (existingSignal && this.areSignalsEquivalent(existingSignal, signal)) {
        // Skip duplicate
        return;
      }

      // Supersede existing signal from same strategy
      if (existingSignal && existingSignal.state === StrategySignalState.VALID) {
        this.supersedeSignal(existingSignal.id, signal.id, signal.timestamp);
      }
    }

    // Enforce max signals per strategy
    this.enforceMaxSignalsPerStrategy(signal.strategyId);

    // Register the signal
    const metadata: SignalMetadata = {
      signal: { ...signal }, // Clone to prevent external mutation
      registeredAt: signal.timestamp,
      expiredAt: null,
      invalidatedAt: null,
      invalidationReason: null,
      supersededBy: null
    };

    this.signals.set(signal.id, metadata);
    this.statistics.totalRegistered++;
  }

  /**
   * Register multiple signals at once
   * 
   * @param signals - Array of signals to register
   * @returns Results with success/failure for each signal
   */
  public registerSignals(signals: StrategySignal[]): Array<{ signalId: string; success: boolean; error?: string }> {
    return signals.map(signal => {
      try {
        this.registerSignal(signal);
        return { signalId: signal.id, success: true };
      } catch (error) {
        return {
          signalId: signal.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
  }

  // ============================================================================
  // VALIDITY CHECKS
  // ============================================================================

  /**
   * Check if a signal is still valid at the given time
   * 
   * @param signalId - ID of the signal to check
   * @param currentTime - Explicit current timestamp
   * @returns true if signal is valid
   */
  public isValid(signalId: string, currentTime: number): boolean {
    const metadata = this.signals.get(signalId);
    if (!metadata) {
      return false;
    }

    // Auto-expire if enabled and signal has exceeded TTL
    if (this.config.autoExpireOnCheck && metadata.signal.state === StrategySignalState.VALID) {
      if (currentTime > metadata.signal.validUntil) {
        this.expireSignalInternal(metadata, currentTime);
        return false;
      }
    }

    return metadata.signal.state === StrategySignalState.VALID;
  }

  /**
   * Get the validity status of a signal with details
   * 
   * @param signalId - ID of the signal to check
   * @param currentTime - Explicit current timestamp
   * @returns Validity status with details
   */
  public getValidityStatus(
    signalId: string,
    currentTime: number
  ): {
    isValid: boolean;
    state: StrategySignalState;
    reason?: string;
    timeRemainingMs?: number;
  } | null {
    const metadata = this.signals.get(signalId);
    if (!metadata) {
      return null;
    }

    const isValid = this.isValid(signalId, currentTime);
    const timeRemainingMs = Math.max(0, metadata.signal.validUntil - currentTime);

    let reason: string | undefined;
    if (!isValid) {
      switch (metadata.signal.state) {
        case StrategySignalState.EXPIRED:
          reason = 'Signal exceeded TTL';
          break;
        case StrategySignalState.INVALIDATED:
          reason = metadata.invalidationReason?.description ?? 'Signal invalidated';
          break;
        case StrategySignalState.SUPERSEDED:
          reason = `Superseded by signal ${metadata.supersededBy}`;
          break;
      }
    }

    return {
      isValid,
      state: metadata.signal.state,
      reason,
      timeRemainingMs: isValid ? timeRemainingMs : undefined
    };
  }

  // ============================================================================
  // SIGNAL EXPIRATION
  // ============================================================================

  /**
   * Expire all signals that have exceeded their TTL
   * 
   * @param currentTime - Explicit current timestamp
   * @returns Array of expired signal IDs
   */
  public expireSignals(currentTime: number): string[] {
    const expiredIds: string[] = [];

    for (const [id, metadata] of this.signals) {
      if (
        metadata.signal.state === StrategySignalState.VALID &&
        currentTime > metadata.signal.validUntil
      ) {
        this.expireSignalInternal(metadata, currentTime);
        expiredIds.push(id);
      }
    }

    return expiredIds;
  }

  /**
   * Force expire a specific signal
   * 
   * @param signalId - ID of signal to expire
   * @param currentTime - Explicit current timestamp
   * @returns true if signal was expired, false if not found or already expired
   */
  public forceExpire(signalId: string, currentTime: number): boolean {
    const metadata = this.signals.get(signalId);
    if (!metadata || metadata.signal.state !== StrategySignalState.VALID) {
      return false;
    }

    this.expireSignalInternal(metadata, currentTime);
    return true;
  }

  // ============================================================================
  // SIGNAL INVALIDATION
  // ============================================================================

  /**
   * Invalidate a signal due to new information or conditions
   * 
   * @param signalId - ID of signal to invalidate
   * @param reason - Reason for invalidation
   * @param timestamp - Explicit timestamp
   * @returns true if signal was invalidated, false if not found or already invalid
   */
  public invalidateSignal(signalId: string, reason: string, timestamp: number): boolean {
    const metadata = this.signals.get(signalId);
    if (!metadata) {
      return false;
    }

    // Can only invalidate VALID signals
    if (metadata.signal.state !== StrategySignalState.VALID) {
      return false;
    }

    metadata.signal.state = StrategySignalState.INVALIDATED;
    metadata.invalidatedAt = timestamp;
    metadata.invalidationReason = {
      code: 'MANUAL_INVALIDATION',
      description: reason,
      timestamp
    };
    this.statistics.totalInvalidated++;

    return true;
  }

  /**
   * Invalidate signals by strategy ID
   * 
   * @param strategyId - Strategy ID to invalidate all signals for
   * @param reason - Reason for invalidation
   * @param timestamp - Explicit timestamp
   * @returns Array of invalidated signal IDs
   */
  public invalidateByStrategy(
    strategyId: string,
    reason: string,
    timestamp: number
  ): string[] {
    const invalidatedIds: string[] = [];

    for (const [id, metadata] of this.signals) {
      if (
        metadata.signal.strategyId === strategyId &&
        metadata.signal.state === StrategySignalState.VALID
      ) {
        if (this.invalidateSignal(id, reason, timestamp)) {
          invalidatedIds.push(id);
        }
      }
    }

    return invalidatedIds;
  }

  /**
   * Invalidate signals by direction (e.g., invalidate all LONG signals)
   * 
   * @param direction - Direction to invalidate
   * @param reason - Reason for invalidation
   * @param timestamp - Explicit timestamp
   * @returns Array of invalidated signal IDs
   */
  public invalidateByDirection(
    direction: SignalDirection,
    reason: string,
    timestamp: number
  ): string[] {
    const invalidatedIds: string[] = [];

    for (const [id, metadata] of this.signals) {
      if (
        metadata.signal.direction === direction &&
        metadata.signal.state === StrategySignalState.VALID
      ) {
        if (this.invalidateSignal(id, reason, timestamp)) {
          invalidatedIds.push(id);
        }
      }
    }

    return invalidatedIds;
  }

  // ============================================================================
  // SIGNAL SUPERSEDING
  // ============================================================================

  /**
   * Supersede a signal with a newer one from the same strategy
   * 
   * @param oldSignalId - ID of signal being superseded
   * @param newSignalId - ID of new signal
   * @param timestamp - Explicit timestamp
   * @returns true if signal was superseded
   */
  private supersedeSignal(
    oldSignalId: string,
    newSignalId: string,
    timestamp: number
  ): boolean {
    const metadata = this.signals.get(oldSignalId);
    if (!metadata || metadata.signal.state !== StrategySignalState.VALID) {
      return false;
    }

    metadata.signal.state = StrategySignalState.SUPERSEDED;
    metadata.supersededBy = newSignalId;
    this.statistics.totalSuperseded++;

    return true;
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get all valid signals at the given time
   * 
   * @param currentTime - Explicit current timestamp
   * @returns Array of valid signals
   */
  public getValidSignals(currentTime: number): StrategySignal[] {
    // Auto-expire if enabled
    if (this.config.autoExpireOnCheck) {
      this.expireSignals(currentTime);
    }

    const validSignals: StrategySignal[] = [];
    for (const metadata of this.signals.values()) {
      if (metadata.signal.state === StrategySignalState.VALID) {
        validSignals.push({ ...metadata.signal }); // Return clones
      }
    }

    return validSignals;
  }

  /**
   * Get valid signals filtered by direction
   * 
   * @param direction - Direction to filter by
   * @param currentTime - Explicit current timestamp
   * @returns Array of valid signals with matching direction
   */
  public getValidSignalsByDirection(
    direction: SignalDirection,
    currentTime: number
  ): StrategySignal[] {
    return this.getValidSignals(currentTime).filter(s => s.direction === direction);
  }

  /**
   * Get valid signals filtered by action
   * 
   * @param action - Action to filter by
   * @param currentTime - Explicit current timestamp
   * @returns Array of valid signals with matching action
   */
  public getValidSignalsByAction(
    action: SignalAction,
    currentTime: number
  ): StrategySignal[] {
    return this.getValidSignals(currentTime).filter(s => s.action === action);
  }

  /**
   * Get valid signals for a specific strategy
   * 
   * @param strategyId - Strategy ID to filter by
   * @param currentTime - Explicit current timestamp
   * @returns Array of valid signals from the strategy
   */
  public getValidSignalsByStrategy(
    strategyId: string,
    currentTime: number
  ): StrategySignal[] {
    return this.getValidSignals(currentTime).filter(s => s.strategyId === strategyId);
  }

  /**
   * Get a signal by ID (any state)
   * 
   * @param signalId - Signal ID
   * @returns The signal or null if not found
   */
  public getSignal(signalId: string): StrategySignal | null {
    const metadata = this.signals.get(signalId);
    return metadata ? { ...metadata.signal } : null;
  }

  /**
   * Get all signals (including expired/invalidated) for debugging
   * 
   * @returns Array of all signals
   */
  public getAllSignals(): StrategySignal[] {
    return Array.from(this.signals.values()).map(m => ({ ...m.signal }));
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Clear all signals
   */
  public clear(): void {
    this.signals.clear();
    this.statistics = {
      totalRegistered: 0,
      totalExpired: 0,
      totalInvalidated: 0,
      totalSuperseded: 0
    };
  }

  /**
   * Get lifecycle statistics
   * 
   * @param currentTime - Explicit current timestamp
   * @returns Statistics about signal lifecycle
   */
  public getStatistics(currentTime: number): LifecycleStatistics {
    const byStrategy = new Map<string, {
      registered: number;
      valid: number;
      expired: number;
      invalidated: number;
    }>();

    // Ensure valid signals are counted correctly
    this.expireSignals(currentTime);

    for (const metadata of this.signals.values()) {
      const strategyId = metadata.signal.strategyId;
      const stats = byStrategy.get(strategyId) ?? {
        registered: 0,
        valid: 0,
        expired: 0,
        invalidated: 0
      };

      stats.registered++;
      switch (metadata.signal.state) {
        case StrategySignalState.VALID:
          stats.valid++;
          break;
        case StrategySignalState.EXPIRED:
          stats.expired++;
          break;
        case StrategySignalState.INVALIDATED:
        case StrategySignalState.SUPERSEDED:
          stats.invalidated++;
          break;
      }

      byStrategy.set(strategyId, stats);
    }

    return {
      totalRegistered: this.statistics.totalRegistered,
      currentlyValid: this.getValidSignals(currentTime).length,
      totalExpired: this.statistics.totalExpired,
      totalInvalidated: this.statistics.totalInvalidated + this.statistics.totalSuperseded,
      totalSuperseded: this.statistics.totalSuperseded,
      byStrategy
    };
  }

  /**
   * Get the count of valid signals
   * 
   * @param currentTime - Explicit current timestamp
   * @returns Number of valid signals
   */
  public getValidSignalCount(currentTime: number): number {
    return this.getValidSignals(currentTime).length;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Validate a signal before registration
   */
  private validateSignal(signal: StrategySignal): void {
    if (!signal.id) {
      throw new Error('Signal must have an ID');
    }
    if (!signal.strategyId) {
      throw new Error('Signal must have a strategyId');
    }
    if (typeof signal.timestamp !== 'number' || signal.timestamp <= 0) {
      throw new Error('Signal must have a valid timestamp');
    }
    if (typeof signal.validUntil !== 'number' || signal.validUntil <= signal.timestamp) {
      throw new Error('Signal must have a valid validUntil timestamp greater than timestamp');
    }
    if (typeof signal.confidence !== 'number' || signal.confidence < 0 || signal.confidence > 1) {
      throw new Error('Signal confidence must be between 0 and 1');
    }
  }

  /**
   * Check if two signals are equivalent (for deduplication)
   */
  private areSignalsEquivalent(a: StrategySignal, b: StrategySignal): boolean {
    return (
      a.strategyId === b.strategyId &&
      a.direction === b.direction &&
      a.action === b.action &&
      Math.abs(a.confidence - b.confidence) < 0.01 &&
      Math.abs(a.suggestedSize - b.suggestedSize) < 0.01
    );
  }

  /**
   * Find the latest signal from a strategy
   */
  private findLatestSignalByStrategy(strategyId: string): StrategySignal | null {
    let latest: StrategySignal | null = null;

    for (const metadata of this.signals.values()) {
      if (metadata.signal.strategyId === strategyId) {
        if (!latest || metadata.signal.timestamp > latest.timestamp) {
          latest = metadata.signal;
        }
      }
    }

    return latest;
  }

  /**
   * Enforce maximum signals per strategy limit
   */
  private enforceMaxSignalsPerStrategy(strategyId: string): void {
    const strategySignals: Array<{ id: string; timestamp: number }> = [];

    for (const [id, metadata] of this.signals) {
      if (metadata.signal.strategyId === strategyId) {
        strategySignals.push({ id, timestamp: metadata.signal.timestamp });
      }
    }

    // Sort by timestamp (oldest first)
    strategySignals.sort((a, b) => a.timestamp - b.timestamp);

    // Remove oldest if over limit
    while (strategySignals.length >= this.config.maxSignalsPerStrategy) {
      const oldest = strategySignals.shift();
      if (oldest) {
        this.signals.delete(oldest.id);
      }
    }
  }

  /**
   * Internal method to expire a signal
   */
  private expireSignalInternal(metadata: SignalMetadata, currentTime: number): void {
    metadata.signal.state = StrategySignalState.EXPIRED;
    metadata.expiredAt = currentTime;
    this.statistics.totalExpired++;
  }
}

/**
 * Factory function to create a SignalLifecycleManager
 */
export function createSignalLifecycleManager(
  config?: Partial<SignalLifecycleConfig>
): SignalLifecycleManager {
  return new SignalLifecycleManager(config);
}
