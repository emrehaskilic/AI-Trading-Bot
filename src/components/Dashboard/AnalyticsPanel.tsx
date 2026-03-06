import React, { memo, useMemo, useCallback } from 'react';
import { useAnalytics } from '../../hooks/useAnalytics';
import { formatNumber } from '../../utils/prometheusParser';

interface PnLDisplayProps {
  label: string;
  value: number;
  isCurrency?: boolean;
}

const PnLDisplay = memo<PnLDisplayProps>(({ label, value, isCurrency = true }) => {
  const { colorClass, sign } = useMemo(() => {
    if (value > 0) return { colorClass: 'text-green-400', sign: '+' };
    if (value < 0) return { colorClass: 'text-red-400', sign: '' };
    return { colorClass: 'text-zinc-400', sign: '' };
  }, [value]);

  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-sm font-medium ${colorClass}`}>
        {sign}{isCurrency ? '$' : ''}{formatNumber(Math.abs(value), 2)}
      </span>
    </div>
  );
});

PnLDisplay.displayName = 'PnLDisplay';

interface ProgressBarProps {
  label: string;
  current: number;
  max: number;
  unit?: string;
  decimals?: number;
}

const ProgressBar = memo<ProgressBarProps>(({ label, current, max, unit = '', decimals = 1 }) => {
  const percentage = useMemo(() => {
    if (max <= 0) return 0;
    return Math.min((Math.abs(current) / max) * 100, 100);
  }, [current, max]);

  const colorClass = useMemo(() => {
    if (percentage < 50) return 'bg-green-500';
    if (percentage < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  }, [percentage]);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300">
          {formatNumber(current, decimals)}{unit} / {formatNumber(max, decimals)}{unit}
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

ProgressBar.displayName = 'ProgressBar';

interface StatCardProps {
  label: string;
  value: number | undefined;
  suffix?: string;
  decimals?: number;
  threshold?: { warning: number; critical: number };
}

const StatCard = memo<StatCardProps>(({ label, value, suffix = '', decimals = 2, threshold }) => {
  const colorClass = useMemo(() => {
    if (value === undefined || !threshold) return 'text-zinc-300';
    if (value >= threshold.critical) return 'text-red-400';
    if (value >= threshold.warning) return 'text-yellow-400';
    return 'text-green-400';
  }, [value, threshold]);

  return (
    <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${colorClass}`}>
        {value !== undefined ? formatNumber(value, decimals) : '-'}
        {suffix && <span className="text-sm ml-1">{suffix}</span>}
      </div>
    </div>
  );
});

StatCard.displayName = 'StatCard';

export interface AnalyticsPanelProps {
  className?: string;
}

/**
 * Analytics Panel - Displays PnL, fees, slippage, drawdown, and evidence pack download
 * Optimized with React.memo and useMemo for performance
 */
