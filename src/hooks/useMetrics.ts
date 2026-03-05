import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePolling } from './usePolling';
import { parsePrometheusMetrics, ParsedPrometheusMetrics, extractHistogramPercentiles } from '../utils/prometheusParser';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiJson, fetchApiText } from '../services/apiFetch';
import { useTelemetrySocket } from '../services/useTelemetrySocket';

export interface TelemetrySnapshot {
  timestamp: number;
  activeSymbols: string[];
  ws_latency_histogram?: {
    p50: number;
    p95: number;
    p99: number;
    count: number;
    sum: number;
  };
  strategy_decision_confidence_histogram?: {
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
  activeSymbols: string[];
  wsLatencyHistogram: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  wsLatencySource: 'client' | 'server' | 'prometheus' | 'none';
  strategyConfidence: number | null;
  tradeMetrics: {
    attempts: number;
    executed: number;
    rejected: number;
    failed: number;
    successRate: number;
    rejectionRate: number;
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index];
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
  const activeSymbols = telemetryPolling.data?.activeSymbols || [];
  const socketMetrics = useTelemetrySocket(activeSymbols);
  const recentClientLatenciesRef = useRef<number[]>([]);
  const lastSeenBySymbolRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const lastSeen = { ...lastSeenBySymbolRef.current };
    const nextSamples = [...recentClientLatenciesRef.current];

    for (const [symbol, message] of Object.entries(socketMetrics || {})) {
      const receivedAt = Number(message?.client_received_ms || 0);
      const latency = Number(message?.ws_latency_client_ms);
      const prevSeen = Number(lastSeen[symbol] || 0);
      if (receivedAt > prevSeen) {
        if (Number.isFinite(latency) && latency >= 0) {
          nextSamples.push(latency);
        }
        lastSeen[symbol] = receivedAt;
      }
    }

    if (nextSamples.length > 400) {
      recentClientLatenciesRef.current = nextSamples.slice(-400);
    } else {
      recentClientLatenciesRef.current = nextSamples;
    }
    lastSeenBySymbolRef.current = lastSeen;
  }, [socketMetrics]);

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
    const clientSamples = recentClientLatenciesRef.current;
    const clientLatencyHistogram = clientSamples.length > 0
      ? {
          p50: percentile(clientSamples, 0.50),
          p95: percentile(clientSamples, 0.95),
          p99: percentile(clientSamples, 0.99),
        }
      : null;
    const serverLatencyHistogram = telemetry?.ws_latency_histogram && telemetry.ws_latency_histogram.count > 0
      ? {
          p50: telemetry.ws_latency_histogram.p50,
          p95: telemetry.ws_latency_histogram.p95,
          p99: telemetry.ws_latency_histogram.p99,
        }
      : null;
    const hasPromLatency = fromProm.p50 !== null || fromProm.p95 !== null || fromProm.p99 !== null;
    const wsLatencyHistogram = clientLatencyHistogram || serverLatencyHistogram || fromProm;
    const wsLatencySource: MetricsData['wsLatencySource'] = clientLatencyHistogram
      ? 'client'
      : serverLatencyHistogram
        ? 'server'
        : hasPromLatency
          ? 'prometheus'
          : 'none';

    const strategyConfidence = telemetry?.strategy_decision_confidence_histogram
      ? Number(telemetry.strategy_decision_confidence_histogram.p50 || 0)
      : prometheus?.getGauge('strategy_confidence')
        ?? prometheus?.getGauge('strategy_decision_confidence')
      ?? null;

    const attempts = Number(telemetry?.trade_metrics?.attempts || 0);
    const executed = Number(telemetry?.trade_metrics?.executed || 0);
    const rejected = Number(telemetry?.trade_metrics?.rejected || 0);
    const failed = Number(telemetry?.trade_metrics?.failed || 0);
    const tradeMetrics = {
      attempts,
      executed,
      rejected,
      failed,
      successRate: attempts > 0 ? (executed / attempts) * 100 : 0,
      rejectionRate: attempts > 0 ? ((rejected + failed) / attempts) * 100 : 0,
    };

    return {
      prometheus,
      telemetry,
      activeSymbols,
      wsLatencyHistogram,
      wsLatencySource,
      strategyConfidence,
      tradeMetrics,
    };
  }, [prometheusPolling.data, telemetryPolling.data, activeSymbols, socketMetrics]);

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
