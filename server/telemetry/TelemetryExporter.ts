/**
 * TelemetryExporter - Export metrics in various formats
 * @module server/telemetry/TelemetryExporter
 * 
 * Provides:
 * - getTelemetrySnapshot(): Complete telemetry snapshot
 * - exportMetricsJSON(): JSON format export
 * - exportMetricsPrometheus(): Prometheus format export
 * - /metrics HTTP endpoint handler
 */

import {
  TelemetrySnapshot,
  JSONMetricsExport,
  PrometheusMetric,
  HistogramPercentiles,
  MetricNames,
  RiskState,
  DefaultHistogramConfigs,
} from './types';

import {
  MetricsCollector,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  defaultCollector,
} from './MetricsCollector';

/**
 * HTTP response type for metrics endpoint
 */
export interface MetricsHTTPResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * TelemetryExporter - Handles all metric export functionality
 */
export class TelemetryExporter {
  private collector: MetricsCollector;
  private version: string;
  private hostname: string;

  constructor(collector: MetricsCollector = defaultCollector, version: string = '1.0.0') {
    this.collector = collector;
    this.version = version;
    this.hostname = this.getHostname();
  }

  /**
   * Get system hostname
   * @returns Hostname string
   */
  private getHostname(): string {
    try {
      // Node.js environment
      if (typeof process !== 'undefined' && process.env) {
        return process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown';
      }
    } catch {
      // Fallback
    }
    return 'unknown';
  }

  /**
   * Get complete telemetry snapshot
   * @returns TelemetrySnapshot with all current metrics
   */
  getTelemetrySnapshot(): TelemetrySnapshot {
    const timestamp = Date.now();
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, HistogramPercentiles> = {};

    // Collect counters
    this.collector.getCounters().forEach((counter, name) => {
      counters[name] = counter.get();
    });

    // Collect gauges
    this.collector.getGauges().forEach((gauge, name) => {
      gauges[name] = gauge.get();
    });

    // Collect histograms
    this.collector.getHistograms().forEach((histogram, name) => {
      histograms[name] = histogram.getPercentiles();
    });

    return {
      timestamp,
      counters,
      gauges,
      histograms,
      metadata: {
        version: this.version,
        uptime: this.collector.getUptime(),
        hostname: this.hostname,
      },
    };
  }

  /**
   * Export metrics in JSON format
   * @returns JSON string
   */
  exportMetricsJSON(): string {
    const snapshot = this.getTelemetrySnapshot();
    const exportData: JSONMetricsExport = {
      timestamp: snapshot.timestamp,
      metrics: {
        counters: [],
        gauges: [],
        histograms: [],
      },
    };

    // Export counters
    this.collector.getCounters().forEach((counter) => {
      exportData.metrics.counters.push({
        name: counter.name,
        value: counter.get(),
        labels: counter.labels,
      });
    });

    // Export gauges
    this.collector.getGauges().forEach((gauge) => {
      exportData.metrics.gauges.push({
        name: gauge.name,
        value: gauge.get(),
        labels: gauge.labels,
      });
    });

    // Export histograms
    this.collector.getHistograms().forEach((histogram) => {
      exportData.metrics.histograms.push({
        name: histogram.name,
        percentiles: histogram.getPercentiles(),
      });
    });

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export metrics in Prometheus format
   * @returns Prometheus exposition format string
   */
  exportMetricsPrometheus(): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // Export counters
    this.collector.getCounters().forEach((counter) => {
      if (counter.description) {
        lines.push(`# HELP ${counter.name} ${counter.description}`);
      }
      lines.push(`# TYPE ${counter.name} counter`);
      
      if (counter.labels && Object.keys(counter.labels).length > 0) {
        const labelStr = this.formatLabels(counter.labels);
        lines.push(`${counter.name}${labelStr} ${counter.get()} ${timestamp}`);
      } else {
        lines.push(`${counter.name} ${counter.get()} ${timestamp}`);
      }
      lines.push('');
    });

    // Export gauges
    this.collector.getGauges().forEach((gauge) => {
      if (gauge.description) {
        lines.push(`# HELP ${gauge.name} ${gauge.description}`);
      }
      lines.push(`# TYPE ${gauge.name} gauge`);
      
      if (gauge.labels && Object.keys(gauge.labels).length > 0) {
        const labelStr = this.formatLabels(gauge.labels);
        lines.push(`${gauge.name}${labelStr} ${gauge.get()} ${timestamp}`);
      } else {
        lines.push(`${gauge.name} ${gauge.get()} ${timestamp}`);
      }
      lines.push('');
    });

    // Export histograms
    this.collector.getHistograms().forEach((histogram) => {
      if (histogram.description) {
        lines.push(`# HELP ${histogram.name} ${histogram.description}`);
      }
      lines.push(`# TYPE ${histogram.name} histogram`);

      // Export buckets
      const distribution = histogram.getBucketDistribution();
      distribution.forEach((bucket) => {
        lines.push(
          `${histogram.name}_bucket{le="${bucket.upperBound}"} ${bucket.cumulative} ${timestamp}`
        );
      });
      // +Inf bucket
      lines.push(`${histogram.name}_bucket{le="+Inf"} ${histogram.count} ${timestamp}`);
      
      // Sum and count
      lines.push(`${histogram.name}_sum ${histogram.sum} ${timestamp}`);
      lines.push(`${histogram.name}_count ${histogram.count} ${timestamp}`);
      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * Format labels for Prometheus output
   * @param labels - Label key-value pairs
   * @returns Formatted label string
   */
  private formatLabels(labels: Record<string, string>): string {
    const pairs = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
    return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
  }

  /**
   * HTTP handler for /metrics endpoint
   * Supports both JSON and Prometheus formats via Accept header
   * @param acceptHeader - Accept header value
   * @returns HTTP response object
   */
  handleMetricsEndpoint(acceptHeader?: string): MetricsHTTPResponse {
    const wantsPrometheus = acceptHeader?.includes('application/openmetrics-text') ||
                           acceptHeader?.includes('text/plain') ||
                           acceptHeader?.includes('application/prometheus');

    if (wantsPrometheus) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
        body: this.exportMetricsPrometheus(),
      };
    }

    // Default to JSON
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: this.exportMetricsJSON(),
    };
  }

