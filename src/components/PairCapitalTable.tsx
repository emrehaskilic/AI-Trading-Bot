import React from 'react';
import { DryRunTrendState, SymbolCapitalConfig, WarmupState } from '../api/types';

type RuntimeCapital = {
  configuredReserveUsdt?: number;
  effectiveReserveUsdt?: number;
  initialMarginUsdt?: number;
  leverage?: number;
  reserveScale?: number;
};

type RuntimeTrend = {
  state?: DryRunTrendState;
  confidence?: number;
  bias15m?: 'UP' | 'DOWN' | 'NEUTRAL';
  veto1h?: 'NONE' | 'UP' | 'DOWN' | 'EXHAUSTION';
};

type RuntimeDecision = {
  side?: 'LONG' | 'SHORT' | 'FLAT';
  confidence?: number;
  shouldTrade?: boolean;
  gatePassed?: boolean;
  regime?: string | null;
  actionType?: string | null;
  reason?: string | null;
  reasons?: string[];
  timestampMs?: number;
};

export interface PairCapitalRuntimeRow {
  capital?: RuntimeCapital | null;
  warmup?: WarmupState | null;
  trend?: RuntimeTrend | null;
  decision?: RuntimeDecision | null;
  warnings?: string[];
  leverageReady?: boolean | null;
}

interface PairCapitalTableProps {
  rows: SymbolCapitalConfig[];
  runtime?: Record<string, PairCapitalRuntimeRow>;
  readOnly?: boolean;
  onChange?: (symbol: string, patch: Partial<SymbolCapitalConfig>) => void;
}

const formatNum = (value: number | null | undefined, digits = 2): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const warmupLabel = (warmup?: WarmupState | null): string => {
  if (!warmup) return '-';
  if (warmup.tradeReady) return 'TRADE_READY';
  if (warmup.orderflow15mReady) return 'MICRO_READY';
  if (warmup.orderflow5mReady) return '5M_WARMUP';
  if (warmup.orderflow1mReady) return '1M_WARMUP';
  if (warmup.bootstrapDone) return 'BOOTSTRAPPED';
  return 'BOOTSTRAP';
};

const trendColor = (state?: DryRunTrendState): string => {
  if (state === 'UPTREND' || state === 'PULLBACK_UP') return 'text-emerald-400';
  if (state === 'DOWNTREND' || state === 'PULLBACK_DOWN') return 'text-rose-400';
  if (state === 'EXHAUSTION_UP' || state === 'EXHAUSTION_DOWN') return 'text-amber-300';
  return 'text-zinc-400';
};

const badgeClass = (active: boolean): string =>
  active
    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-900'
    : 'bg-zinc-950/50 text-zinc-500 border-zinc-800';

const decisionBadgeClass = (side?: 'LONG' | 'SHORT' | 'FLAT'): string => {
  if (side === 'LONG') return 'bg-emerald-950/50 text-emerald-300 border-emerald-900';
  if (side === 'SHORT') return 'bg-rose-950/50 text-rose-300 border-rose-900';
  return 'bg-zinc-950/50 text-zinc-400 border-zinc-800';
};

const PairCapitalTable: React.FC<PairCapitalTableProps> = ({
  rows,
  runtime = {},
  readOnly = false,
  onChange,
}) => {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full min-w-[1440px] text-xs">
        <thead className="bg-zinc-950/70 text-zinc-500 uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">Enabled</th>
            <th className="px-3 py-2 text-left">Symbol</th>
            <th className="px-3 py-2 text-right">Wallet Reserve</th>
            <th className="px-3 py-2 text-right">Initial Margin Seed</th>
            <th className="px-3 py-2 text-right">Leverage</th>
            <th className="px-3 py-2 text-right">Effective Reserve</th>
            <th className="px-3 py-2 text-center">Bootstrap</th>
            <th className="px-3 py-2 text-center">Warmup</th>
            <th className="px-3 py-2 text-center">Trend State</th>
            <th className="px-3 py-2 text-center">Decision</th>
            <th className="px-3 py-2 text-center">Trade Ready</th>
            <th className="px-3 py-2 text-center">Addon Ready</th>
            <th className="px-3 py-2 text-left">Warnings</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900 bg-black/20">
          {rows.length === 0 && (
            <tr>
              <td colSpan={13} className="px-3 py-6 text-center text-zinc-600 italic">
                No symbols configured.
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const runtimeRow = runtime[row.symbol] || {};
            const capital = runtimeRow.capital || null;
            const warmup = runtimeRow.warmup || null;
            const trend = runtimeRow.trend || null;
            const decision = runtimeRow.decision || null;
            const warnings = runtimeRow.warnings || [];

            return (
              <tr key={row.symbol}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={Boolean(row.enabled)}
                    disabled={readOnly}
                    onChange={(event) => onChange?.(row.symbol, { enabled: event.target.checked })}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-zinc-200">{row.symbol}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.walletReserveUsdt}
                    disabled={readOnly}
                    onChange={(event) => onChange?.(row.symbol, { walletReserveUsdt: Number(event.target.value) })}
                    className="w-28 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-mono"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.initialMarginUsdt}
                    disabled={readOnly}
                    onChange={(event) => onChange?.(row.symbol, { initialMarginUsdt: Number(event.target.value) })}
                    className="w-28 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-mono"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={1}
                    max={125}
                    value={row.leverage}
                    disabled={readOnly}
                    onChange={(event) => onChange?.(row.symbol, { leverage: Number(event.target.value) })}
                    className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-mono"
                  />
                </td>
                <td className="px-3 py-2 text-right font-mono text-zinc-300">
                  {formatNum(capital?.effectiveReserveUsdt ?? row.walletReserveUsdt, 2)}
                </td>
                <td className="px-3 py-2 text-center text-zinc-300">
                  {warmup?.bootstrapDone ? `${warmup.bootstrapBars1m || 0} bars` : 'pending'}
                </td>
                <td className="px-3 py-2 text-center text-zinc-300">
                  {warmupLabel(warmup)}
                </td>
                <td className={`px-3 py-2 text-center font-medium ${trendColor(trend?.state)}`}>
                  {trend?.state || '-'}
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`rounded border px-2 py-1 ${decisionBadgeClass(decision?.side)}`}>
                      {decision?.side || '-'}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {decision?.actionType || decision?.reason || decision?.regime || '-'}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded border px-2 py-1 ${badgeClass(Boolean(warmup?.tradeReady))}`}>
                    {warmup?.tradeReady ? 'YES' : 'NO'}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded border px-2 py-1 ${badgeClass(Boolean(warmup?.addonReady))}`}>
                    {warmup?.addonReady ? 'YES' : 'NO'}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-500">
                  {warnings.length > 0
                    ? warnings.join(', ')
                    : (warmup?.vetoReason
                      || decision?.reason
                      || (runtimeRow.leverageReady === false ? 'leverage_sync_pending' : '-'))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PairCapitalTable;
