import React, { memo, useMemo } from 'react';
import { useMetrics } from '../../hooks/useMetrics';
import { formatDuration, formatNumber } from '../../utils/prometheusParser';

interface LatencyBarProps {
  label: string;
  value: number | null;
  maxValue: number;
  colorClass: string;
}

const LatencyBar = memo<LatencyBarProps>(({ label, value, maxValue, colorClass }) => {
  const percentage = useMemo(() => {
    if (value === null) return 0;
    return Math.min((value / maxValue) * 100, 100);
  }, [value, maxValue]);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className={value === null ? 'text-zinc-600' : 'text-zinc-300'}>
          {value !== null ? formatDuration(value) : '-'}
        </span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
});

LatencyBar.displayName = 'LatencyBar';

interface MetricCardProps {
  label: string;
  value: number | null;
  unit?: string;
  decimals?: number;
  trend?: 'up' | 'down' | 'neutral';
}

const MetricCard = memo<MetricCardProps>(({ label, value, unit = '', decimals = 0, trend }) => {
  const trendIcon = useMemo(() => {
    if (trend === 'up') return <span className="text-green-400">^</span>;
    if (trend === 'down') return <span className="text-red-400">v</span>;
    return null;
  }, [trend]);

  return (
    <div className="bg-zinc-800/50 rounded-lg p-3">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className="flex items-center space-x-1">
        <span className="text-lg font-semibold text-zinc-200">
          {value !== null ? formatNumber(value, decimals) : '-'}
        </span>
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
        {trendIcon}
      </div>
    </div>
  );
});

MetricCard.displayName = 'MetricCard';

export interface TelemetryPanelProps {
  className?: string;
}

/**
 * Telemetry Panel - Displays latency histograms, strategy confidence, and trade counters.
 */
export const TelemetryPanel = memo<TelemetryPanelProps>(({ className = '' }) => {
  const { data, isLoading, error, lastUpdated } = useMetrics();

  const confidenceColor = useMemo(() => {
    const confidence = data?.strategyConfidence ?? 0;
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    if (confidence >= 0.4) return 'text-orange-400';
    return 'text-red-400';
  }, [data?.strategyConfidence]);

  const maxLatency = useMemo(() => {
    const { p50, p95, p99 } = data?.wsLatencyHistogram ?? {};
    return Math.max(p50 ?? 0, p95 ?? 0, p99 ?? 0, 100) * 1.2;
  }, [data?.wsLatencyHistogram]);

  const formattedLastUpdate = useMemo(() => {
    if (!lastUpdated) return 'Never';
    return lastUpdated.toLocaleTimeString();
  }, [lastUpdated]);

  if (isLoading && !data && !error) {
    return (
      <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-48 text-sm text-zinc-500">
          Initial telemetry snapshot loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span>Telemetry</span>
        </h3>
        {error && (
          <span className="px-2 py-1 text-xs bg-red-900/40 text-red-400 rounded">
            Error
          </span>
        )}
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-zinc-400">WebSocket Latency</h4>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
            Source: {data?.wsLatencySource ?? 'none'}
          </span>
        </div>
        <div className="space-y-3">
          <LatencyBar
            label="p50"
            value={data?.wsLatencyHistogram.p50 ?? null}
            maxValue={maxLatency}
            colorClass="bg-green-500"
          />
          <LatencyBar
            label="p95"
            value={data?.wsLatencyHistogram.p95 ?? null}
            maxValue={maxLatency}
            colorClass="bg-yellow-500"
          />
          <LatencyBar
            label="p99"
            value={data?.wsLatencyHistogram.p99 ?? null}
            maxValue={maxLatency}
            colorClass="bg-red-500"
          />
        </div>
      </div>

      <div className="mb-4 p-3 bg-zinc-800/30 rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">Strategy Confidence</span>
          <span className={`text-xl font-bold ${confidenceColor}`}>
            {data?.strategyConfidence !== null && data?.strategyConfidence !== undefined
              ? `${(data.strategyConfidence * 100).toFixed(1)}%`
              : '-'}
          </span>
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Active Symbols: {data?.activeSymbols.length ?? 0}
        </div>
        <div className="mt-2 h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              data?.strategyConfidence && data.strategyConfidence >= 0.6
                ? 'bg-green-500'
                : data?.strategyConfidence && data.strategyConfidence >= 0.4
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
            }`}
            style={{ width: `${(data?.strategyConfidence ?? 0) * 100}%` }}
          />
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-zinc-400 mb-3">Trade Metrics</h4>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Attempts" value={data?.tradeMetrics.attempts ?? null} />
          <MetricCard label="Executed" value={data?.tradeMetrics.executed ?? null} trend="up" />
          <MetricCard label="Rejected" value={data?.tradeMetrics.rejected ?? null} trend="down" />
          <MetricCard label="Failed" value={data?.tradeMetrics.failed ?? null} trend="down" />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <MetricCard
            label="Success Rate"
            value={data?.tradeMetrics.successRate ?? null}
            unit="%"
            decimals={1}
          />
          <MetricCard
            label="Reject+Fail Rate"
            value={data?.tradeMetrics.rejectionRate ?? null}
            unit="%"
            decimals={1}
          />
        </div>
      </div>

      {data?.prometheus && (
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400">
              View Raw Metrics ({data.prometheus.metrics.size} metrics)
            </summary>
            <div className="mt-2 p-2 bg-zinc-950 rounded max-h-32 overflow-auto">
              <pre className="text-zinc-500 text-[10px]">
                {Array.from(data.prometheus.metrics.entries())
                  .slice(0, 10)
                  .map(([name, metric]) => `${name}: ${metric.values.length} values`)
                  .join('\n')}
                {data.prometheus.metrics.size > 10 && '\n...'}
              </pre>
            </div>
          </details>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-zinc-800">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Last updated</span>
          <span>{formattedLastUpdate}</span>
        </div>
      </div>
    </div>
  );
});

TelemetryPanel.displayName = 'TelemetryPanel';

export default TelemetryPanel;