  /**
   * Express/Connect middleware for /metrics endpoint
   * @returns Middleware function
   */
  createMiddleware(): (req: any, res: any, next: any) => void {
    return (req: any, res: any, next: any) => {
      if (req.path === '/metrics' || req.url === '/metrics') {
        const acceptHeader = req.headers?.accept || req.get?.('accept');
        const response = this.handleMetricsEndpoint(acceptHeader);
        
        res.status(response.statusCode);
        Object.entries(response.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        res.send(response.body);
      } else {
        next();
      }
    };
  }

  /**
   * Get specific metric value
   * @param name - Metric name
   * @param type - Metric type
   * @returns Metric value or undefined
   */
  getMetricValue(name: string, type: 'counter' | 'gauge'): number | undefined {
    if (type === 'counter') {
      return this.collector.getCounterValue(name);
    }
    return this.collector.getGaugeValue(name);
  }

  /**
   * Get histogram percentiles
   * @param name - Histogram name
   * @returns Percentiles or undefined
   */
  getHistogramPercentiles(name: string): HistogramPercentiles | undefined {
    return this.collector.getHistogramPercentiles(name);
  }

  /**
   * Get system health status based on metrics
   * @returns Health status object
   */
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    riskState: RiskState;
    metrics: {
      tradeAttempts: number;
      tradeRejections: number;
      killSwitchTriggers: number;
      currentPnL: number;
    };
  } {
    const snapshot = this.getTelemetrySnapshot();
    
    const tradeAttempts = snapshot.counters[MetricNames.TRADE_ATTEMPT_TOTAL] || 0;
    const tradeRejections = snapshot.counters[MetricNames.TRADE_REJECTED_TOTAL] || 0;
    const killSwitchTriggers = snapshot.counters[MetricNames.KILL_SWITCH_TRIGGERED_TOTAL] || 0;
    const riskState = (snapshot.gauges[MetricNames.RISK_STATE_CURRENT] || 0) as RiskState;
    const currentPnL = snapshot.gauges[MetricNames.ANALYTICS_PNL_GAUGE] || 0;

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (riskState === RiskState.HALTED || killSwitchTriggers > 0) {
      status = 'critical';
    } else if (riskState === RiskState.WARNING || tradeRejections > tradeAttempts * 0.1) {
      status = 'warning';
    }

    return {
      status,
      riskState,
      metrics: {
        tradeAttempts,
        tradeRejections,
        killSwitchTriggers,
        currentPnL,
      },
    };
  }

  /**
   * Get metric aggregation over a time window
   * @param metricName - Name of the metric
   * @param type - Type of the metric
   * @param windowMs - Time window in milliseconds
   * @returns Aggregated value or undefined
   */
  getWindowedAggregation(
    metricName: string,
    type: 'counter' | 'gauge',
    windowMs: number
  ): { current: number; previous: number; delta: number } | undefined {
    // For counters, return the current value and estimate previous
    const current = type === 'counter' 
      ? this.collector.getCounterValue(metricName)
      : this.collector.getGaugeValue(metricName);

    if (current === undefined) {
      return undefined;
    }

    // Note: For true windowing, you'd need historical data storage
    // This is a simplified implementation
    return {
      current,
      previous: 0, // Would need historical data
      delta: current,
    };
  }
}

/**
 * Default telemetry exporter instance
 */
export const defaultExporter = new TelemetryExporter(defaultCollector);

/**
 * Convenience function to get telemetry snapshot
 * @returns TelemetrySnapshot
 */
export function getTelemetrySnapshot(): TelemetrySnapshot {
  return defaultExporter.getTelemetrySnapshot();
}

/**
 * Convenience function to export metrics as JSON
 * @returns JSON string
 */
export function exportMetricsJSON(): string {
  return defaultExporter.exportMetricsJSON();
}

/**
 * Convenience function to export metrics as Prometheus format
 * @returns Prometheus format string
 */
export function exportMetricsPrometheus(): string {
  return defaultExporter.exportMetricsPrometheus();
}

/**
 * HTTP handler for /metrics endpoint
 * @param acceptHeader - Accept header value
 * @returns HTTP response
 */
export function handleMetricsEndpoint(acceptHeader?: string): MetricsHTTPResponse {
  return defaultExporter.handleMetricsEndpoint(acceptHeader);
}

/**
 * Get health status based on metrics
 * @returns Health status
 */
export function getHealthStatus(): ReturnType<TelemetryExporter['getHealthStatus']> {
  return defaultExporter.getHealthStatus();
}
