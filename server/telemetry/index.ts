/**
 * Telemetry Module - Production-grade metrics collection for trading bot
 * @module server/telemetry
 * 
 * This module provides:
 * - Counter, Gauge, and Histogram metric implementations
 * - Metric collection and aggregation
 * - Export in JSON and Prometheus formats
 * - Pre-defined trading bot metrics
 * 
 * @example
 * ```typescript
 * import { metrics, getTelemetrySnapshot, MetricNames } from './telemetry';
 * 
 * // Record a trade attempt
 * metrics.incrementCounter(MetricNames.TRADE_ATTEMPT_TOTAL);
 * 
 * // Set risk state
 * metrics.setGauge(MetricNames.RISK_STATE_CURRENT, RiskState.WARNING);
 * 
 * // Observe WebSocket latency
 * metrics.observeHistogram(MetricNames.WS_LATENCY_HISTOGRAM, 45);
 * 
 * // Get snapshot
 * const snapshot = getTelemetrySnapshot();
 * ```
 */

// Export types
export {
  Counter,
  Gauge,
  Histogram,
  HistogramPercentiles,
  HistogramBucket,
  MetricLabels,
  TelemetrySnapshot,
  PrometheusMetric,
  JSONMetricsExport,
  RiskState,
  MetricNames,
  MetricName,
  HistogramConfig,
  DefaultHistogramConfigs,
  MetricCollectionOptions,
  DefaultMetricCollectionOptions,
} from './types';

// Export metric implementations
export {
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  MetricsCollector,
  defaultCollector,
} from './MetricsCollector';

// Export telemetry exporter
export {
  TelemetryExporter,
  MetricsHTTPResponse,
  defaultExporter,
  getTelemetrySnapshot,
  exportMetricsJSON,
  exportMetricsPrometheus,
  handleMetricsEndpoint,
  getHealthStatus,
} from './TelemetryExporter';

// Import for creating pre-defined metrics
import { MetricsCollector } from './MetricsCollector';
import {
  TelemetryExporter,
  getTelemetrySnapshot,
  exportMetricsJSON,
  exportMetricsPrometheus,
  handleMetricsEndpoint,
  getHealthStatus,
} from './TelemetryExporter';
import {
  MetricNames,
  DefaultHistogramConfigs,
  RiskState,
  MetricCollectionOptions,
} from './types';

/**
 * Pre-configured metrics collector with trading bot metrics
 */
export class TradingBotMetrics {
  public collector: MetricsCollector;
  public exporter: TelemetryExporter;

  constructor(options?: Partial<MetricCollectionOptions>) {
    this.collector = new MetricsCollector(options);
    this.exporter = new TelemetryExporter(this.collector, '1.0.0');
    this.initializeMetrics();
  }

  /**
   * Initialize all pre-defined trading bot metrics
   */
  private initializeMetrics(): void {
    // ========== COUNTERS ==========
    
    // Trade attempt counter
    this.collector.registerCounter(
      MetricNames.TRADE_ATTEMPT_TOTAL,
      'Total number of trade attempts made by the strategy'
    );

    // Trade rejected counter
    this.collector.registerCounter(
      MetricNames.TRADE_REJECTED_TOTAL,
      'Total number of trades rejected by risk management'
    );

    // Kill switch triggered counter
    this.collector.registerCounter(
      MetricNames.KILL_SWITCH_TRIGGERED_TOTAL,
      'Total number of times kill switch was triggered'
    );

    // Trade executed counter
    this.collector.registerCounter(
      MetricNames.TRADE_EXECUTED_TOTAL,
      'Total number of successfully executed trades'
    );

    // Trade failed counter
    this.collector.registerCounter(
      MetricNames.TRADE_FAILED_TOTAL,
      'Total number of failed trade executions'
    );

    // ========== GAUGES ==========
    
    // Risk state gauge (0=normal, 1=warning, 2=halted)
    this.collector.registerGauge(
      MetricNames.RISK_STATE_CURRENT,
      'Current risk state (0=normal, 1=warning, 2=halted)',
      RiskState.NORMAL,
      undefined,
      RiskState.NORMAL,
      RiskState.HALTED
    );

    // PnL gauge
    this.collector.registerGauge(
      MetricNames.ANALYTICS_PNL_GAUGE,
      'Current profit/loss in USDT'
    );

    // Position count gauge
    this.collector.registerGauge(
      MetricNames.POSITION_COUNT,
      'Number of open positions'
    );

    // Open order count gauge
    this.collector.registerGauge(
      MetricNames.OPEN_ORDER_COUNT,
      'Number of open orders'
    );

    // ========== HISTOGRAMS ==========
    
    // WebSocket latency histogram
    const wsConfig = DefaultHistogramConfigs[MetricNames.WS_LATENCY_HISTOGRAM];
    this.collector.registerHistogram(
      wsConfig.name,
      wsConfig.buckets,
      wsConfig.description
    );

    // Strategy decision confidence histogram
    const confidenceConfig = DefaultHistogramConfigs[MetricNames.STRATEGY_DECISION_CONFIDENCE_HISTOGRAM];
    this.collector.registerHistogram(
      confidenceConfig.name,
      confidenceConfig.buckets,
      confidenceConfig.description
    );

    // Trade execution time histogram
    const execConfig = DefaultHistogramConfigs[MetricNames.TRADE_EXECUTION_TIME_HISTOGRAM];
    this.collector.registerHistogram(
      execConfig.name,
      execConfig.buckets,
      execConfig.description
    );

    // Order fill time histogram
    const fillConfig = DefaultHistogramConfigs[MetricNames.ORDER_FILL_TIME_HISTOGRAM];
    this.collector.registerHistogram(
      fillConfig.name,
      fillConfig.buckets,
      fillConfig.description
    );
  }

