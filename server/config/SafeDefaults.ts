/**
 * Safe Default Values for Trading Bot Configuration
 * 
 * This file contains safe, conservative default values for all configuration
 * parameters. These defaults are designed to prevent dangerous misconfigurations
 * and ensure the system operates safely even without explicit configuration.
 * 
 * CRITICAL: All values are deterministic - no randomness, no AI/ML components.
 * 
 * @module SafeDefaults
 */

import type { SafeDefaultsType, AppConfig, PartialConfig } from './types';

// ============================================================================
// Core Safe Defaults
// ============================================================================

/**
 * Safe default values for all configuration parameters.
 * These values are conservative and prioritize safety over performance.
 * 
 * RATIONALE:
 * - latencyThreshold (500ms): Allows for network variability while detecting issues
 * - flashCrashThreshold (5%): Catches significant price drops without false positives
 * - maxDrawdown (10%): Limits losses to manageable levels
 * - quorumSize (3): Minimum for consensus in distributed systems
 * - confidenceThreshold (0.7): Requires strong confidence before acting
 * - memoryThreshold (80%): Prevents OOM crashes with headroom
 * - wsTimeout (30000ms): Reasonable for WebSocket connections
 * - paperTrading (true): SAFETY CRITICAL - Never trade real money by default
 */
export const SAFE_DEFAULTS: SafeDefaultsType = {
  // Trading defaults - CONSERVATIVE
  latencyThreshold: 500,           // 500ms max latency
  flashCrashThreshold: 5,          // 5% price drop threshold
  maxDrawdown: 10,                 // 10% max drawdown before halt
  quorumSize: 3,                   // Minimum 3 consensus
  confidenceThreshold: 0.7,        // 70% confidence required
  maxPositionSize: 20,             // 20% of portfolio max per position
  stopLossPercent: 2,              // 2% stop loss
  takeProfitPercent: 5,            // 5% take profit
  maxConcurrentTrades: 5,          // Max 5 concurrent trades
  tradingEnabled: false,           // SAFETY: Trading disabled by default
  paperTrading: true,              // SAFETY: Paper trading by default

  // System defaults
  memoryThreshold: 80,             // 80% memory limit
  wsTimeout: 30000,                // 30 seconds WebSocket timeout
  healthCheckInterval: 15000,      // 15 seconds health checks
  gracefulShutdownTimeout: 30000,  // 30 seconds graceful shutdown
  logLevel: 'info',                // Info level logging
  maxLogFileSize: 100,             // 100MB log files
  logFileCount: 5,                 // Keep 5 log files
  port: 3000,                      // Default HTTP port
  enableMetrics: true,             // Enable metrics endpoint

  // Risk management defaults
  dailyLossLimit: 5,               // 5% daily loss limit
  maxTradesPerDay: 50,             // Max 50 trades per day
  cooldownAfterLoss: 60000,        // 60 seconds cooldown after loss
  confirmLargeTrades: true,        // Confirm large trades
  largeTradeThreshold: 10000,      // $10,000 is a large trade
  circuitBreakerEnabled: true,     // Enable circuit breaker
  circuitBreakerThreshold: 3,      // 3 consecutive losses triggers CB

  // Exchange defaults
  testnet: true,                   // SAFETY: Use testnet by default
  rateLimit: 10,                   // 10 requests per second
  enableRateLimit: true,           // Enable rate limiting
} as const;

// ============================================================================
// Default Configuration Objects
// ============================================================================

/**
 * Complete default trading configuration
 */
export const DEFAULT_TRADING_CONFIG = {
  latencyThreshold: SAFE_DEFAULTS.latencyThreshold,
  flashCrashThreshold: SAFE_DEFAULTS.flashCrashThreshold,
  maxDrawdown: SAFE_DEFAULTS.maxDrawdown,
  quorumSize: SAFE_DEFAULTS.quorumSize,
  confidenceThreshold: SAFE_DEFAULTS.confidenceThreshold,
  maxPositionSize: SAFE_DEFAULTS.maxPositionSize,
  stopLossPercent: SAFE_DEFAULTS.stopLossPercent,
  takeProfitPercent: SAFE_DEFAULTS.takeProfitPercent,
  maxConcurrentTrades: SAFE_DEFAULTS.maxConcurrentTrades,
  tradingEnabled: SAFE_DEFAULTS.tradingEnabled,
  paperTrading: SAFE_DEFAULTS.paperTrading,
} as const;

