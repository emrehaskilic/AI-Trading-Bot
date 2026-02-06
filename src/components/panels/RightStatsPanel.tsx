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
  const { timeAndSales, cvd, openInterest, funding, absorption, legacyMetrics, state } = metrics;
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

      {/* Pressure bar */}
      <div>
        <div className="flex justify-between text-zinc-500 mb-1">
          <span>Bid/Ask Pressure</span>
          <span className="font-mono">{formatNum(ratio, 3)}</span>
        </div>
        <ScoreBar segments={[{ width: bidWidth, colour: 'bg-green-500' }, { width: askWidth, colour: 'bg-red-500' }]} height={4} />
      </div>

      {/* Advanced legacy scores (Sweep, Breakout, Regime, Absorption) */}
      {lm && (
        <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-zinc-800 border-dashed">
          {/* Sweep Strength */}
          <div>
            <ScoreBar
              segments={[{ width: Math.min(100, Math.abs(lm.sweepFadeScore) * 100), colour: 'bg-purple-500' }]}
              height={4}
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>Sweep Strength</span>
              <span className="text-zinc-300 font-mono">{lm.sweepFadeScore.toFixed(1)}</span>
            </div>
          </div>
          {/* Breakout Momentum */}
          <div>
            <ScoreBar
              segments={[{ width: Math.min(100, Math.abs(lm.breakoutScore) * 100), colour: 'bg-orange-500' }]}
              height={4}
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>Breakout Mom.</span>
              <span className="text-zinc-300 font-mono">{lm.breakoutScore.toFixed(1)}</span>
            </div>
          </div>
          {/* Regime Volatility */}
          <div>
            <ScoreBar
              segments={[{ width: Math.min(100, Math.abs(lm.regimeWeight) * 100), colour: 'bg-cyan-500' }]}
              height={4}
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>Regime Vol</span>
              <span className="text-zinc-300 font-mono">{lm.regimeWeight.toFixed(1)}</span>
            </div>
          </div>
          {/* Absorption Score */}
          <div>
            <ScoreBar
              segments={[{ width: Math.min(100, Math.abs(lm.absorptionScore) * 100), colour: 'bg-yellow-400' }]}
              height={4}
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>Absorption</span>
              <span className="text-zinc-300 font-mono">{lm.absorptionScore.toFixed(1)}</span>
            </div>
          </div>
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
        {showLatency && timeAndSales.avgLatencyMs !== undefined && (
          <div className="flex justify-between text-zinc-500 mt-1">
            <span>Avg Latency</span>
            <span className="font-mono">{formatNum(timeAndSales.avgLatencyMs, 2)} ms</span>
          </div>
        )}
      </div>

      {/* Multi‑timeframe CVD */}
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(cvd).map(([tf, obj]) => (
          <MetricTile
            key={tf}
            title={tf.toUpperCase()}
            value={
              <>
                <span className={posNegClass(obj.delta)}>
                  {obj.delta > 0 ? '+' : obj.delta < 0 ? '-' : ''}{formatNum(Math.abs(obj.delta), 2)}
                </span>
                {' Δ / '}
                <span className="text-zinc-300">{formatNum(obj.cvd, 2)}</span>
              </>
            }
            valueClassName=""
            className="" />
        ))}
      </div>

      {/* Futures context */}
      <div className="grid grid-cols-2 gap-2">
        {/* Open Interest */}
        <div className="bg-zinc-800/50 p-2 rounded">
          <div className="font-semibold text-zinc-400 text-[10px] uppercase">OI</div>
          {openInterest ? (
            <>
              <div className="text-sm text-zinc-200">{formatNum(openInterest.openInterest, 2)}</div>
              <div className={posNegClass(openInterest.delta)}>
                {openInterest.delta > 0 ? '+' : openInterest.delta < 0 ? '-' : ''}{formatNum(Math.abs(openInterest.delta), 2)}
              </div>
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