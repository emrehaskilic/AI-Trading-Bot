/**
 * Configuration Schema Definitions
 * 
 * This file contains Zod schemas for type-safe configuration validation.
 * All schemas are deterministic with no randomness or AI/ML components.
 * 
 * @module ConfigSchema
 */

import { z } from 'zod';
import { 
  SAFE_DEFAULTS, 
  VALUE_CONSTRAINTS, 
  DEFAULT_TRADING_CONFIG,
  DEFAULT_SYSTEM_CONFIG,
  DEFAULT_EXCHANGE_CONFIG,
  DEFAULT_RISK_CONFIG,
} from './SafeDefaults';

// ============================================================================
// Custom Validators
// ============================================================================

/**
 * Custom error messages for better developer experience
 */
const errorMessages = {
  required: (field: string) => `${field} is required`,
  number: {
    base: (field: string) => `${field} must be a valid number`,
    min: (field: string, min: number) => `${field} must be at least ${min}`,
    max: (field: string, max: number) => `${field} must be at most ${max}`,
    int: (field: string) => `${field} must be an integer`,
    positive: (field: string) => `${field} must be positive`,
  },
  string: {
    base: (field: string) => `${field} must be a string`,
    min: (field: string, min: number) => `${field} must be at least ${min} characters`,
    max: (field: string, max: number) => `${field} must be at most ${max} characters`,
    email: (field: string) => `${field} must be a valid email`,
    url: (field: string) => `${field} must be a valid URL`,
  },
  boolean: {
    base: (field: string) => `${field} must be a boolean`,
  },
  enum: (field: string, values: string[]) => 
    `${field} must be one of: ${values.join(', ')}`,
};

// ============================================================================
// Trading Configuration Schema
// ============================================================================

/**
 * Schema for trading configuration
 * Validates all trading-related parameters
 */
export const TradingConfigSchema = z.object({
  latencyThreshold: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.latencyThreshold.min,
      errorMessages.number.min('latencyThreshold', VALUE_CONSTRAINTS.latencyThreshold.min)
    )
    .max(
      VALUE_CONSTRAINTS.latencyThreshold.max,
      errorMessages.number.max('latencyThreshold', VALUE_CONSTRAINTS.latencyThreshold.max)
    )
    .default(DEFAULT_TRADING_CONFIG.latencyThreshold)
    .describe('Maximum acceptable latency in milliseconds'),

  flashCrashThreshold: z.number()
    .min(
      VALUE_CONSTRAINTS.flashCrashThreshold.min,
      errorMessages.number.min('flashCrashThreshold', VALUE_CONSTRAINTS.flashCrashThreshold.min)
    )
    .max(
      VALUE_CONSTRAINTS.flashCrashThreshold.max,
      errorMessages.number.max('flashCrashThreshold', VALUE_CONSTRAINTS.flashCrashThreshold.max)
    )
    .default(DEFAULT_TRADING_CONFIG.flashCrashThreshold)
    .describe('Flash crash detection threshold as percentage'),

  maxDrawdown: z.number()
    .min(
      VALUE_CONSTRAINTS.maxDrawdown.min,
      errorMessages.number.min('maxDrawdown', VALUE_CONSTRAINTS.maxDrawdown.min)
    )
    .max(
      VALUE_CONSTRAINTS.maxDrawdown.max,
      errorMessages.number.max('maxDrawdown', VALUE_CONSTRAINTS.maxDrawdown.max)
    )
    .default(DEFAULT_TRADING_CONFIG.maxDrawdown)
    .describe('Maximum drawdown percentage before halt'),

  quorumSize: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.quorumSize.min,
      errorMessages.number.min('quorumSize', VALUE_CONSTRAINTS.quorumSize.min)
    )
    .max(
      VALUE_CONSTRAINTS.quorumSize.max,
      errorMessages.number.max('quorumSize', VALUE_CONSTRAINTS.quorumSize.max)
    )
    .default(DEFAULT_TRADING_CONFIG.quorumSize)
    .describe('Minimum consensus size for multi-source validation'),

  confidenceThreshold: z.number()
    .min(
      VALUE_CONSTRAINTS.confidenceThreshold.min,
      errorMessages.number.min('confidenceThreshold', VALUE_CONSTRAINTS.confidenceThreshold.min)
    )
    .max(
      VALUE_CONSTRAINTS.confidenceThreshold.max,
      errorMessages.number.max('confidenceThreshold', VALUE_CONSTRAINTS.confidenceThreshold.max)
    )
    .default(DEFAULT_TRADING_CONFIG.confidenceThreshold)
    .describe('Minimum confidence threshold (0-1)'),

  maxPositionSize: z.number()
    .min(
      VALUE_CONSTRAINTS.maxPositionSize.min,
      errorMessages.number.min('maxPositionSize', VALUE_CONSTRAINTS.maxPositionSize.min)
    )
    .max(
      VALUE_CONSTRAINTS.maxPositionSize.max,
      errorMessages.number.max('maxPositionSize', VALUE_CONSTRAINTS.maxPositionSize.max)
    )
    .default(DEFAULT_TRADING_CONFIG.maxPositionSize)
    .describe('Maximum position size as percentage of portfolio'),

  stopLossPercent: z.number()
    .min(
      VALUE_CONSTRAINTS.stopLossPercent.min,
      errorMessages.number.min('stopLossPercent', VALUE_CONSTRAINTS.stopLossPercent.min)
    )
    .max(
      VALUE_CONSTRAINTS.stopLossPercent.max,
      errorMessages.number.max('stopLossPercent', VALUE_CONSTRAINTS.stopLossPercent.max)
    )
    .default(DEFAULT_TRADING_CONFIG.stopLossPercent)
    .describe('Stop loss percentage'),

  takeProfitPercent: z.number()
    .min(
      VALUE_CONSTRAINTS.takeProfitPercent.min,
      errorMessages.number.min('takeProfitPercent', VALUE_CONSTRAINTS.takeProfitPercent.min)
    )
    .max(
      VALUE_CONSTRAINTS.takeProfitPercent.max,
      errorMessages.number.max('takeProfitPercent', VALUE_CONSTRAINTS.takeProfitPercent.max)
    )
    .default(DEFAULT_TRADING_CONFIG.takeProfitPercent)
    .describe('Take profit percentage'),

  maxConcurrentTrades: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.maxConcurrentTrades.min,
      errorMessages.number.min('maxConcurrentTrades', VALUE_CONSTRAINTS.maxConcurrentTrades.min)
    )
    .max(
      VALUE_CONSTRAINTS.maxConcurrentTrades.max,
      errorMessages.number.max('maxConcurrentTrades', VALUE_CONSTRAINTS.maxConcurrentTrades.max)
    )
    .default(DEFAULT_TRADING_CONFIG.maxConcurrentTrades)
    .describe('Maximum number of concurrent trades'),

  tradingEnabled: z.boolean()
    .default(DEFAULT_TRADING_CONFIG.tradingEnabled)
    .describe('Whether trading is enabled'),

  paperTrading: z.boolean()
    .default(DEFAULT_TRADING_CONFIG.paperTrading)
    .describe('Whether to use paper trading mode'),
});

