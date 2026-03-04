import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { parsePrometheusMetrics, ParsedPrometheusMetrics, extractHistogramPercentiles } from '../utils/prometheusParser';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiJson, fetchApiText } from '../services/apiFetch';

export interface TelemetrySnapshot {
  timestamp: number;
  ws_latency_histogram?: {
    p50: number;
    p95: number;
    p99: number;
    count: number;
    sum: number;
  };
  trade_metrics?: {
    attempts: number;
    executed: number;
    rejected: number;
    failed: number;
  };
  risk_state_current?: number;
  position_metrics?: {
    positionCount: number;
    openOrderCount: number;
  };
}

export interface MetricsData {
  prometheus: ParsedPrometheusMetrics | null;
  telemetry: TelemetrySnapshot | null;
  wsLatencyHistogram: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  strategyConfidence: number | null;
  tradeMetrics: {
    count1m: number | null;
    count5m: number | null;
    count1h: number | null;
    volume1m: number | null;
    volume5m: number | null;
    volume1h: number | null;
  };
}

export function useMetrics(): {
  data: MetricsData | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
} {
  const fetchPrometheus = useCallback(async (): Promise<string> => {
    return fetchApiText(
      '/metrics',
      withProxyApiKey({ cache: 'no-store' }),
    );
  }, []);

  const fetchTelemetry = useCallback(async (): Promise<TelemetrySnapshot> => {
    return fetchApiJson<TelemetrySnapshot>(
      '/api/telemetry/snapshot',
      withProxyApiKey({ cache: 'no-store' }),
    );
  }, []);

  const prometheusPolling = usePolling<string>({
    interval: 2000,
    fetcher: fetchPrometheus,
    maxRetries: 2,
    retryDelay: 1000,
  });

  const telemetryPolling = usePolling<TelemetrySnapshot>({
    interval: 2000,
    fetcher: fetchTelemetry,
    maxRetries: 2,
    retryDelay: 1000,
  });

  const parsedMetrics = useMemo((): MetricsData | null => {
    if (!prometheusPolling.data && !telemetryPolling.data) return null;

    let prometheus: ParsedPrometheusMetrics | null = null;
    if (prometheusPolling.data) {
      try {
        prometheus = parsePrometheusMetrics(prometheusPolling.data);
      } catch {
        prometheus = null;
      }
    }

    const telemetry = telemetryPolling.data ?? null;
    const fromProm = prometheus
      ? extractHistogramPercentiles(prometheus, 'ws_latency_histogram')
      : { p50: null, p95: null, p99: null };

    const wsLatencyHistogram = telemetry?.ws_latency_histogram
      ? {
          p50: telemetry.ws_latency_histogram.p50,
          p95: telemetry.ws_latency_histogram.p95,
          p99: telemetry.ws_latency_histogram.p99,
        }
      : fromProm;

    const strategyConfidence = prometheus?.getGauge('strategy_confidence')
      ?? prometheus?.getGauge('risk_state_current')
      ?? null;

    const tradeMetrics = {
      count1m: telemetry?.trade_metrics?.attempts ?? null,
      count5m: telemetry?.trade_metrics?.executed ?? null,
      count1h: telemetry?.trade_metrics?.rejected ?? null,
      volume1m: null,
      volume5m: null,
      volume1h: null,
    };

    return {
      prometheus,
      telemetry,
      wsLatencyHistogram,
      strategyConfidence,
      tradeMetrics,
    };
  }, [prometheusPolling.data, telemetryPolling.data]);

  const refresh = useCallback(async () => {
    await Promise.all([prometheusPolling.refresh(), telemetryPolling.refresh()]);
  }, [prometheusPolling.refresh, telemetryPolling.refresh]);

  return useMemo(() => ({
    data: parsedMetrics,
    isLoading: prometheusPolling.isLoading || telemetryPolling.isLoading,
    error: prometheusPolling.error || telemetryPolling.error,
    lastUpdated: (prometheusPolling.lastUpdated || telemetryPolling.lastUpdated)
      ? new Date((prometheusPolling.lastUpdated || telemetryPolling.lastUpdated) as number)
      : null,
    refresh,
  }), [parsedMetrics, prometheusPolling, telemetryPolling, refresh]);
}
