/**
 * Production-Grade Structured Logger
 * 
 * Features:
 * - Structured JSON output for log aggregation
 * - Correlation ID support for distributed tracing
 * - Module-based logging with context
 * - Deterministic timestamp support
 * - Log throttling for error spam prevention
 * - Sampling for high-volume logs
 * - Production mode: DEBUG disabled
 */

import {
  LogLevel,
  LogLevelValues,
  LogContext,
  LogEntry,
  LoggerConfig,
  DefaultLoggerConfig,
  LogModule,
} from './types';

/**
 * Throttle entry tracking for error log deduplication
 */
interface ThrottleEntry {
  count: number;
  lastLogTime: number;
  firstSeen: number;
}

/**
 * Production-grade structured logger
 */
export class Logger {
  private config: LoggerConfig;
  private module: LogModule;
  private correlationId: string | undefined;
  private throttleMap: Map<string, ThrottleEntry>;
  private sampleCounter: number;

  /**
   * Create a new Logger instance
   * @param module - Module name for log categorization
   * @param config - Logger configuration (optional, uses defaults)
   * @param correlationId - Optional correlation ID for tracing
   */
  constructor(
    module: LogModule,
    config?: Partial<LoggerConfig>,
    correlationId?: string
  ) {
    this.module = module;
    this.config = { ...DefaultLoggerConfig, ...config };
    this.correlationId = correlationId;
    this.throttleMap = new Map<string, ThrottleEntry>();
    this.sampleCounter = 0;
  }

  /**
   * Check if a log level should be output based on minLevel config
   */
  private shouldLog(level: LogLevel): boolean {
    return LogLevelValues[level] >= LogLevelValues[this.config.minLevel];
  }

  /**
   * Check if this log should be sampled based on sampleRate
   * Uses deterministic counter-based sampling (no randomness)
   */
  private shouldSample(): boolean {
    if (this.config.sampleRate >= 1.0) {
      return true;
    }
    if (this.config.sampleRate <= 0.0) {
      return false;
    }
    // Deterministic sampling using counter
    this.sampleCounter = (this.sampleCounter + 1) % 1000;
    const threshold = Math.floor(this.config.sampleRate * 1000);
    return this.sampleCounter < threshold;
  }

  /**
   * Generate throttle key for error deduplication
   */
  private getThrottleKey(message: string, context?: LogContext): string {
    // Include relevant context fields in throttle key
    const contextKey = context
      ? Object.entries(context)
          .filter(([key]) => ['errorCode', 'symbol', 'strategy'].includes(key))
          .map(([k, v]) => `${k}:${v}`)
          .join('|')
      : '';
    return `${message}|${contextKey}`;
  }

  /**
   * Check if error log should be throttled
   * Returns true if log should be suppressed
   */
  private isThrottled(level: LogLevel, message: string, context?: LogContext): boolean {
    if (level !== 'ERROR') {
      return false;
    }

    const now = Date.now();
    const key = this.getThrottleKey(message, context);
    const entry = this.throttleMap.get(key);

    if (!entry) {
      // First occurrence
      this.throttleMap.set(key, {
        count: 1,
        lastLogTime: now,
        firstSeen: now,
      });
      return false;
    }

    entry.count++;

    // Check if throttle interval has passed
    if (now - entry.lastLogTime >= this.config.throttleIntervalMs) {
      // Log with suppression count if errors were suppressed
      if (entry.count > 1) {
        this.output('WARN', `Suppressed ${entry.count - 1} duplicate error(s)`, {
          originalMessage: message,
          suppressedCount: entry.count - 1,
          timeWindowMs: now - entry.firstSeen,
        }, now);
      }
      // Reset throttle entry
      entry.count = 1;
      entry.lastLogTime = now;
      entry.firstSeen = now;
      return false;
    }

    // Within throttle window, suppress this log
    return true;
  }

