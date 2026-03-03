/**
 * Telemetry Types - Production-grade metrics collection for trading bot
 * @module server/telemetry/types
 */

/**
 * Counter metric type - monotonically increasing values
 */
export interface Counter {
  name: string;
  value: number;
  labels?: Record<string, string>;
  description?: string;
}

/**
 * Gauge metric type - values that can go up and down
 */
export interface Gauge {
  name: string;
  value: number;
  labels?: Record<string, string>;
  description?: string;
  min?: number;
  max?: number;
}

/**
 * Histogram bucket configuration
 */
export interface HistogramBucket {
  upperBound: number;
  count: number;
}

/**
 * Histogram metric type - distribution of values
 */
export interface Histogram {
  name: string;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
  description?: string;
}

/**
 * Histogram percentile values
 */
export interface HistogramPercentiles {
  p50: number;
  p95: number;
  p99: number;
  count: number;
  sum: number;
  min: number;
  max: number;
}

/**
 * Metric labels for categorization
 */
export interface MetricLabels {
  [key: string]: string;
}

/**
 * Complete telemetry snapshot at a point in time
 */
export interface TelemetrySnapshot {
  timestamp: number;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramPercentiles>;
  metadata: {
    version: string;
    uptime: number;
    hostname: string;
  };
}

/**
 * Metric export format for Prometheus
 */
export interface PrometheusMetric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  help: string;
  values: Array<{
    labels?: Record<string, string>;
    value: number;
  }>;
}

/**
 * JSON export format
 */
export interface JSONMetricsExport {
  timestamp: number;
  metrics: {
    counters: Array<{
      name: string;
      value: number;
      labels?: Record<string, string>;
    }>;
    gauges: Array<{
      name: string;
      value: number;
      labels?: Record<string, string>;
    }>;
    histograms: Array<{
      name: string;
      percentiles: HistogramPercentiles;
    }>;
  };
}

/**
 * Risk state values for risk_state_current gauge
 */
export enum RiskState {
  NORMAL = 0,
  WARNING = 1,
  HALTED = 2,
}

/**
 * Metric names used throughout the system
 */
export const MetricNames = {
  // Counters
  TRADE_ATTEMPT_TOTAL: 'trade_attempt_total',
  TRADE_REJECTED_TOTAL: 'trade_rejected_total',
  KILL_SWITCH_TRIGGERED_TOTAL: 'kill_switch_triggered_total',
  TRADE_EXECUTED_TOTAL: 'trade_executed_total',
  TRADE_FAILED_TOTAL: 'trade_failed_total',
  
  // Gauges
  RISK_STATE_CURRENT: 'risk_state_current',
  ANALYTICS_PNL_GAUGE: 'analytics_pnl_gauge',
  POSITION_COUNT: 'position_count',
  OPEN_ORDER_COUNT: 'open_order_count',
  
  // Histograms
  WS_LATENCY_HISTOGRAM: 'ws_latency_histogram',
  STRATEGY_DECISION_CONFIDENCE_HISTOGRAM: 'strategy_decision_confidence_histogram',
  TRADE_EXECUTION_TIME_HISTOGRAM: 'trade_execution_time_histogram',
  ORDER_FILL_TIME_HISTOGRAM: 'order_fill_time_histogram',
} as const;

/**
 * Type for metric names
 */
export type MetricName = typeof MetricNames[keyof typeof MetricNames];

/**
 * Configuration for histogram buckets
 */
export interface HistogramConfig {
  name: string;
  description: string;
  buckets: number[];
}

/**
 * Default histogram bucket configurations
 */
export const DefaultHistogramConfigs: Record<string, HistogramConfig> = {
  [MetricNames.WS_LATENCY_HISTOGRAM]: {
    name: MetricNames.WS_LATENCY_HISTOGRAM,
    description: 'WebSocket latency in milliseconds',
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  },
  [MetricNames.STRATEGY_DECISION_CONFIDENCE_HISTOGRAM]: {
    name: MetricNames.STRATEGY_DECISION_CONFIDENCE_HISTOGRAM,
    description: 'Strategy decision confidence (0-1)',
    buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0],
  },
  [MetricNames.TRADE_EXECUTION_TIME_HISTOGRAM]: {
    name: MetricNames.TRADE_EXECUTION_TIME_HISTOGRAM,
    description: 'Trade execution time in milliseconds',
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  },
  [MetricNames.ORDER_FILL_TIME_HISTOGRAM]: {
    name: MetricNames.ORDER_FILL_TIME_HISTOGRAM,
    description: 'Order fill time in milliseconds',
    buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  },
};

/**
 * Metric collection options
 */
export interface MetricCollectionOptions {
  enableHistograms: boolean;
  maxHistogramAge: number; // milliseconds
  maxCounterAge: number; // milliseconds
  retentionWindow: number; // milliseconds
}

/**
 * Default metric collection options
 */
export const DefaultMetricCollectionOptions: MetricCollectionOptions = {
  enableHistograms: true,
  maxHistogramAge: 3600000, // 1 hour
  maxCounterAge: 86400000, // 24 hours
  retentionWindow: 300000, // 5 minutes
};
