/**
 * Structured Logging System
 * 
 * Production-grade logging for trading bot observability.
 * 
 * Features:
 * - Structured JSON output for log aggregation systems
 * - Correlation ID support for distributed request tracing
 * - Module-based logging (risk, strategy, execution, etc.)
 * - Context objects for rich metadata
 * - Deterministic timestamp support (Date.now() parameter)
 * - Log throttling to prevent error spam
 * - Sampling for high-volume log scenarios
 * - Production mode: DEBUG logs disabled when NODE_ENV=production
 * 
 * @example
 * ```typescript
 * import { getLogger, logger } from './logging';
 * 
 * // Use default logger
 * logger.info('System started', { version: '1.0.0' });
 * 
 * // Use module-specific logger
 * const riskLogger = getLogger('risk');
 * riskLogger.warn('Position limit approaching', { 
 *   position: 100, 
 *   limit: 150 
 * });
 * 
 * // With correlation ID for tracing
 * const executionLogger = getLogger('execution', 'req-123');
 * executionLogger.info('Order submitted', { 
 *   orderId: 'ord-456', 
 *   symbol: 'BTC-USD' 
 * });
 * 
 * // Error logging with Error object
 * try {
 *   // ... risky operation
 * } catch (err) {
 *   executionLogger.error('Order failed', err, { orderId: 'ord-456' });
 * }
 * 
 * // Deterministic timestamp for testing
 * const testTime = Date.now();
 * logger.info('Test event', { test: true }, testTime);
 * ```
 */

// Export all types
export type {
  LogLevel,
  LogContext,
  LogEntry,
  LoggerConfig,
  LogModule,
} from './types';

// Export type constants
export { LogLevelValues, DefaultLoggerConfig } from './types';

// Export Logger class
export { Logger } from './Logger';

// Internal imports for factory functions
import { Logger } from './Logger';
import type { LogContext, LoggerConfig, LogModule } from './types';

/**
 * Logger instance cache for getLogger factory
 * Prevents creating duplicate loggers for the same module
 */
const loggerCache = new Map<string, Logger>();

/**
 * Default logger configuration from environment
 */
const getDefaultConfig = (): Partial<LoggerConfig> => ({
  minLevel: process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG',
  enableConsole: true,
  enableFile: false,
  throttleIntervalMs: parseInt(process.env.LOG_THROTTLE_MS || '60000', 10),
  sampleRate: parseFloat(process.env.LOG_SAMPLE_RATE || '1.0'),
});

/**
 * Get or create a logger for a specific module
 * 
 * @param module - Module name (e.g., 'risk', 'strategy', 'execution')
 * @param correlationId - Optional correlation ID for request tracing
 * @param config - Optional configuration overrides
 * @returns Logger instance for the specified module
 * 
 * @example
 * ```typescript
 * const riskLogger = getLogger('risk');
 * riskLogger.info('Risk check passed');
 * 
 * const executionLogger = getLogger('execution', 'req-abc-123');
 * executionLogger.info('Order executed');
 * ```
 */
export function getLogger(
  module: LogModule,
  correlationId?: string,
  config?: Partial<LoggerConfig>
): Logger {
  const cacheKey = `${module}:${correlationId || 'default'}`;

  // Check cache first
  const cached = loggerCache.get(cacheKey);
  if (cached) {
    // Update correlation ID if provided
    if (correlationId) {
      cached.setCorrelationId(correlationId);
    }
    return cached;
  }

  // Create new logger
  const mergedConfig = {
    ...getDefaultConfig(),
    ...config,
  };

  const logger = new Logger(module, mergedConfig, correlationId);
  loggerCache.set(cacheKey, logger);

  return logger;
}

/**
 * Create a logger with custom configuration
 * Does not use cache - creates a new instance each time
 * 
 * @param module - Module name
 * @param config - Logger configuration
 * @param correlationId - Optional correlation ID
 * @returns New Logger instance
 * 
 * @example
 * ```typescript
 * const fileLogger = createLogger('audit', {
 *   minLevel: 'INFO',
 *   enableConsole: true,
 *   enableFile: true,
 *   filePath: '/var/log/audit.log',
 *   throttleIntervalMs: 0,
 *   sampleRate: 1.0,
 * });
 * ```
 */
