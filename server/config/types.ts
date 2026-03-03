/**
 * Configuration Types for Trading Bot System
 * 
 * This file contains all TypeScript interfaces and types for the configuration system.
 * All configurations are deterministic with no randomness or AI/ML components.
 */

// ============================================================================
// Trading Configuration
// ============================================================================

/**
 * Trading-specific configuration parameters
 * All values are deterministic and validated at boot time
 */
export interface TradingConfig {
  /** Maximum acceptable latency in milliseconds (default: 500ms) */
  latencyThreshold: number;
  
  /** Flash crash detection threshold as percentage (default: 5%) */
  flashCrashThreshold: number;
  
  /** Maximum drawdown percentage before halt (default: 10%) */
  maxDrawdown: number;
  
  /** Minimum consensus size for multi-source validation (default: 3) */
  quorumSize: number;
  
  /** Minimum confidence threshold 0-1 (default: 0.7 = 70%) */
  confidenceThreshold: number;
  
  /** Maximum position size as percentage of portfolio (default: 20%) */
  maxPositionSize: number;
  
  /** Stop loss percentage (default: 2%) */
  stopLossPercent: number;
  
  /** Take profit percentage (default: 5%) */
  takeProfitPercent: number;
  
  /** Maximum number of concurrent trades (default: 5) */
  maxConcurrentTrades: number;
  
  /** Trading enabled flag (default: false) */
  tradingEnabled: boolean;
  
  /** Paper trading mode (default: true) */
  paperTrading: boolean;
}

// ============================================================================
// System Configuration
// ============================================================================

/**
 * System-level configuration parameters
 * Controls performance, health monitoring, and operational behavior
 */
export interface SystemConfig {
  /** Memory usage threshold percentage 0-100 (default: 80%) */
  memoryThreshold: number;
  
  /** WebSocket timeout in milliseconds (default: 30000ms) */
  wsTimeout: number;
  
  /** Health check interval in milliseconds (default: 30000ms) */
  healthCheckInterval: number;
  
  /** Graceful shutdown timeout in milliseconds (default: 10000ms) */
  gracefulShutdownTimeout: number;
  
  /** Log level (default: 'info') */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  
  /** Maximum log file size in MB (default: 100) */
  maxLogFileSize: number;
  
  /** Number of log files to keep (default: 5) */
  logFileCount: number;
  
  /** Node environment */
  nodeEnv: 'development' | 'production' | 'test';
  
  /** Port for HTTP server (default: 3000) */
  port: number;
  
  /** Enable metrics endpoint (default: true) */
  enableMetrics: boolean;
}

// ============================================================================
// Exchange Configuration
// ============================================================================

/**
 * Exchange-specific configuration
 * API keys and connection settings
 */
export interface ExchangeConfig {
  /** Exchange identifier (e.g., 'binance', 'coinbase') */
  exchangeId: string;
  
  /** API key for exchange */
  apiKey: string;
  
  /** API secret for exchange */
  apiSecret: string;
  
  /** Testnet mode (default: true) */
  testnet: boolean;
  
  /** Rate limit requests per second (default: 10) */
  rateLimit: number;
  
  /** Enable rate limiting (default: true) */
  enableRateLimit: boolean;
}

// ============================================================================
// Risk Management Configuration
// ============================================================================

/**
 * Risk management configuration
 * Prevents catastrophic losses through strict limits
 */
export interface RiskConfig {
  /** Daily loss limit as percentage (default: 5%) */
  dailyLossLimit: number;
  
  /** Maximum trades per day (default: 50) */
  maxTradesPerDay: number;
  
  /** Cooldown period after loss in milliseconds (default: 60000ms) */
  cooldownAfterLoss: number;
  
  /** Require confirmation for large trades (default: true) */
  confirmLargeTrades: boolean;
  
  /** Large trade threshold in USD (default: 10000) */
  largeTradeThreshold: number;
  
  /** Circuit breaker enabled (default: true) */
  circuitBreakerEnabled: boolean;
  
  /** Circuit breaker threshold - consecutive losses (default: 3) */
  circuitBreakerThreshold: number;
}

// ============================================================================
// Complete Configuration
// ============================================================================

/**
 * Complete application configuration
 * Combines all configuration sections
 */
export interface AppConfig {
  trading: TradingConfig;
  system: SystemConfig;
  exchange: ExchangeConfig;
  risk: RiskConfig;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Individual validation error
 */
export interface ConfigValidationError {
  /** Field path that failed validation */
  field: string;
  
  /** Invalid value */
  value: unknown;
  
  /** Human-readable error message */
  message: string;
  
  /** Error code for programmatic handling */
  code?: string;
}

/**
 * Validation result with errors and warnings
 */
export interface ConfigValidationResult {
  /** Whether configuration is valid */
  valid: boolean;
  
  /** Validation errors that must be fixed */
  errors: ConfigValidationError[];
  
  /** Warnings about potentially dangerous settings */
  warnings: string[];
  
  /** Validated and sanitized configuration (if valid) */
  config?: AppConfig;
}

/**
 * Validation rule for a single field
 */
export interface ValidationRule<T = unknown> {
  /** Field name */
  field: string;
  
  /** Validation function */
  validate: (value: unknown) => boolean;
  
  /** Error message if validation fails */
  message: string;
  
  /** Whether field is required */
  required: boolean;
  
  /** Default value if not provided */
  defaultValue?: T;
  
  /** Minimum value (for numbers) */
  min?: number;
  
  /** Maximum value (for numbers) */
  max?: number;
}

// ============================================================================
// Environment Variable Types
// ============================================================================

/**
 * Environment variable mapping
 * Maps environment variables to config fields
 */
export interface EnvVarMapping {
  /** Environment variable name */
  envVar: string;
  
  /** Config field path (dot notation) */
  configPath: string;
  
  /** Value type for parsing */
  type: 'string' | 'number' | 'boolean';
  
  /** Whether variable is required */
  required: boolean;
}

/**
 * Partial configuration for merging with defaults
 */
export type PartialConfig = {
  [K in keyof AppConfig]?: Partial<AppConfig[K]>;
};

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Type for safe defaults constant
 */
export type SafeDefaultsType = {
  latencyThreshold: number;
  flashCrashThreshold: number;
  maxDrawdown: number;
  quorumSize: number;
  confidenceThreshold: number;
  memoryThreshold: number;
  wsTimeout: number;
  healthCheckInterval: number;
  gracefulShutdownTimeout: number;
  maxPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxConcurrentTrades: number;
  tradingEnabled: boolean;
  paperTrading: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxLogFileSize: number;
  logFileCount: number;
  port: number;
  enableMetrics: boolean;
  dailyLossLimit: number;
  maxTradesPerDay: number;
  cooldownAfterLoss: number;
  confirmLargeTrades: boolean;
  largeTradeThreshold: number;
  circuitBreakerEnabled: boolean;
  circuitBreakerThreshold: number;
  testnet: boolean;
  rateLimit: number;
  enableRateLimit: boolean;
};

/**
 * Readonly version of AppConfig for immutable references
 */
export type ReadonlyConfig = Readonly<AppConfig>;