/**
 * Complete default system configuration
 */
export const DEFAULT_SYSTEM_CONFIG = {
  memoryThreshold: SAFE_DEFAULTS.memoryThreshold,
  wsTimeout: SAFE_DEFAULTS.wsTimeout,
  healthCheckInterval: SAFE_DEFAULTS.healthCheckInterval,
  gracefulShutdownTimeout: SAFE_DEFAULTS.gracefulShutdownTimeout,
  logLevel: SAFE_DEFAULTS.logLevel,
  maxLogFileSize: SAFE_DEFAULTS.maxLogFileSize,
  logFileCount: SAFE_DEFAULTS.logFileCount,
  nodeEnv: 'development' as const,
  port: SAFE_DEFAULTS.port,
  enableMetrics: SAFE_DEFAULTS.enableMetrics,
} as const;

/**
 * Complete default exchange configuration
 * NOTE: apiKey and apiSecret must be provided via environment variables
 */
export const DEFAULT_EXCHANGE_CONFIG = {
  exchangeId: 'binance',
  apiKey: '',                      // Must be set via env var
  apiSecret: '',                   // Must be set via env var
  testnet: SAFE_DEFAULTS.testnet,
  rateLimit: SAFE_DEFAULTS.rateLimit,
  enableRateLimit: SAFE_DEFAULTS.enableRateLimit,
} as const;

/**
 * Complete default risk configuration
 */
export const DEFAULT_RISK_CONFIG = {
  dailyLossLimit: SAFE_DEFAULTS.dailyLossLimit,
  maxTradesPerDay: SAFE_DEFAULTS.maxTradesPerDay,
  cooldownAfterLoss: SAFE_DEFAULTS.cooldownAfterLoss,
  confirmLargeTrades: SAFE_DEFAULTS.confirmLargeTrades,
  largeTradeThreshold: SAFE_DEFAULTS.largeTradeThreshold,
  circuitBreakerEnabled: SAFE_DEFAULTS.circuitBreakerEnabled,
  circuitBreakerThreshold: SAFE_DEFAULTS.circuitBreakerThreshold,
} as const;

/**
 * Complete default application configuration
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  trading: { ...DEFAULT_TRADING_CONFIG },
  system: { ...DEFAULT_SYSTEM_CONFIG },
  exchange: { ...DEFAULT_EXCHANGE_CONFIG },
  risk: { ...DEFAULT_RISK_CONFIG },
} as const;

// ============================================================================
// Dangerous Value Detection
// ============================================================================

/**
 * Values that are considered dangerous and should trigger warnings
 */
export const DANGEROUS_VALUES = {
  trading: {
    // Trading enabled without paper trading is dangerous
    tradingEnabled: {
      condition: (v: boolean, config: PartialConfig) => 
        v === true && config.trading?.paperTrading === false,
      message: 'LIVE TRADING ENABLED: Real money at risk!',
      severity: 'CRITICAL',
    },
    // Very high drawdown limit
    maxDrawdown: {
      condition: (v: number) => v > 25,
      message: 'Max drawdown > 25% - excessive risk!',
      severity: 'HIGH',
    },
    // Very low confidence threshold
    confidenceThreshold: {
      condition: (v: number) => v < 0.5,
      message: 'Confidence threshold < 50% - may cause over-trading!',
      severity: 'HIGH',
    },
    // Very large position size
    maxPositionSize: {
      condition: (v: number) => v > 50,
      message: 'Max position size > 50% - excessive concentration risk!',
      severity: 'HIGH',
    },
  },
  system: {
    // Very high memory threshold
    memoryThreshold: {
      condition: (v: number) => v > 95,
      message: 'Memory threshold > 95% - risk of OOM crash!',
      severity: 'HIGH',
    },
    // Debug logging in production
    logLevel: {
      condition: (v: string, config: PartialConfig) => 
        v === 'debug' && config.system?.nodeEnv === 'production',
      message: 'Debug logging in production - performance impact!',
      severity: 'MEDIUM',
    },
  },
  exchange: {
    // Testnet disabled without explicit confirmation
    testnet: {
      condition: (v: boolean) => v === false,
      message: 'LIVE exchange mode - real trades will be executed!',
      severity: 'CRITICAL',
    },
  },
  risk: {
    // Circuit breaker disabled
    circuitBreakerEnabled: {
      condition: (v: boolean) => v === false,
      message: 'Circuit breaker disabled - no protection from runaway losses!',
      severity: 'HIGH',
    },
    // Very high daily loss limit
    dailyLossLimit: {
      condition: (v: number) => v > 20,
      message: 'Daily loss limit > 20% - excessive risk!',
      severity: 'HIGH',
    },
  },
} as const;