export const AnalyticsPanel = memo<AnalyticsPanelProps>(({ className = '' }) => {
  const { data, isLoading, error, lastUpdated, downloadEvidencePack } = useAnalytics();

  const [isDownloading, setIsDownloading] = React.useState(false);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      await downloadEvidencePack();
    } catch (err) {
      console.error('Failed to download evidence pack:', err);
    } finally {
      setIsDownloading(false);
    }
  }, [downloadEvidencePack]);

  const formattedLastUpdate = useMemo(() => {
    if (!lastUpdated) return 'Never';
    return lastUpdated.toLocaleTimeString();
  }, [lastUpdated]);

  const drawdownColor = useMemo(() => {
    const ddPct = Math.abs(data?.drawdown.currentPercent ?? 0);
    if (ddPct < 2) return 'text-green-400';
    if (ddPct < 5) return 'text-yellow-400';
    return 'text-red-400';
  }, [data?.drawdown.currentPercent]);

  const totalTrades = data?.totalTrades ?? 0;
  const openPositions = data?.openPositions ?? 0;
  const hasTradeHistory = totalTrades > 0 || openPositions > 0;

  if (isLoading && !data && !error) {
    return (
      <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-48 text-sm text-zinc-500">
          Initial analytics snapshot loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
          <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
          <span>Analytics</span>
        </h3>
        <div className="flex items-center space-x-2">
          {data && !error && (
            <span className={`px-2 py-1 text-[10px] uppercase tracking-wide rounded ${
              data.source === 'dry_run_fallback'
                ? 'bg-blue-900/40 text-blue-300'
                : 'bg-zinc-800 text-zinc-400'
            }`}>
              {data.source === 'dry_run_fallback' ? 'Dry Run Source' : 'Analytics Engine'}
            </span>
          )}
          {error && (
            <span className="px-2 py-1 text-xs bg-red-900/40 text-red-400 rounded">
              Error
            </span>
          )}
        </div>
      </div>

      {data && !error && !hasTradeHistory && (
        <div className="mb-4 rounded-lg border border-blue-800/60 bg-blue-900/20 px-3 py-2 text-xs text-blue-300">
          No open or completed trades yet. Analytics metrics will populate after first entry.
        </div>
      )}

      {/* PnL Section */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Profit & Loss</h4>
        <div className="bg-zinc-800/30 rounded-lg p-3 space-y-2">
          {data?.pnl && (
            <>
              <PnLDisplay label="Total PnL" value={data.pnl.total} />
              <PnLDisplay label="Realized" value={data.pnl.realized} />
              <PnLDisplay label="Unrealized" value={data.pnl.unrealized} />
              <div className="border-t border-zinc-700 my-2"></div>
              <PnLDisplay label="Daily" value={data.pnl.daily} />
              <PnLDisplay label="Weekly" value={data.pnl.weekly} />
              <PnLDisplay label="Monthly" value={data.pnl.monthly} />
            </>
          )}
        </div>
      </div>

      {/* Fees Section */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Fees</h4>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-800/50 rounded-lg p-2 text-center">
            <div className="text-xs text-zinc-500">Maker</div>
            <div className="text-sm font-medium text-zinc-300">
              ${data?.fees.maker !== undefined ? formatNumber(data.fees.maker, 2) : '-'}
            </div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-2 text-center">
            <div className="text-xs text-zinc-500">Taker</div>
            <div className="text-sm font-medium text-zinc-300">
              ${data?.fees.taker !== undefined ? formatNumber(data.fees.taker, 2) : '-'}
            </div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-2 text-center">
            <div className="text-xs text-zinc-500">Total</div>
            <div className="text-sm font-medium text-zinc-300">
              ${data?.fees.total !== undefined ? formatNumber(data.fees.total, 2) : '-'}
            </div>
          </div>
        </div>
        {data?.fees.effectiveRate !== undefined && (
          <div className="mt-2 text-xs text-zinc-500 text-center">
            Effective Rate: {(data.fees.effectiveRate * 100).toFixed(3)}%
          </div>
        )}
      </div>

      {/* Slippage Section */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Slippage</h4>
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            label="Average"
            value={data?.slippage.average}
            suffix="bps"
            decimals={1}
            threshold={{ warning: 5, critical: 10 }}
          />
          <StatCard
            label="Max"
            value={data?.slippage.max}
            suffix="bps"
            decimals={1}
            threshold={{ warning: 20, critical: 50 }}
          />
          <StatCard
            label="p95"
            value={data?.slippage.p95}
            suffix="bps"
            decimals={1}
            threshold={{ warning: 15, critical: 30 }}
          />
        </div>
      </div>

      {/* Drawdown Section */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Drawdown</h4>
        <div className="bg-zinc-800/30 rounded-lg p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-zinc-500">Current Drawdown</span>
            <span className={`text-lg font-bold ${drawdownColor}`}>
              {data?.drawdown.currentPercent !== undefined 
                ? `${Math.abs(data.drawdown.currentPercent).toFixed(2)}%` 
                : '-'}
            </span>
          </div>
          <div className="text-xs text-zinc-500 mb-2 text-right">
            {data?.drawdown.current !== undefined
              ? `${formatNumber(Math.abs(data.drawdown.current), 2)} USDT`
              : '-'}
          </div>
          <ProgressBar
            label="vs Max Drawdown"
            current={Math.abs(data?.drawdown.currentPercent ?? 0)}
            max={Math.max(0.0001, Math.abs(data?.drawdown.maxPercent ?? 0))}
            unit="%"
            decimals={2}
          />
          {data?.drawdown.recovery !== undefined && (
            <div className="mt-2 text-xs text-zinc-500 text-right">
              Recovery Time: {formatNumber(data.drawdown.recovery, 0)} ms
            </div>
          )}
        </div>
      </div>

      {/* Performance Ratios */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Performance</h4>
        <div className="grid grid-cols-4 gap-2">
          <StatCard
            label="Sharpe"
            value={data?.sharpeRatio}
            decimals={2}
            threshold={{ warning: 1, critical: 0.5 }}
          />
          <StatCard
            label="Sortino"
            value={data?.sortinoRatio}
            decimals={2}
            threshold={{ warning: 1, critical: 0.5 }}
          />
          <StatCard
            label="Win Rate"
            value={data?.winRate !== undefined ? data.winRate * 100 : undefined}
            suffix="%"
            decimals={1}
            threshold={{ warning: 40, critical: 30 }}
          />
          <StatCard
            label="Profit Factor"
            value={data?.profitFactor}
            decimals={2}
            threshold={{ warning: 1.2, critical: 1 }}
          />
        </div>
      </div>

      {/* Open Positions */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">
          Open Positions ({data?.positions?.length || 0})
        </h4>
        <div className="space-y-2 max-h-40 overflow-auto pr-1">
          {(data?.positions && data.positions.length > 0) ? data.positions.map((position) => (
            <div key={position.symbol} className="bg-zinc-800/40 rounded p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300 font-medium">{position.symbol}</span>
                <span className={position.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {position.unrealizedPnl >= 0 ? '+' : ''}{formatNumber(position.unrealizedPnl, 2)} USDT
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-zinc-500">
                <span>{position.side} | Qty {formatNumber(position.qty, 4)}</span>
                <span>{formatNumber(position.unrealizedPnlPercent, 2)}%</span>
              </div>
            </div>
          )) : (
            <div className="text-center text-zinc-600 py-3 text-xs">
              No open positions
            </div>
          )}
        </div>
      </div>

      {/* Evidence Pack Download */}
      <div className="mt-4">
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          {isDownloading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span>Downloading...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Download Evidence Pack</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-800">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Last updated</span>
          <span>{formattedLastUpdate}</span>
        </div>
      </div>
    </div>
  );
});

AnalyticsPanel.displayName = 'AnalyticsPanel';

export default AnalyticsPanel;