  // ========== Convenience Methods ==========

  /**
   * Record a trade attempt
   */
  recordTradeAttempt(): number {
    return this.collector.incrementCounter(MetricNames.TRADE_ATTEMPT_TOTAL);
  }

  /**
   * Record a rejected trade
   */
  recordTradeRejected(): number {
    return this.collector.incrementCounter(MetricNames.TRADE_REJECTED_TOTAL);
  }

  /**
   * Record kill switch trigger
   */
  recordKillSwitchTriggered(): number {
    return this.collector.incrementCounter(MetricNames.KILL_SWITCH_TRIGGERED_TOTAL);
  }

  /**
   * Record successful trade execution
   */
  recordTradeExecuted(): number {
    return this.collector.incrementCounter(MetricNames.TRADE_EXECUTED_TOTAL);
  }

  /**
   * Record failed trade execution
   */
  recordTradeFailed(): number {
    return this.collector.incrementCounter(MetricNames.TRADE_FAILED_TOTAL);
  }

  /**
   * Set current risk state
   * @param state - Risk state (0=normal, 1=warning, 2=halted)
   */
  setRiskState(state: RiskState): number {
    return this.collector.setGauge(MetricNames.RISK_STATE_CURRENT, state);
  }

  /**
   * Set current PnL
   * @param pnl - Profit/loss in USDT
   */
  setPnL(pnl: number): number {
    return this.collector.setGauge(MetricNames.ANALYTICS_PNL_GAUGE, pnl);
  }

  /**
   * Set position count
   * @param count - Number of open positions
   */
  setPositionCount(count: number): number {
    return this.collector.setGauge(MetricNames.POSITION_COUNT, count);
  }

  /**
   * Set open order count
   * @param count - Number of open orders
   */
  setOpenOrderCount(count: number): number {
    return this.collector.setGauge(MetricNames.OPEN_ORDER_COUNT, count);
  }

  /**
   * Record WebSocket latency
   * @param latencyMs - Latency in milliseconds
   */
  recordWsLatency(latencyMs: number): void {
    this.collector.observeHistogram(MetricNames.WS_LATENCY_HISTOGRAM, latencyMs);
  }

  /**
   * Record strategy decision confidence
   * @param confidence - Confidence value (0-1)
   */
  recordDecisionConfidence(confidence: number): void {
    this.collector.observeHistogram(
      MetricNames.STRATEGY_DECISION_CONFIDENCE_HISTOGRAM,
      confidence
    );
  }

  /**
   * Record trade execution time
   * @param timeMs - Execution time in milliseconds
   */
  recordTradeExecutionTime(timeMs: number): void {
    this.collector.observeHistogram(MetricNames.TRADE_EXECUTION_TIME_HISTOGRAM, timeMs);
  }

  /**
   * Record order fill time
   * @param timeMs - Fill time in milliseconds
   */
  recordOrderFillTime(timeMs: number): void {
    this.collector.observeHistogram(MetricNames.ORDER_FILL_TIME_HISTOGRAM, timeMs);
  }

  /**
   * Get telemetry snapshot
   */
  getSnapshot() {
    return this.exporter.getTelemetrySnapshot();
  }

  /**
   * Export metrics as JSON
   */
  toJSON(): string {
    return this.exporter.exportMetricsJSON();
  }

  /**
   * Export metrics as Prometheus format
   */
  toPrometheus(): string {
    return this.exporter.exportMetricsPrometheus();
  }

  /**
   * Handle /metrics HTTP endpoint
   * @param acceptHeader - Accept header from request
   */
  handleMetricsEndpoint(acceptHeader?: string) {
    return this.exporter.handleMetricsEndpoint(acceptHeader);
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    return this.exporter.getHealthStatus();
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.collector.resetAll();
    // Re-initialize risk state to normal
    this.setRiskState(RiskState.NORMAL);
  }
}

/**
 * Default trading bot metrics instance
 * Use this for most telemetry needs
 */
export const metrics = new TradingBotMetrics();

/**
 * Convenience re-exports for common operations
 */

/**
 * Record a trade attempt
 */
export function recordTradeAttempt(): number {
  return metrics.recordTradeAttempt();
}

/**
 * Record a rejected trade
 */
export function recordTradeRejected(): number {
  return metrics.recordTradeRejected();
}

/**
 * Record kill switch trigger
 */
export function recordKillSwitchTriggered(): number {
  return metrics.recordKillSwitchTriggered();
}

/**
 * Set current risk state
 */
export function setRiskState(state: RiskState): number {
  return metrics.setRiskState(state);
}

/**
 * Set current PnL
 */
export function setPnL(pnl: number): number {
  return metrics.setPnL(pnl);
}

/**
 * Record WebSocket latency
 */
export function recordWsLatency(latencyMs: number): void {
  metrics.recordWsLatency(latencyMs);
}

/**
 * Record strategy decision confidence
 */
export function recordDecisionConfidence(confidence: number): void {
  metrics.recordDecisionConfidence(confidence);
}

/**
 * Create Express/Connect middleware for /metrics endpoint
 * @returns Middleware function
 */
export function createMetricsMiddleware(): (req: any, res: any, next: any) => void {
  return metrics.exporter.createMiddleware();
}

// Default export
export default {
  metrics,
  TradingBotMetrics,
  MetricsCollector,
  TelemetryExporter,
  getTelemetrySnapshot,
  exportMetricsJSON,
  exportMetricsPrometheus,
  handleMetricsEndpoint,
  getHealthStatus,
  MetricNames,
  RiskState,
  recordTradeAttempt,
  recordTradeRejected,
  recordKillSwitchTriggered,
  setRiskState,
  setPnL,
  recordWsLatency,
  recordDecisionConfidence,
  createMetricsMiddleware,
};
