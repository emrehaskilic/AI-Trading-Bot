/**
 * Telemetry API Endpoints
 * 
 * Provides read-only access to telemetry data for UI dashboard.
 * All endpoints are deterministic and have no side effects.
 */

import { Request, Response } from 'express';
import { Router } from 'express';
import { MetricsCollector } from '../telemetry/MetricsCollector';
import { LatencyTracker } from '../metrics/LatencyTracker';
import os from 'os';

// Types for telemetry snapshot response
export interface TelemetrySnapshotResponse {
  timestamp: number;
  activeSymbols: string[];
  ws_latency_histogram: {
    p50: number;
    p95: number;
    p99: number;
    count: number;
    sum: number;
  };
  strategy_decision_confidence_histogram: {
    p50: number;
    p95: number;
    p99: number;
    count: number;
    sum: number;
  };
  trade_metrics: {
    attempts: number;
    executed: number;
    rejected: number;
    failed: number;
  };
  risk_state_current: number;
  position_metrics: {
    positionCount: number;
    openOrderCount: number;
  };
  system_metrics: {
    uptimeMs: number;
    memoryUsageMB: number;
    memoryUsagePercent: number;
  };
  latency_stages: Record<string, {
    avgMs: number;
    p95Ms: number;
    maxMs: number;
    samples: number;
  }>;
}

// Options for creating telemetry routes
export interface TelemetryRoutesOptions {
  metricsCollector: MetricsCollector;
  latencyTracker: LatencyTracker;
  getUptimeMs: () => number;
  getActiveSymbols?: () => string[];
}

/**
 * Create telemetry API routes
 */
export function createTelemetryRoutes(options: TelemetryRoutesOptions): Router {
  const router = Router();
  const {
    metricsCollector,
    latencyTracker,
    getUptimeMs,
    getActiveSymbols,
  } = options;

  /**
   * GET /api/telemetry/snapshot
   * Returns current telemetry snapshot with metrics data
   */
  router.get('/snapshot', (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      
      // Get histogram data for ws_latency
      const wsLatencyPercentiles = metricsCollector.getHistogramPercentiles('ws_latency_histogram') || { p50: 0, p95: 0, p99: 0, count: 0, sum: 0, min: 0, max: 0 };
      const strategyConfidencePercentiles = metricsCollector.getHistogramPercentiles('strategy_decision_confidence_histogram') || { p50: 0, p95: 0, p99: 0, count: 0, sum: 0, min: 0, max: 0 };
      
      // Get counter values
      const tradeAttempts = metricsCollector.getCounterValue('trade_attempt_total') || 0;
      const tradeExecuted = metricsCollector.getCounterValue('trade_executed_total') || 0;
      const tradeRejected = metricsCollector.getCounterValue('trade_rejected_total') || 0;
      const tradeFailed = metricsCollector.getCounterValue('trade_failed_total') || 0;
      
      // Get gauge values
      const riskStateCurrent = metricsCollector.getGaugeValue('risk_state_current') || 0;
      const positionCount = metricsCollector.getGaugeValue('position_count') || 0;
      const openOrderCount = metricsCollector.getGaugeValue('open_order_count') || 0;
      
      // Get latency snapshot
      const latencySnapshot = latencyTracker.snapshot();
      
      // Get memory usage
      const memUsage = process.memoryUsage();
      const memoryUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const totalMemory = os.totalmem();
      const memoryUsagePercent = Math.round((memUsage.heapUsed / totalMemory) * 100);

      const response: TelemetrySnapshotResponse = {
        timestamp: now,
        activeSymbols: getActiveSymbols ? getActiveSymbols() : [],
        ws_latency_histogram: {
          p50: wsLatencyPercentiles.p50 || 0,
          p95: wsLatencyPercentiles.p95 || 0,
          p99: wsLatencyPercentiles.p99 || 0,
          count: wsLatencyPercentiles.count || 0,
          sum: wsLatencyPercentiles.sum || 0,
        },
        strategy_decision_confidence_histogram: {
          p50: strategyConfidencePercentiles.p50 || 0,
          p95: strategyConfidencePercentiles.p95 || 0,
          p99: strategyConfidencePercentiles.p99 || 0,
          count: strategyConfidencePercentiles.count || 0,
          sum: strategyConfidencePercentiles.sum || 0,
        },
        trade_metrics: {
          attempts: tradeAttempts,
          executed: tradeExecuted,
          rejected: tradeRejected,
          failed: tradeFailed,
        },
        risk_state_current: riskStateCurrent,
        position_metrics: {
          positionCount,
          openOrderCount,
        },
        system_metrics: {
          uptimeMs: getUptimeMs(),
          memoryUsageMB,
          memoryUsagePercent,
        },
        latency_stages: latencySnapshot.stages,
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({
        error: 'telemetry_snapshot_failed',
        message: error?.message || 'Failed to get telemetry snapshot',
      });
    }
  });

  /**
   * GET /api/telemetry/metrics
   * Returns all metrics in JSON format (alternative to Prometheus /metrics)
   */
  router.get('/metrics', (_req: Request, res: Response) => {
    try {
      const counters = Array.from(metricsCollector.getCounters().values()).map(c => ({
        name: c.name,
        type: 'counter' as const,
        value: c.get(),
        description: c.description,
        labels: c.labels,
      }));

      const gauges = Array.from(metricsCollector.getGauges().values()).map(g => ({
        name: g.name,
        type: 'gauge' as const,
        value: g.get(),
        description: g.description,
        labels: g.labels,
        observedRange: g.getObservedRange(),
      }));

      const histograms = Array.from(metricsCollector.getHistograms().values()).map(h => {
        const percentiles = h.getPercentiles();
        const mean = percentiles.count > 0 ? percentiles.sum / percentiles.count : 0;
        return {
          name: h.name,
          type: 'histogram' as const,
          count: percentiles.count,
          sum: percentiles.sum,
          min: percentiles.min,
          max: percentiles.max,
          mean,
          percentiles: {
            p50: percentiles.p50,
            p75: h.getPercentile(75),
            p90: h.getPercentile(90),
            p95: percentiles.p95,
            p99: percentiles.p99,
          },
          description: h.description,
          labels: (h as any).labels,
        };
      });

      res.status(200).json({
        timestamp: Date.now(),
        metrics: [...counters, ...gauges, ...histograms],
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'telemetry_metrics_failed',
        message: error?.message || 'Failed to get metrics',
      });
    }
  });

  return router;
}