export function createLogger(
  module: LogModule,
  config: LoggerConfig,
  correlationId?: string
): Logger {
  return new Logger(module, config, correlationId);
}

/**
 * Clear the logger cache
 * Useful for testing or memory management
 */
export function clearLoggerCache(): void {
  loggerCache.clear();
}

/**
 * Get cache statistics for monitoring
 */
export function getLoggerCacheStats(): {
  size: number;
  modules: string[];
} {
  return {
    size: loggerCache.size,
    modules: Array.from(loggerCache.keys()),
  };
}

/**
 * Set global correlation ID for all new loggers
 * This is a convenience for request-scoped logging
 */
let globalCorrelationId: string | undefined;

export function setGlobalCorrelationId(correlationId: string | undefined): void {
  globalCorrelationId = correlationId;
}

export function getGlobalCorrelationId(): string | undefined {
  return globalCorrelationId;
}

/**
 * Default logger instance for general use
 * Module: 'system'
 */
export const logger = getLogger('system');

/**
 * Pre-configured module loggers for common use cases
 * These are lazily created on first access
 */
export const loggers = {
  /** Risk management module logger */
  get risk() {
    return getLogger('risk', globalCorrelationId);
  },
  /** Trading strategy module logger */
  get strategy() {
    return getLogger('strategy', globalCorrelationId);
  },
  /** Order execution module logger */
  get execution() {
    return getLogger('execution', globalCorrelationId);
  },
  /** WebSocket module logger */
  get ws() {
    return getLogger('ws', globalCorrelationId);
  },
  /** API module logger */
  get api() {
    return getLogger('api', globalCorrelationId);
  },
  /** Database module logger */
  get database() {
    return getLogger('database', globalCorrelationId);
  },
  /** Configuration module logger */
  get config() {
    return getLogger('config', globalCorrelationId);
  },
  /** System/module logger */
  get system() {
    return getLogger('system', globalCorrelationId);
  },
  /** Trade logging module */
  get trade() {
    return getLogger('trade', globalCorrelationId);
  },
  /** Market data module logger */
  get market() {
    return getLogger('market', globalCorrelationId);
  },
};

/**
 * Utility function to generate correlation IDs
 * Format: timestamp-random (but deterministic for testing)
 * 
 * @param prefix - Optional prefix for the correlation ID
 * @returns Generated correlation ID string
 * 
 * @example
 * ```typescript
 * const correlationId = generateCorrelationId('req');
 * // Returns: req-1234567890-abc
 * ```
 */
export function generateCorrelationId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const counter = (generateCorrelationId as unknown as { counter: number }).counter || 0;
  (generateCorrelationId as unknown as { counter: number }).counter = (counter + 1) % 10000;
  const seq = counter.toString(36).padStart(4, '0');
  
  if (prefix) {
    return `${prefix}-${timestamp}-${seq}`;
  }
  return `${timestamp}-${seq}`;
}

// Initialize counter for deterministic ID generation
(generateCorrelationId as unknown as { counter: number }).counter = 0;

/**
 * Middleware-style function for Express/fastify to set correlation ID from request
 * 
 * @example
 * ```typescript
 * app.use(correlationIdMiddleware());
 * ```
 */
export function correlationIdMiddleware(
  headerName: string = 'x-correlation-id'
): (req: { headers: Record<string, string | string[]> }, res: unknown, next: () => void) => void {
  return (req, _res, next) => {
    const headerValue = req.headers[headerName.toLowerCase()];
    const correlationId = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue || generateCorrelationId('req');
    
    setGlobalCorrelationId(correlationId);
    next();
  };
}

/**
 * Performance logging utility
 * Logs execution time of operations
 * 
 * @example
 * ```typescript
 * const perf = startPerformanceLog('database-query');
 * // ... do work
 * perf.end({ rows: 100 });
 * ```
 */
export function startPerformanceLog(
  operation: string,
  module: LogModule = 'system'
): { end: (context?: LogContext) => void } {
  const startTime = Date.now();
  const perfLogger = getLogger(module);

  return {
    end: (context?: LogContext) => {
      const duration = Date.now() - startTime;
      perfLogger.info(`Operation completed: ${operation}`, {
        ...context,
        duration,
        operation,
      });
    },
  };
}