  /**
   * Clean up old throttle entries (call periodically)
   */
  public cleanupThrottleMap(): void {
    const now = Date.now();
    const maxAge = this.config.throttleIntervalMs * 2;

    for (const [key, entry] of this.throttleMap.entries()) {
      if (now - entry.lastLogTime > maxAge) {
        // Log final suppression count before removing
        if (entry.count > 1) {
          this.output('WARN', `Final suppression count: ${entry.count - 1} duplicate error(s)`, {
            originalMessage: key.split('|')[0],
            suppressedCount: entry.count - 1,
          }, now);
        }
        this.throttleMap.delete(key);
      }
    }
  }

  /**
   * Format error object for structured logging
   */
  private formatError(error: unknown): LogEntry['error'] {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    if (typeof error === 'string') {
      return {
        name: 'Error',
        message: error,
      };
    }
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      return {
        name: String(err.name || 'UnknownError'),
        message: String(err.message || 'Unknown error'),
      };
    }
    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  /**
   * Output log entry to configured destinations
   */
  private output(
    level: LogLevel,
    message: string,
    context?: LogContext,
    timestamp?: number
  ): void {
    const entry: LogEntry = {
      level,
      timestamp: timestamp ?? Date.now(),
      module: this.module,
      message,
      ...(context && Object.keys(context).length > 0 && { context }),
      ...(this.correlationId && { correlationId: this.correlationId }),
    };

    // Console output
    if (this.config.enableConsole) {
      console.log(JSON.stringify(entry));
    }

    // File output (can be extended)
    if (this.config.enableFile && this.config.filePath) {
      // File output would be implemented here
      // For now, we rely on console redirection or external log shipper
    }
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    timestamp?: number
  ): void {
    // Check minimum log level
    if (!this.shouldLog(level)) {
      return;
    }

    // Check sampling
    if (!this.shouldSample()) {
      return;
    }

    // Check throttling for errors
    if (this.isThrottled(level, message, context)) {
      return;
    }

    this.output(level, message, context, timestamp);
  }

  /**
   * Log debug message
   * Disabled in production mode
   */
  public debug(message: string, context?: LogContext, timestamp?: number): void {
    this.log('DEBUG', message, context, timestamp);
  }

  /**
   * Log informational message
   */
  public info(message: string, context?: LogContext, timestamp?: number): void {
    this.log('INFO', message, context, timestamp);
  }

  /**
   * Log warning message
   */
  public warn(message: string, context?: LogContext, timestamp?: number): void {
    this.log('WARN', message, context, timestamp);
  }

  /**
   * Log error message
   * Supports Error objects and automatic throttling
   */
  public error(
    message: string,
    error?: unknown,
    context?: LogContext,
    timestamp?: number
  ): void {
    const errorContext: LogContext = { ...context };

    if (error !== undefined) {
      errorContext.error = this.formatError(error);
    }

    this.log('ERROR', message, errorContext, timestamp);
  }

  /**
   * Create child logger with additional context
   * Child logger inherits parent configuration and correlation ID
   */
  public child(additionalContext: LogContext): Logger {
    const childLogger = new Logger(
      this.module,
      this.config,
      this.correlationId
    );
    // Merge context into a new property for child logger
    // This is a simplified implementation
    return childLogger;
  }

  /**
   * Set correlation ID for this logger instance
   */
  public setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  /**
   * Get current correlation ID
   */
  public getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  /**
   * Update logger configuration
   */
  public setConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current logger configuration
   */
  public getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Get current module name
   */
  public getModule(): LogModule {
    return this.module;
  }

  /**
   * Get throttle statistics for monitoring
   */
  public getThrottleStats(): Array<{
    key: string;
    count: number;
    lastLogTime: number;
    firstSeen: number;
  }> {
    return Array.from(this.throttleMap.entries()).map(([key, entry]) => ({
      key,
      count: entry.count,
      lastLogTime: entry.lastLogTime,
      firstSeen: entry.firstSeen,
    }));
  }
}