// ============================================================================
// System Configuration Schema
// ============================================================================

/**
 * Schema for system configuration
 * Validates all system-level parameters
 */
export const SystemConfigSchema = z.object({
  memoryThreshold: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.memoryThreshold.min,
      errorMessages.number.min('memoryThreshold', VALUE_CONSTRAINTS.memoryThreshold.min)
    )
    .max(
      VALUE_CONSTRAINTS.memoryThreshold.max,
      errorMessages.number.max('memoryThreshold', VALUE_CONSTRAINTS.memoryThreshold.max)
    )
    .default(DEFAULT_SYSTEM_CONFIG.memoryThreshold)
    .describe('Memory usage threshold percentage (0-100)'),

  wsTimeout: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.wsTimeout.min,
      errorMessages.number.min('wsTimeout', VALUE_CONSTRAINTS.wsTimeout.min)
    )
    .max(
      VALUE_CONSTRAINTS.wsTimeout.max,
      errorMessages.number.max('wsTimeout', VALUE_CONSTRAINTS.wsTimeout.max)
    )
    .default(DEFAULT_SYSTEM_CONFIG.wsTimeout)
    .describe('WebSocket timeout in milliseconds'),

  healthCheckInterval: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.healthCheckInterval.min,
      errorMessages.number.min('healthCheckInterval', VALUE_CONSTRAINTS.healthCheckInterval.min)
    )
    .max(
      VALUE_CONSTRAINTS.healthCheckInterval.max,
      errorMessages.number.max('healthCheckInterval', VALUE_CONSTRAINTS.healthCheckInterval.max)
    )
    .default(DEFAULT_SYSTEM_CONFIG.healthCheckInterval)
    .describe('Health check interval in milliseconds'),

  gracefulShutdownTimeout: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.gracefulShutdownTimeout.min,
      errorMessages.number.min('gracefulShutdownTimeout', VALUE_CONSTRAINTS.gracefulShutdownTimeout.min)
    )
    .max(
      VALUE_CONSTRAINTS.gracefulShutdownTimeout.max,
      errorMessages.number.max('gracefulShutdownTimeout', VALUE_CONSTRAINTS.gracefulShutdownTimeout.max)
    )
    .default(DEFAULT_SYSTEM_CONFIG.gracefulShutdownTimeout)
    .describe('Graceful shutdown timeout in milliseconds'),

  logLevel: z.enum(['debug', 'info', 'warn', 'error'])
    .default(DEFAULT_SYSTEM_CONFIG.logLevel)
    .describe('Log level'),

  maxLogFileSize: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.maxLogFileSize.min,
      errorMessages.number.min('maxLogFileSize', VALUE_CONSTRAINTS.maxLogFileSize.min)
    )
    .max(
      VALUE_CONSTRAINTS.maxLogFileSize.max,
      errorMessages.number.max('maxLogFileSize', VALUE_CONSTRAINTS.maxLogFileSize.max)
    )
    .default(DEFAULT_SYSTEM_CONFIG.maxLogFileSize)
    .describe('Maximum log file size in MB'),

  logFileCount: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.logFileCount.min,
      errorMessages.number.min('logFileCount', VALUE_CONSTRAINTS.logFileCount.min)
    )
    .max(
      VALUE_CONSTRAINTS.logFileCount.max,
      errorMessages.number.max('logFileCount', VALUE_CONSTRAINTS.logFileCount.max)
    )
    .default(DEFAULT_SYSTEM_CONFIG.logFileCount)
    .describe('Number of log files to keep'),

  nodeEnv: z.enum(['development', 'production', 'test'])
    .default(DEFAULT_SYSTEM_CONFIG.nodeEnv)
    .describe('Node environment'),

  port: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.port.min,
      errorMessages.number.min('port', VALUE_CONSTRAINTS.port.min)
    )
    .max(
      VALUE_CONSTRAINTS.port.max,
      errorMessages.number.max('port', VALUE_CONSTRAINTS.port.max)
    )
    .default(DEFAULT_SYSTEM_CONFIG.port)
    .describe('Port for HTTP server'),

  enableMetrics: z.boolean()
    .default(DEFAULT_SYSTEM_CONFIG.enableMetrics)
    .describe('Enable metrics endpoint'),
});