// ============================================================================
// Value Constraints
// ============================================================================

/**
 * Valid ranges for numeric configuration values
 * Used for validation and clamping
 */
export const VALUE_CONSTRAINTS = {
  latencyThreshold: { min: 100, max: 5000 },
  flashCrashThreshold: { min: 1, max: 50 },
  maxDrawdown: { min: 1, max: 100 },
  quorumSize: { min: 1, max: 10 },
  confidenceThreshold: { min: 0.1, max: 1.0 },
  maxPositionSize: { min: 1, max: 100 },
  stopLossPercent: { min: 0.1, max: 50 },
  takeProfitPercent: { min: 0.1, max: 100 },
  maxConcurrentTrades: { min: 1, max: 100 },
  memoryThreshold: { min: 50, max: 99 },
  wsTimeout: { min: 5000, max: 300000 },
  healthCheckInterval: { min: 5000, max: 300000 },
  gracefulShutdownTimeout: { min: 1000, max: 60000 },
  maxLogFileSize: { min: 10, max: 1000 },
  logFileCount: { min: 1, max: 20 },
  port: { min: 1, max: 65535 },
  dailyLossLimit: { min: 0.1, max: 100 },
  maxTradesPerDay: { min: 1, max: 1000 },
  cooldownAfterLoss: { min: 0, max: 3600000 },
  largeTradeThreshold: { min: 100, max: 1000000 },
  circuitBreakerThreshold: { min: 1, max: 20 },
  rateLimit: { min: 1, max: 100 },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the safe default value for a specific field
 * @param field - Field name in dot notation (e.g., 'trading.latencyThreshold')
 * @returns The safe default value or undefined
 */
export function getSafeDefault(field: string): unknown {
  const parts = field.split('.');
  let current: Record<string, unknown> = SAFE_DEFAULTS as Record<string, unknown>;
  
  for (const part of parts) {
    if (current[part] === undefined) {
      return undefined;
    }
    current = current[part] as Record<string, unknown>;
  }
  
  return current;
}

/**
 * Check if a value is within safe constraints
 * @param field - Field name
 * @param value - Value to check
 * @returns True if value is within constraints
 */
export function isWithinConstraints(field: keyof typeof VALUE_CONSTRAINTS, value: number): boolean {
  const constraint = VALUE_CONSTRAINTS[field];
  if (!constraint) {
    return true; // No constraints defined
  }
  return value >= constraint.min && value <= constraint.max;
}

/**
 * Clamp a value to safe constraints
 * @param field - Field name
 * @param value - Value to clamp
 * @returns Clamped value
 */
export function clampToConstraints(field: keyof typeof VALUE_CONSTRAINTS, value: number): number {
  const constraint = VALUE_CONSTRAINTS[field];
  if (!constraint) {
    return value;
  }
  return Math.max(constraint.min, Math.min(constraint.max, value));
}

/**
 * Merge partial configuration with safe defaults
 * @param partial - Partial configuration
 * @returns Complete configuration with defaults applied
 */
export function mergeWithDefaults(partial: PartialConfig = {}): AppConfig {
  return {
    trading: {
      ...DEFAULT_TRADING_CONFIG,
      ...partial.trading,
    },
    system: {
      ...DEFAULT_SYSTEM_CONFIG,
      ...partial.system,
    },
    exchange: {
      ...DEFAULT_EXCHANGE_CONFIG,
      ...partial.exchange,
    },
    risk: {
      ...DEFAULT_RISK_CONFIG,
      ...partial.risk,
    },
  };
}

/**
 * Create a safe configuration from environment variables
 * Applies safe defaults for any missing values
 * @param env - Environment variables object
 * @returns Safe configuration
 */
export function createSafeConfig(env: Record<string, string | undefined> = {}): AppConfig {
  const partial: PartialConfig = {
    trading: {
      latencyThreshold: env.LATENCY_THRESHOLD ? parseInt(env.LATENCY_THRESHOLD, 10) : undefined,
      flashCrashThreshold: env.FLASH_CRASH_THRESHOLD ? parseFloat(env.FLASH_CRASH_THRESHOLD) : undefined,
      maxDrawdown: env.MAX_DRAWDOWN ? parseFloat(env.MAX_DRAWDOWN) : undefined,
      quorumSize: env.QUORUM_SIZE ? parseInt(env.QUORUM_SIZE, 10) : undefined,
      confidenceThreshold: env.CONFIDENCE_THRESHOLD ? parseFloat(env.CONFIDENCE_THRESHOLD) : undefined,
      maxPositionSize: env.MAX_POSITION_SIZE ? parseFloat(env.MAX_POSITION_SIZE) : undefined,
      stopLossPercent: env.STOP_LOSS_PERCENT ? parseFloat(env.STOP_LOSS_PERCENT) : undefined,
      takeProfitPercent: env.TAKE_PROFIT_PERCENT ? parseFloat(env.TAKE_PROFIT_PERCENT) : undefined,
      maxConcurrentTrades: env.MAX_CONCURRENT_TRADES ? parseInt(env.MAX_CONCURRENT_TRADES, 10) : undefined,
      tradingEnabled: env.TRADING_ENABLED ? env.TRADING_ENABLED === 'true' : undefined,
      paperTrading: env.PAPER_TRADING ? env.PAPER_TRADING !== 'false' : undefined,
    },
    system: {
      memoryThreshold: env.MEMORY_THRESHOLD ? parseInt(env.MEMORY_THRESHOLD, 10) : undefined,
      wsTimeout: env.WS_TIMEOUT ? parseInt(env.WS_TIMEOUT, 10) : undefined,
      healthCheckInterval: env.HEALTH_CHECK_INTERVAL ? parseInt(env.HEALTH_CHECK_INTERVAL, 10) : undefined,
      gracefulShutdownTimeout: env.GRACEFUL_SHUTDOWN_TIMEOUT ? parseInt(env.GRACEFUL_SHUTDOWN_TIMEOUT, 10) : undefined,
      logLevel: (env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || undefined,
      maxLogFileSize: env.MAX_LOG_FILE_SIZE ? parseInt(env.MAX_LOG_FILE_SIZE, 10) : undefined,
      logFileCount: env.LOG_FILE_COUNT ? parseInt(env.LOG_FILE_COUNT, 10) : undefined,
      nodeEnv: (env.NODE_ENV as 'development' | 'production' | 'test') || undefined,
      port: env.PORT ? parseInt(env.PORT, 10) : undefined,
      enableMetrics: env.ENABLE_METRICS ? env.ENABLE_METRICS === 'true' : undefined,
    },
    exchange: {
      exchangeId: env.EXCHANGE_ID || undefined,
      apiKey: env.EXCHANGE_API_KEY || '',
      apiSecret: env.EXCHANGE_API_SECRET || '',
      testnet: env.EXCHANGE_TESTNET ? env.EXCHANGE_TESTNET !== 'false' : undefined,
      rateLimit: env.EXCHANGE_RATE_LIMIT ? parseInt(env.EXCHANGE_RATE_LIMIT, 10) : undefined,
      enableRateLimit: env.EXCHANGE_ENABLE_RATE_LIMIT ? env.EXCHANGE_ENABLE_RATE_LIMIT !== 'false' : undefined,
    },
    risk: {
      dailyLossLimit: env.DAILY_LOSS_LIMIT ? parseFloat(env.DAILY_LOSS_LIMIT) : undefined,
      maxTradesPerDay: env.MAX_TRADES_PER_DAY ? parseInt(env.MAX_TRADES_PER_DAY, 10) : undefined,
      cooldownAfterLoss: env.COOLDOWN_AFTER_LOSS ? parseInt(env.COOLDOWN_AFTER_LOSS, 10) : undefined,
      confirmLargeTrades: env.CONFIRM_LARGE_TRADES ? env.CONFIRM_LARGE_TRADES !== 'false' : undefined,
      largeTradeThreshold: env.LARGE_TRADE_THRESHOLD ? parseFloat(env.LARGE_TRADE_THRESHOLD) : undefined,
      circuitBreakerEnabled: env.CIRCUIT_BREAKER_ENABLED ? env.CIRCUIT_BREAKER_ENABLED !== 'false' : undefined,
      circuitBreakerThreshold: env.CIRCUIT_BREAKER_THRESHOLD ? parseInt(env.CIRCUIT_BREAKER_THRESHOLD, 10) : undefined,
    },
  };

  return mergeWithDefaults(partial);
}
