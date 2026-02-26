import React from 'react';
import { MetricsMessage, LegacyMetrics } from '../../types/metrics';
import { MetricTile } from '../ui/MetricTile';
import { ScoreBar } from '../ui/ScoreBar';
import { Badge } from '../ui/Badge';

export interface RightStatsPanelProps {
  metrics: MetricsMessage;
  showLatency?: boolean;
}

/**
 * Right stats panel containing a mixture of legacy and telemetry metrics. It
 * displays rolling deltas, session CVD, slopes, a bid/ask pressure bar,
 * trade summary bars, multi‑timeframe CVD and the futures context (open
 * interest and funding). At the bottom it shows the absorption flag and
 * connection state.
 */
const RightStatsPanel: React.FC<RightStatsPanelProps> = ({ metrics, showLatency = false }) => {
  const { timeAndSales, cvd, openInterest, funding, absorption, legacyMetrics, state, sessionVwap, htf, bids, asks } = metrics;
  const lm: LegacyMetrics | undefined = legacyMetrics;
  const posNegClass = (n: number) => (n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-zinc-300');
  // Bid/ask pressure ratio mapping to bar widths: ratio > 1 indicates more bid pressure
  const ratio = timeAndSales.bidHitAskLiftRatio;
  const bidWidth = ratio > 0 ? (ratio / (1 + ratio)) * 100 : 50;
  const askWidth = 100 - bidWidth;
  // Trade size distribution widths
  const totalCount = timeAndSales.tradeCount || 1;
  const smallPct = (timeAndSales.smallTrades / totalCount) * 100;
  const midPct = (timeAndSales.midTrades / totalCount) * 100;
  const largePct = (timeAndSales.largeTrades / totalCount) * 100;
  // Buy/sell volumes
  const buy = timeAndSales.aggressiveBuyVolume;
  const sell = timeAndSales.aggressiveSellVolume;
  const totalVol = buy + sell || 1;
  const buyPct = (buy / totalVol) * 100;
  const sellPct = 100 - buyPct;
  // Format helpers
  const formatNum = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const formatTime = (ms: number) => {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const sec = secs % 60;
    return `${mins}m ${sec}s`;
  };
  const inferTickSize = (): number => {
    const levels = [...(bids || []), ...(asks || [])]
      .map((lvl) => Number(lvl?.[0]))
      .filter((px) => Number.isFinite(px) && px > 0)
      .sort((a, b) => a - b);
    let minDiff = Number.POSITIVE_INFINITY;
    for (let i = 1; i < levels.length; i += 1) {
      const diff = Math.abs(levels[i] - levels[i - 1]);
      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
      }
    }
    if (!Number.isFinite(minDiff)) {
      return (lm?.price || 0) >= 1000 ? 0.1 : (lm?.price || 0) >= 1 ? 0.01 : 0.0001;
    }
    return minDiff;
  };
  const tickSize = inferTickSize();
  const priceDecimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tickSize))));
    const fmtPrice = (value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString(undefined, {
      minimumFractionDigits: priceDecimals,
      maximumFractionDigits: priceDecimals,
    });
  };
  const fmtSigned = (value: unknown, decimals = 1): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}`;
  };
  const fmtPct = (value: unknown, decimals = 2): string => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}%`;
  };
  const formatSessionStart = (ts: number | null | undefined): string => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '-';
    const d = new Date(n);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };
  const elapsedMinutes = Number.isFinite(Number(sessionVwap?.elapsedMs))
    ? `${Math.floor(Number(sessionVwap?.elapsedMs || 0) / 60000)}m`
    : '-';
  const h1Brk = htf?.h1?.structureBreakUp ? 'UP' : htf?.h1?.structureBreakDn ? 'DN' : '-';
  const h4Brk = htf?.h4?.structureBreakUp ? 'UP' : htf?.h4?.structureBreakDn ? 'DN' : '-';
  const formatBarStartHHmm = (value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '-';
    const d = new Date(n);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };
  return (
    <div className="space-y-3 text-xs">
      {/* Legacy rolling deltas and session stats */}
      {lm && (
        <div className="grid grid-cols-3 gap-2">
          <MetricTile title="Δ1s" value={lm.delta1s.toFixed(2)} valueClassName={posNegClass(lm.delta1s)} />
          <MetricTile title="Δ5s" value={lm.delta5s.toFixed(2)} valueClassName={posNegClass(lm.delta5s)} />
          <MetricTile title="ΔZ" value={lm.deltaZ.toFixed(2)} valueClassName={posNegClass(lm.deltaZ)} />
          <MetricTile title="CVD (Sess)" value={lm.cvdSession.toFixed(2)} valueClassName={posNegClass(lm.cvdSession)} className="col-span-2" />
          <MetricTile title="CVD Slope" value={lm.cvdSlope.toFixed(2)} valueClassName={posNegClass(lm.cvdSlope)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-800/50 p-2 rounded">
          <div className="font-semibold text-zinc-400 text-[10px] uppercase">Session VWAP</div>
          <div className="text-sm text-zinc-200 font-mono">{sessionVwap?.name || '-'} | {fmtPrice(sessionVwap?.value)}</div>
          <div className={`text-xs font-mono ${posNegClass(Number(sessionVwap?.priceDistanceBps || 0))}`}>
            Δbps {fmtSigned(sessionVwap?.priceDistanceBps, 1)}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            Rng {fmtPct(sessionVwap?.sessionRangePct, 2)} | Start {formatSessionStart(sessionVwap?.sessionStartMs)} | Elapsed {elapsedMinutes}
          </div>
        </div>
        <div className="bg-zinc-800/50 p-2 rounded">
          <div className="font-semibold text-zinc-400 text-[10px] uppercase">HTF 1H / 4H</div>
          <div className="text-[11px] text-zinc-200 font-mono">H1 Close {fmtPrice(htf?.h1?.close)} | ATR {fmtPrice(htf?.h1?.atr)}</div>
          <div className="text-[10px] text-zinc-500 font-mono">H1 Bar {formatBarStartHHmm(htf?.h1?.barStartMs)} UTC</div>
          <div className="text-[10px] text-zinc-500 font-mono">
            H1 Sw {fmtPrice(htf?.h1?.lastSwingHigh)}/{fmtPrice(htf?.h1?.lastSwingLow)} Brk {h1Brk}
          </div>
          <div className="text-[11px] text-zinc-200 font-mono mt-1">H4 Close {fmtPrice(htf?.h4?.close)} | ATR {fmtPrice(htf?.h4?.atr)}</div>
          <div className="text-[10px] text-zinc-500 font-mono">H4 Bar {formatBarStartHHmm(htf?.h4?.barStartMs)} UTC</div>
          <div className="text-[10px] text-zinc-500 font-mono">
            H4 Sw {fmtPrice(htf?.h4?.lastSwingHigh)}/{fmtPrice(htf?.h4?.lastSwingLow)} Brk {h4Brk}
          </div>
        </div>
      </div>

      {/* Pressure bar */}
      <div>
        <div className="flex justify-between text-zinc-500 mb-1">
          <span>Bid/Ask Pressure</span>
          <span className="font-mono">{formatNum(ratio, 3)}</span>
        </div>
        <ScoreBar segments={[{ width: bidWidth, colour: 'bg-green-500' }, { width: askWidth, colour: 'bg-red-500' }]} height={4} />
      </div>

      {/* Advanced Metrics Cards */}
      {lm && (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            Advanced Metrics
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {/* Sweep */}
            <div className="flex flex-col h-16 justify-between p-2 bg-purple-500/10 rounded border border-purple-500/20">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-zinc-500 uppercase">Sweep</span>
                <span className={`text-xs font-mono font-bold ${lm.sweepFadeScore > 0 ? 'text-green-400' : lm.sweepFadeScore < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                  {lm.sweepFadeScore >= 0 ? '+' : ''}{lm.sweepFadeScore.toFixed(2)}
                </span>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${lm.sweepFadeScore > 0 ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, Math.abs(lm.sweepFadeScore) * 100)}%` }} />
              </div>
              <div className="text-[7px] text-zinc-500">
                {lm.sweepFadeScore > 0.3 ? '🟢 Buy' : lm.sweepFadeScore < -0.3 ? '🔴 Sell' : '⚪ Bal'}
              </div>
            </div>
            {/* Breakout */}
            <div className="flex flex-col h-16 justify-between p-2 bg-pink-500/10 rounded border border-pink-500/20">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-zinc-500 uppercase">Breakout</span>
                <span className={`text-xs font-mono font-bold ${lm.breakoutScore > 0 ? 'text-blue-400' : lm.breakoutScore < 0 ? 'text-orange-400' : 'text-zinc-400'}`}>
                  {lm.breakoutScore >= 0 ? '+' : ''}{lm.breakoutScore.toFixed(2)}
                </span>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${lm.breakoutScore > 0 ? 'bg-blue-500' : 'bg-orange-500'}`} style={{ width: `${Math.min(100, Math.abs(lm.breakoutScore) * 100)}%` }} />
              </div>
              <div className="text-[7px] text-zinc-500">
                {lm.breakoutScore > 0.3 ? '📈 Up' : lm.breakoutScore < -0.3 ? '📉 Down' : '➡️ Side'}
              </div>
            </div>
            {/* Volatility */}
            <div className="flex flex-col h-16 justify-between p-2 bg-cyan-500/10 rounded border border-cyan-500/20">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-zinc-500 uppercase">Vol</span>
                <span className="text-xs font-mono font-bold text-cyan-400">
                  {(lm.regimeWeight * 100).toFixed(0)}%
                </span>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${lm.regimeWeight > 0.7 ? 'bg-red-500' : lm.regimeWeight > 0.4 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, lm.regimeWeight * 100)}%` }} />
              </div>
              <div className="text-[7px] text-zinc-500">
                {lm.regimeWeight > 0.7 ? '🔥 High' : lm.regimeWeight > 0.4 ? '⚠️ Norm' : '🧊 Low'}
              </div>
            </div>
            {/* Absorption */}
            <div className="flex flex-col h-16 justify-between p-2 bg-yellow-500/10 rounded border border-yellow-500/20">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-zinc-500 uppercase">Absorb</span>
                <span className="text-xs font-mono font-bold text-yellow-400">
                  {(lm.absorptionScore * 100).toFixed(0)}%
                </span>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${lm.absorptionScore > 0.7 ? 'bg-yellow-500' : lm.absorptionScore > 0.3 ? 'bg-amber-500' : 'bg-zinc-600'}`} style={{ width: `${Math.min(100, lm.absorptionScore * 100)}%` }} />
              </div>
              <div className="text-[7px] text-zinc-500">
                {lm.absorptionScore > 0.7 ? '💪 Strong' : lm.absorptionScore > 0.3 ? '📦 Mod' : '⏳ Weak'}
              </div>
            </div>
          </div>
          {/* Exhaustion Alert - Compact */}
          {lm.exhaustion && (
            <div className="px-2 py-1.5 bg-orange-900/30 border-l-2 border-orange-500 rounded-r">
              <span className="text-[10px] text-orange-400 font-bold">⚠️ EXHAUSTION</span>
              <span className="text-[9px] text-orange-300/70 ml-2">Momentum fading</span>
            </div>
          )}
        </div>
      )}

      {/* Trade summary bars */}
      <div className="space-y-1">
        <div className="flex justify-between text-zinc-500">
          <span>Agg Buy/Sell</span>
          <span className="font-mono">{formatNum(buy, 2)} / {formatNum(sell, 2)}</span>
        </div>
        <ScoreBar segments={[{ width: buyPct, colour: 'bg-green-500' }, { width: sellPct, colour: 'bg-red-500' }]} height={3} />
        <div className="flex justify-between text-zinc-500 mt-1">
          <span>Trades / PPS</span>
          <span className="font-mono">{timeAndSales.tradeCount} / {formatNum(timeAndSales.printsPerSecond, 2)}</span>
        </div>
        <div className="flex justify-between text-zinc-500 mt-1">
          <span>Size Dist (S/M/L)</span>
          <span className="font-mono">{timeAndSales.smallTrades}/{timeAndSales.midTrades}/{timeAndSales.largeTrades}</span>
        </div>
        <ScoreBar segments={[{ width: smallPct, colour: 'bg-blue-500' }, { width: midPct, colour: 'bg-purple-500' }, { width: largePct, colour: 'bg-orange-500' }]} height={3} />
        <div className="flex justify-between text-zinc-500 mt-1">
          <span>Burst</span>
          <span className="font-mono">
            {timeAndSales.consecutiveBurst.side ? `${timeAndSales.consecutiveBurst.side} ×${timeAndSales.consecutiveBurst.count}` : 'None'}
          </span>
        </div>
      </div>

      {/* Multi‑timeframe CVD */}
      <div className="grid grid-cols-3 gap-2">
        {cvd && ['tf1m', 'tf5m', 'tf15m'].map((tf) => {
          const obj = (cvd as any)[tf];
          if (!obj || typeof obj.delta !== 'number') return null;
          const label = tf === 'tf1m' ? '1M' : tf === 'tf5m' ? '5M' : '15M';
          return (
            <MetricTile
              key={tf}
              title={label}
              value={
                <>
                  <span className={posNegClass(obj.delta)}>
                    {obj.delta > 0 ? '+' : obj.delta < 0 ? '-' : ''}{formatNum(Math.abs(obj.delta), 2)}
                  </span>
                  {' Δ / '}
                  <span className="text-zinc-300">{formatNum(obj.cvd ?? 0, 2)}</span>
                </>
              }
              valueClassName=""
              className="" />
          );
        })}
      </div>

      {/* Futures context */}
      <div className="grid grid-cols-2 gap-2">
        {/* Open Interest */}
        <div className="bg-zinc-800/50 p-2 rounded">
          <div className="font-semibold text-zinc-400 text-[10px] uppercase">OI</div>
          {openInterest ? (
            <>
              <div className="text-sm text-zinc-200">{formatNum(openInterest.openInterest, 2)}</div>
              <div className={posNegClass(openInterest.oiChangeAbs)}>
                {openInterest.oiChangeAbs > 0 ? '+' : openInterest.oiChangeAbs < 0 ? '-' : ''}{formatNum(Math.abs(openInterest.oiChangeAbs), 2)}
                <span className="text-[10px] text-zinc-500 ml-1">({openInterest.oiChangePct.toFixed(2)}%)</span>
              </div>
              {openInterest.stabilityMsg && (
                <div className="text-[9px] text-zinc-500 mt-1">
                  {openInterest.stabilityMsg}
                </div>
              )}
            </>
          ) : (
            <div className="text-zinc-500">-</div>
          )}
        </div>
        {/* Funding */}
        <div className="bg-zinc-800/50 p-2 rounded">
          <div className="font-semibold text-zinc-400 text-[10px] uppercase">Funding</div>
          {funding ? (
            <>
              <div className="text-sm text-zinc-200">{formatNum(funding.rate, 4)}</div>
              <div className="text-sm text-zinc-200">{formatTime(funding.timeToFundingMs)}</div>
              <div className={funding.trend === 'up' ? 'text-green-400' : funding.trend === 'down' ? 'text-red-400' : 'text-zinc-300'}>
                {funding.trend}
              </div>
            </>
          ) : (
            <div className="text-zinc-500">-</div>
          )}
        </div>
      </div>

      {/* Absorption and state */}
      <div className="flex justify-between items-center mt-1">
        <div className="text-zinc-500">Absorption: {absorption && absorption > 0 ? <span className="text-yellow-300">Detected</span> : <span className="text-zinc-500">None</span>}</div>
        <Badge state={state} />
      </div>
    </div>
  );
};

export default RightStatsPanel;