// ============================================================================
// Exchange Configuration Schema
// ============================================================================

/**
 * Schema for exchange configuration
 * Validates exchange connection parameters
 */
export const ExchangeConfigSchema = z.object({
  exchangeId: z.string()
    .min(1, errorMessages.string.min('exchangeId', 1))
    .max(50, errorMessages.string.max('exchangeId', 50))
    .default(DEFAULT_EXCHANGE_CONFIG.exchangeId)
    .describe('Exchange identifier'),

  apiKey: z.string()
    .min(0)
    .max(500, errorMessages.string.max('apiKey', 500))
    .default(DEFAULT_EXCHANGE_CONFIG.apiKey)
    .describe('API key for exchange'),

  apiSecret: z.string()
    .min(0)
    .max(500, errorMessages.string.max('apiSecret', 500))
    .default(DEFAULT_EXCHANGE_CONFIG.apiSecret)
    .describe('API secret for exchange'),

  testnet: z.boolean()
    .default(DEFAULT_EXCHANGE_CONFIG.testnet)
    .describe('Testnet mode'),

  rateLimit: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.rateLimit.min,
      errorMessages.number.min('rateLimit', VALUE_CONSTRAINTS.rateLimit.min)
    )
    .max(
      VALUE_CONSTRAINTS.rateLimit.max,
      errorMessages.number.max('rateLimit', VALUE_CONSTRAINTS.rateLimit.max)
    )
    .default(DEFAULT_EXCHANGE_CONFIG.rateLimit)
    .describe('Rate limit requests per second'),

  enableRateLimit: z.boolean()
    .default(DEFAULT_EXCHANGE_CONFIG.enableRateLimit)
    .describe('Enable rate limiting'),
});

// ============================================================================
// Risk Configuration Schema
// ============================================================================

/**
 * Schema for risk management configuration
 * Validates risk management parameters
 */
