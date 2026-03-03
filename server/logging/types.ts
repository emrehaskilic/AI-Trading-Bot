/**
 * Structured Logging Types
 * Production-grade logging for trading bot observability
 */

/**
 * Log severity levels
 * DEBUG: Detailed diagnostic information (disabled in production)
 * INFO: General operational information
 * WARN: Warning conditions that don't prevent operation
 * ERROR: Error conditions that may affect operation
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Log level numeric values for comparison
 */
export const LogLevelValues: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Context object for additional structured metadata
 * Can contain any key-value pairs for observability
 */
export interface LogContext {
  [key: string]: unknown;
}

/**
 * Structured log entry format
 * All logs output as JSON for log aggregation systems
 */
export interface LogEntry {
  /** Log severity level */
  level: LogLevel;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Module/component name (e.g., 'risk', 'strategy', 'execution') */
  module: string;
  /** Human-readable log message */
  message: string;
  /** Additional structured context data */
  context?: LogContext;
  /** Correlation ID for distributed tracing */
  correlationId?: string;
  /** Error details when logging exceptions */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  minLevel: LogLevel;
  /** Enable console output */
  enableConsole: boolean;
  /** Enable file output */
  enableFile: boolean;
  /** File path for log output (when enableFile is true) */
  filePath?: string;
  /** Throttle interval in ms for duplicate error logs */
  throttleIntervalMs: number;
  /** Sampling rate for high-volume logs (0.0 to 1.0) */
  sampleRate: number;
}

/**
 * Default logger configuration
 */
export const DefaultLoggerConfig: LoggerConfig = {
  minLevel: process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG',
  enableConsole: true,
  enableFile: false,
  throttleIntervalMs: 60000, // 1 minute
  sampleRate: 1.0,
};

/**
 * Valid module names for type safety
 */
export type LogModule =
  | 'risk'
  | 'strategy'
  | 'execution'
  | 'ws'
  | 'api'
  | 'database'
  | 'config'
  | 'system'
  | 'trade'
  | 'market'
  | string;
