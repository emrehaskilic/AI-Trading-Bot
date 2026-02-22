import React, { useState } from 'react';
import { MetricsMessage } from '../types/metrics';
import { Badge } from './ui/Badge';
import LeftStatsPanel from './panels/LeftStatsPanel';
import RightStatsPanel from './panels/RightStatsPanel';
import OrderBook from './OrderBook';

export interface MobileSymbolCardProps {
  symbol: string;
  metrics?: MetricsMessage;
  showLatency?: boolean;
}

const MobileSymbolCard: React.FC<MobileSymbolCardProps> = ({ symbol, metrics, showLatency = false }) => {
  const [open, setOpen] = useState(false);

  if (!metrics || !metrics.legacyMetrics) {
    return (
      <div className="border border-zinc-800 rounded-lg p-4 text-center text-zinc-500 animate-pulse">
        <div className="flex items-center justify-center space-x-2">
          <div className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce"></div>
          <span>Loading {symbol}...</span>
        </div>
      </div>
    );
  }

  const lm = metrics.legacyMetrics;
  const trend = metrics.aiTrend || null;
  const positionSide = metrics.strategyPosition?.side || null;
  const trendSide = positionSide || trend?.side || 'NEUTRAL';
  const trendScorePct = positionSide
    ? 100
    : trend
      ? Math.round(Math.max(0, Math.min(1, Number(trend.score || 0))) * 100)
      : null;
  const trendClass = positionSide
    ? (positionSide === 'LONG'
      ? 'bg-emerald-900/35 text-emerald-200 border-emerald-700/50'
      : 'bg-rose-900/35 text-rose-200 border-rose-700/50')
    : !trend
      ? 'bg-zinc-800 text-zinc-500 border-zinc-700'
      : !trend.intact
        ? 'bg-amber-900/30 text-amber-300 border-amber-700/40'
        : trend.side === 'LONG'
          ? 'bg-emerald-900/25 text-emerald-300 border-emerald-700/40'
          : trend.side === 'SHORT'
            ? 'bg-rose-900/25 text-rose-300 border-rose-700/40'
            : 'bg-zinc-800 text-zinc-300 border-zinc-700';

  const posNegClass = (n: number) => (n > 0 ? 'text-emerald-300' : n < 0 ? 'text-rose-300' : 'text-zinc-300');
  const fmt = (v: unknown, d = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '-');
  const fmtSigned = (v: unknown, d = 2) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${n > 0 ? '+' : ''}${n.toFixed(d)}`;
  };
  const fmtPct = (v: unknown, d = 2) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${n > 0 ? '+' : ''}${n.toFixed(d)}%`;
  };

  return (
    <div className="bg-gradient-to-br from-zinc-900/85 to-zinc-950 border border-zinc-800 rounded-lg overflow-hidden shadow-xl">
      <div
        className="flex justify-between items-center p-4 cursor-pointer active:bg-zinc-800/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center space-x-3">
          <div>
            <div className="text-base sm:text-lg font-bold text-white">{symbol}</div>
            <div className="text-sm text-zinc-200 font-mono">${lm.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            {(trend || positionSide) && (
              <div className="mt-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-tight ${trendClass}`}>
                  {positionSide ? 'Position' : 'Trend'} {trendSide} {trendScorePct ?? 0}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Badge state={metrics.state} />
          <svg
            className={`w-5 h-5 text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 px-4 pb-3 text-xs">
        <div className="text-center p-2 bg-zinc-800/40 rounded border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider">OBI W</div>
          <div className={`font-mono font-medium ${posNegClass(lm.obiWeighted)}`}>{lm.obiWeighted.toFixed(2)}</div>
        </div>
        <div className="text-center p-2 bg-zinc-800/40 rounded border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider">OBI D</div>
          <div className={`font-mono font-medium ${posNegClass(lm.obiDeep)}`}>{lm.obiDeep.toFixed(2)}</div>
        </div>
        <div className="text-center p-2 bg-zinc-800/40 rounded border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider">OBI Div</div>
          <div className={`font-mono font-medium ${posNegClass(lm.obiDivergence)}`}>{lm.obiDivergence.toFixed(2)}</div>
        </div>
        <div className="text-center p-2 bg-zinc-800/40 rounded border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider">DZ</div>
          <div className={`font-mono font-medium ${posNegClass(lm.deltaZ)}`}>{lm.deltaZ.toFixed(2)}</div>
        </div>
        <div className="text-center p-2 bg-zinc-800/40 rounded border border-zinc-800/60">
          <div className="text-zinc-500 text-[10px] uppercase tracking-wider">CVD</div>
          <div className={`font-mono font-medium ${posNegClass(lm.cvdSlope)}`}>{lm.cvdSlope.toFixed(2)}</div>
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-800 p-4 space-y-4 animate-in">
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2">
              <div className="text-zinc-500 text-[10px] uppercase">MicroPx</div>
              <div className="text-zinc-100">{fmt(metrics.liquidityMetrics?.microPrice, 2)}</div>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2">
              <div className="text-zinc-500 text-[10px] uppercase">Basis</div>
              <div className={posNegClass(Number(metrics.derivativesMetrics?.perpBasis || 0))}>
                {fmtPct((Number(metrics.derivativesMetrics?.perpBasis || 0) * 100), 3)}
              </div>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2">
              <div className="text-zinc-500 text-[10px] uppercase">VPIN</div>
              <div className="text-zinc-100">{fmt(metrics.toxicityMetrics?.vpinApprox, 3)}</div>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2">
              <div className="text-zinc-500 text-[10px] uppercase">Spoof</div>
              <div className={posNegClass(Number(metrics.passiveFlowMetrics?.spoofScore || 0))}>
                {fmtSigned(metrics.passiveFlowMetrics?.spoofScore, 2)}
              </div>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2">
              <div className="text-zinc-500 text-[10px] uppercase">Chop</div>
              <div className="text-zinc-100">{fmt(metrics.regimeMetrics?.chopScore, 3)}</div>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2">
              <div className="text-zinc-500 text-[10px] uppercase">Trendiness</div>
              <div className="text-zinc-100">{fmt(metrics.regimeMetrics?.trendinessScore, 3)}</div>
            </div>
          </div>

          <div className="bg-zinc-950/50 rounded-lg p-2">
            <OrderBook bids={metrics.bids} asks={metrics.asks} currentPrice={lm.price} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-zinc-800/30 rounded-lg p-3">
              <LeftStatsPanel legacyMetrics={lm} />
            </div>
            <div className="bg-zinc-800/30 rounded-lg p-3">
              <RightStatsPanel metrics={metrics} showLatency={showLatency} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileSymbolCard;