export const RiskConfigSchema = z.object({
  dailyLossLimit: z.number()
    .min(
      VALUE_CONSTRAINTS.dailyLossLimit.min,
      errorMessages.number.min('dailyLossLimit', VALUE_CONSTRAINTS.dailyLossLimit.min)
    )
    .max(
      VALUE_CONSTRAINTS.dailyLossLimit.max,
      errorMessages.number.max('dailyLossLimit', VALUE_CONSTRAINTS.dailyLossLimit.max)
    )
    .default(DEFAULT_RISK_CONFIG.dailyLossLimit)
    .describe('Daily loss limit as percentage'),

  maxTradesPerDay: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.maxTradesPerDay.min,
      errorMessages.number.min('maxTradesPerDay', VALUE_CONSTRAINTS.maxTradesPerDay.min)
    )
    .max(
      VALUE_CONSTRAINTS.maxTradesPerDay.max,
      errorMessages.number.max('maxTradesPerDay', VALUE_CONSTRAINTS.maxTradesPerDay.max)
    )
    .default(DEFAULT_RISK_CONFIG.maxTradesPerDay)
    .describe('Maximum trades per day'),

  cooldownAfterLoss: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.cooldownAfterLoss.min,
      errorMessages.number.min('cooldownAfterLoss', VALUE_CONSTRAINTS.cooldownAfterLoss.min)
    )
    .max(
      VALUE_CONSTRAINTS.cooldownAfterLoss.max,
      errorMessages.number.max('cooldownAfterLoss', VALUE_CONSTRAINTS.cooldownAfterLoss.max)
    )
    .default(DEFAULT_RISK_CONFIG.cooldownAfterLoss)
    .describe('Cooldown period after loss in milliseconds'),

  confirmLargeTrades: z.boolean()
    .default(DEFAULT_RISK_CONFIG.confirmLargeTrades)
    .describe('Require confirmation for large trades'),

  largeTradeThreshold: z.number()
    .min(
      VALUE_CONSTRAINTS.largeTradeThreshold.min,
      errorMessages.number.min('largeTradeThreshold', VALUE_CONSTRAINTS.largeTradeThreshold.min)
    )
    .max(
      VALUE_CONSTRAINTS.largeTradeThreshold.max,
      errorMessages.number.max('largeTradeThreshold', VALUE_CONSTRAINTS.largeTradeThreshold.max)
    )
    .default(DEFAULT_RISK_CONFIG.largeTradeThreshold)
    .describe('Large trade threshold in USD'),

  circuitBreakerEnabled: z.boolean()
    .default(DEFAULT_RISK_CONFIG.circuitBreakerEnabled)
    .describe('Enable circuit breaker'),

  circuitBreakerThreshold: z.number()
    .int()
    .min(
      VALUE_CONSTRAINTS.circuitBreakerThreshold.min,
      errorMessages.number.min('circuitBreakerThreshold', VALUE_CONSTRAINTS.circuitBreakerThreshold.min)
    )
    .max(
      VALUE_CONSTRAINTS.circuitBreakerThreshold.max,
      errorMessages.number.max('circuitBreakerThreshold', VALUE_CONSTRAINTS.circuitBreakerThreshold.max)
    )
    .default(DEFAULT_RISK_CONFIG.circuitBreakerThreshold)
    .describe('Circuit breaker threshold - consecutive losses'),
});

// ============================================================================
// Complete Application Configuration Schema
// ============================================================================

/**
 * Complete application configuration schema
 * Combines all configuration sections
 */
export const AppConfigSchema = z.object({
  trading: TradingConfigSchema,
  system: SystemConfigSchema,
  exchange: ExchangeConfigSchema,
  risk: RiskConfigSchema,
});

// ============================================================================
// Type Inference
// ============================================================================

/** Inferred type for trading configuration */
export type TradingConfig = z.infer<typeof TradingConfigSchema>;

/** Inferred type for system configuration */
export type SystemConfig = z.infer<typeof SystemConfigSchema>;

/** Inferred type for exchange configuration */
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;

/** Inferred type for risk configuration */
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

/** Inferred type for complete application configuration */
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ============================================================================
// Environment Variable Parsing Schemas
// ============================================================================

/**
 * Schema for parsing environment variables
 * Handles string to type conversion
 */
export const EnvVarSchemas = {
  number: (field: string) => z.string()
    .transform((val: string) => {
      const parsed = parseFloat(val);
      if (isNaN(parsed)) {
        throw new Error(`${field} must be a valid number, got: ${val}`);
      }
      return parsed;
    }),

  int: (field: string) => z.string()
    .transform((val: string) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed)) {
        throw new Error(`${field} must be a valid integer, got: ${val}`);
      }
      return parsed;
    }),

  boolean: (field: string) => z.string()
    .transform((val: string) => {
      const lower = val.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        return true;
      }
      if (lower === 'false' || lower === '0' || lower === 'no') {
        return false;
      }
      throw new Error(`${field} must be a boolean (true/false), got: ${val}`);
    }),

  string: () => z.string(),

  enum: <T extends string>(field: string, values: T[]) => z.string()
    .transform((val: string) => {
      if (!values.includes(val as T)) {
        throw new Error(
          `${field} must be one of: ${values.join(', ')}, got: ${val}`
        );
      }
      return val as T;
    }),
};

// ============================================================================
// Environment Variable Mapping
// ============================================================================

/**
 * Maps environment variable names to config paths
 */
export const ENV_VAR_MAPPING = {
  // Trading
  LATENCY_THRESHOLD: { path: 'trading.latencyThreshold', type: 'int' as const },
  FLASH_CRASH_THRESHOLD: { path: 'trading.flashCrashThreshold', type: 'number' as const },
  MAX_DRAWDOWN: { path: 'trading.maxDrawdown', type: 'number' as const },
  QUORUM_SIZE: { path: 'trading.quorumSize', type: 'int' as const },
  CONFIDENCE_THRESHOLD: { path: 'trading.confidenceThreshold', type: 'number' as const },
  MAX_POSITION_SIZE: { path: 'trading.maxPositionSize', type: 'number' as const },
  STOP_LOSS_PERCENT: { path: 'trading.stopLossPercent', type: 'number' as const },
  TAKE_PROFIT_PERCENT: { path: 'trading.takeProfitPercent', type: 'number' as const },
  MAX_CONCURRENT_TRADES: { path: 'trading.maxConcurrentTrades', type: 'int' as const },
  TRADING_ENABLED: { path: 'trading.tradingEnabled', type: 'boolean' as const },
  PAPER_TRADING: { path: 'trading.paperTrading', type: 'boolean' as const },

  // System
  MEMORY_THRESHOLD: { path: 'system.memoryThreshold', type: 'int' as const },
  WS_TIMEOUT: { path: 'system.wsTimeout', type: 'int' as const },
  HEALTH_CHECK_INTERVAL: { path: 'system.healthCheckInterval', type: 'int' as const },
  GRACEFUL_SHUTDOWN_TIMEOUT: { path: 'system.gracefulShutdownTimeout', type: 'int' as const },
  LOG_LEVEL: { path: 'system.logLevel', type: 'enum' as const, values: ['debug', 'info', 'warn', 'error'] },
  MAX_LOG_FILE_SIZE: { path: 'system.maxLogFileSize', type: 'int' as const },
  LOG_FILE_COUNT: { path: 'system.logFileCount', type: 'int' as const },
  NODE_ENV: { path: 'system.nodeEnv', type: 'enum' as const, values: ['development', 'production', 'test'] },
  PORT: { path: 'system.port', type: 'int' as const },
  ENABLE_METRICS: { path: 'system.enableMetrics', type: 'boolean' as const },

  // Exchange
  EXCHANGE_ID: { path: 'exchange.exchangeId', type: 'string' as const },
  EXCHANGE_API_KEY: { path: 'exchange.apiKey', type: 'string' as const },
  EXCHANGE_API_SECRET: { path: 'exchange.apiSecret', type: 'string' as const },
  EXCHANGE_TESTNET: { path: 'exchange.testnet', type: 'boolean' as const },
  EXCHANGE_RATE_LIMIT: { path: 'exchange.rateLimit', type: 'int' as const },
  EXCHANGE_ENABLE_RATE_LIMIT: { path: 'exchange.enableRateLimit', type: 'boolean' as const },

  // Risk
  DAILY_LOSS_LIMIT: { path: 'risk.dailyLossLimit', type: 'number' as const },
  MAX_TRADES_PER_DAY: { path: 'risk.maxTradesPerDay', type: 'int' as const },
  COOLDOWN_AFTER_LOSS: { path: 'risk.cooldownAfterLoss', type: 'int' as const },
  CONFIRM_LARGE_TRADES: { path: 'risk.confirmLargeTrades', type: 'boolean' as const },
  LARGE_TRADE_THRESHOLD: { path: 'risk.largeTradeThreshold', type: 'number' as const },
  CIRCUIT_BREAKER_ENABLED: { path: 'risk.circuitBreakerEnabled', type: 'boolean' as const },
  CIRCUIT_BREAKER_THRESHOLD: { path: 'risk.circuitBreakerThreshold', type: 'int' as const },
} as const;

// ============================================================================
// Schema Export
// ============================================================================

/**
 * All schemas exported for use in validation
 */
export const Schemas = {
  TradingConfig: TradingConfigSchema,
  SystemConfig: SystemConfigSchema,
  ExchangeConfig: ExchangeConfigSchema,
  RiskConfig: RiskConfigSchema,
  AppConfig: AppConfigSchema,
} as const;
