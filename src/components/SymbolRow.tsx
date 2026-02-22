import React, { useState } from 'react';
import { MetricsMessage } from '../types/metrics';
import OrderBook from './OrderBook';
import MetricValue from './ui/MetricValue';
import SlopeIcon from './ui/SlopeIcon';
import { ScoreBar } from './ui/ScoreBar';
import { Badge } from './ui/Badge';
import { MetricCard } from './ui/MetricCard';
import { OpenInterestSection } from './sections/OpenInterestSection';

interface SymbolRowProps {
  symbol: string;
  data: MetricsMessage;
  showLatency?: boolean;
}

const SymbolRow: React.FC<SymbolRowProps> = ({ symbol, data, showLatency = false }) => {
  const [expanded, setExpanded] = useState(false);
  const {
    state,
    legacyMetrics,
    timeAndSales,
    cvd,
    openInterest,
    funding,
    absorption,
    bids,
    asks,
    aiTrend,
    strategyPosition,
    liquidityMetrics,
    passiveFlowMetrics,
    derivativesMetrics,
    toxicityMetrics,
    regimeMetrics,
    crossMarketMetrics,
    enableCrossMarketConfirmation,
  } = data;

  // If we don't have legacy metrics yet (unseeded), render a placeholder row
  if (!legacyMetrics) {
    return (
      <div className="border-b border-zinc-800/50 p-4 grid grid-cols-12 gap-4 items-center select-none animate-pulse">
        <div className="col-span-2 flex items-center space-x-2">
          <span className="text-zinc-500 w-4"></span>
          <span className="font-bold text-zinc-500">{symbol}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-600 rounded border border-zinc-800">PERP</span>
        </div>
        <div className="col-span-10 flex items-center justify-between">
          <span className="text-zinc-600 text-xs">Waiting for metrics... ({state})</span>
          <Badge state={state} />
        </div>
      </div>
    );
  }

  // Helper: compute pressure bar segments from OBI weighted.  OBI values
  // around zero should map to a midpoint of 50%.  We clamp to [-1, 1]
  // and scale to ±50.
  const computePressureSegments = (obi: number) => {
    const clamped = Math.max(-1, Math.min(1, obi));
    const bidPct = 50 + clamped * 50;
    const askPct = 100 - bidPct;
    return [
      { width: bidPct, colour: 'bg-green-500' },
      { width: askPct, colour: 'bg-red-500' },
    ];
  };
  // Helper: compute trade size distribution segments.  Avoid divide by zero.
  const computeSizeSegments = () => {
    const total = timeAndSales.smallTrades + timeAndSales.midTrades + timeAndSales.largeTrades;
    if (total === 0) return [
      { width: 0, colour: 'bg-blue-300' },
      { width: 0, colour: 'bg-blue-400' },
      { width: 0, colour: 'bg-blue-500' },
    ];
    return [
      { width: (timeAndSales.smallTrades / total) * 100, colour: 'bg-blue-500' },
      { width: (timeAndSales.midTrades / total) * 100, colour: 'bg-blue-400' },
      { width: (timeAndSales.largeTrades / total) * 100, colour: 'bg-blue-300' },
    ];
  };
  // Helper: compute aggressive volume segments for buy vs sell
  const computeAggSegments = () => {
    const buy = timeAndSales.aggressiveBuyVolume;
    const sell = timeAndSales.aggressiveSellVolume;
    const total = buy + sell;
    if (total === 0) return [
      { width: 50, colour: 'bg-green-500' },
      { width: 50, colour: 'bg-red-500' },
    ];
    return [
      { width: (buy / total) * 100, colour: 'bg-green-500' },
      { width: (sell / total) * 100, colour: 'bg-red-500' },
    ];
  };
  // Convert ms to human friendly time for funding countdown
  const formatTimeToFunding = (ms: number | undefined) => {
    if (ms === undefined || ms <= 0) return '0m';
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };
  const positionSide = strategyPosition?.side ?? null;
  const trendSide = aiTrend?.side ?? null;
  const effectiveSide = positionSide || trendSide;
  const trendScorePct = aiTrend ? Math.round(Math.max(0, Math.min(1, Number(aiTrend.score || 0))) * 100) : null;
  const trendDisplayScore = positionSide ? 100 : (trendScorePct ?? 0);
  const trendLabel = effectiveSide || 'NEUTRAL';
  const trendClass = positionSide
    ? (positionSide === 'LONG'
      ? 'bg-green-900/35 text-green-200 border-green-700/50'
      : 'bg-red-900/35 text-red-200 border-red-700/50')
    : !aiTrend
      ? 'bg-zinc-800 text-zinc-500 border-zinc-700'
      : !aiTrend.intact
        ? 'bg-amber-900/30 text-amber-300 border-amber-700/40'
        : trendSide === 'LONG'
          ? 'bg-green-900/25 text-green-300 border-green-700/40'
          : trendSide === 'SHORT'
            ? 'bg-red-900/25 text-red-300 border-red-700/40'
            : 'bg-zinc-800 text-zinc-300 border-zinc-700';
  const displaySignal = positionSide
    ? `POSITION_${positionSide}` as const
    : (data.signalDisplay?.signal || (trendSide ? `TREND_${trendSide}` as const : null));
  const displaySignalScore = positionSide
    ? 100
    : Number.isFinite(Number(data.signalDisplay?.score))
      ? Number(data.signalDisplay?.score)
      : (trendScorePct ?? 0);
  const displaySignalReason = positionSide ? null : (data.signalDisplay?.vetoReason || null);
  const posNegClass = (n: number) => (n > 0 ? 'text-emerald-300' : n < 0 ? 'text-rose-300' : 'text-zinc-200');
  const asNumber = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
  const fmt = (v: unknown, d = 2) => {
    const n = asNumber(v);
    if (n == null) return '-';
    return n.toFixed(d);
  };
  const fmtSigned = (v: unknown, d = 2) => {
    const n = asNumber(v);
    if (n == null) return '-';
    return `${n > 0 ? '+' : ''}${n.toFixed(d)}`;
  };
  const fmtPct = (v: unknown, d = 2) => {
    const n = asNumber(v);
    if (n == null) return '-';
    return `${n > 0 ? '+' : ''}${n.toFixed(d)}%`;
  };
  const formatVol = (v: number) => {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return v.toFixed(2);
  };
  const markDev = asNumber(derivativesMetrics?.markLastDeviationPct);
  const indexDev = asNumber(derivativesMetrics?.indexLastDeviationPct);
  const perpBasis = asNumber(derivativesMetrics?.perpBasis);
  const perpBasisPct = perpBasis == null ? null : perpBasis * 100;
  return (
    <div className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
      {/* Main Row - Fixed Height & Width */}
      <div
        className="grid gap-0 px-5 items-center cursor-pointer select-none h-16"
        style={{ gridTemplateColumns: 'minmax(140px, 1fr) 110px 130px 90px 90px 90px 90px 90px 120px' }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Symbol */}
        <div className="flex items-center gap-2">
          <button className="text-zinc-500 hover:text-white transition-colors flex-shrink-0">
            <svg className={`w-3 h-3 transform transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7 7" />
            </svg>
          </button>
          <span className="font-bold text-white text-sm truncate">{symbol}</span>
          <span className="text-[8px] px-1 py-0.5 bg-zinc-800 text-zinc-500 rounded flex-shrink-0 uppercase tracking-tighter">PERP</span>
          {(aiTrend || positionSide) && (
            <span className={`text-[8px] px-1 py-0.5 rounded border flex-shrink-0 uppercase tracking-tight ${trendClass}`}>
              {positionSide ? 'POS' : 'TR'} {trendLabel} {trendDisplayScore}
            </span>
          )}
        </div>

        {/* Price */}
        <div className="text-right font-mono text-base text-zinc-100 font-semibold">
          {legacyMetrics.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>

        {/* OI / Change */}
        <div className="flex flex-col items-end justify-center pr-2">
          {openInterest ? (
            <>
              <span className="font-mono text-xs text-white font-bold">{formatVol(openInterest.openInterest)}</span>
              <div className="flex items-center gap-1 text-[9px] font-mono tracking-tighter">
                <span className={openInterest.oiChangeAbs >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {openInterest.oiChangeAbs >= 0 ? '+' : ''}{formatVol(openInterest.oiChangeAbs)}
                </span>
                <span className="text-zinc-500">({openInterest.oiChangePct.toFixed(2)}%)</span>
              </div>
            </>
          ) : (
            <span className="text-zinc-600 text-xs">-</span>
          )}
        </div>

        {/* OBI (10L) */}
        <div className="text-center">
          <MetricValue value={legacyMetrics.obiWeighted} />
        </div>

        {/* OBI (50L) */}
        <div className="text-center">
          <MetricValue value={legacyMetrics.obiDeep} />
        </div>

        {/* OBI Divergence */}
        <div className="text-center">
          <MetricValue value={legacyMetrics.obiDivergence} />
        </div>

        {/* Delta Z */}
        <div className="text-center">
          <MetricValue value={legacyMetrics.deltaZ} />
        </div>

        {/* CVD Slope */}
        <div className="flex items-center justify-center gap-1">
          <SlopeIcon value={legacyMetrics.cvdSlope} />
          <MetricValue value={legacyMetrics.cvdSlope} />
        </div>

        {/* Signal Column */}
        <div className="flex items-center justify-center">
          {displaySignal ? (
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold border flex flex-col items-center ${displaySignal.includes('LONG')
              ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700/30'
              : 'bg-rose-900/20 text-rose-300 border-rose-700/30'
              }`}>
              {displaySignal.split('_')[1] || displaySignal}
              <span className="text-[8px] opacity-70">SCR: {Math.round(displaySignalScore)}</span>
            </div>
          ) : (
            <span className="text-[9px] text-zinc-600 uppercase tracking-tighter truncate max-w-[80px]">
              {displaySignalReason || 'MONITORING'}
            </span>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="bg-zinc-950/40 border-t border-zinc-800 p-6 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="space-y-8">


            {/* 2. Trade Analysis & CVD */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Trade Summary Panel */}
              <div className="lg:col-span-1 space-y-3">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <span className="w-1 h-1 bg-zinc-500 rounded-full"></span>
                  Volume Analysis
                </h3>
                <div className="bg-zinc-900/40 p-4 rounded-lg border border-zinc-800/50 space-y-4 h-full flex flex-col justify-center">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-500">Aggressive Buy</span>
                      <span className="font-mono font-bold text-emerald-300">
                        {formatVol(data.timeAndSales.aggressiveBuyVolume)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-500">Aggressive Sell</span>
                      <span className="font-mono font-bold text-rose-300">
                        {formatVol(data.timeAndSales.aggressiveSellVolume)}
                      </span>
                    </div>
                  </div>

                  {/* Visual Bar */}
                  <div className="space-y-1">
                    <div className="w-full bg-zinc-800/50 h-1.5 rounded-full overflow-hidden flex">
                      <div
                        className="bg-green-500/80 h-full transition-all duration-500"
                        style={{ width: `${(data.timeAndSales.aggressiveBuyVolume / ((data.timeAndSales.aggressiveBuyVolume + data.timeAndSales.aggressiveSellVolume) || 1)) * 100}%` }}
                      />
                      <div
                        className="bg-red-500/80 h-full transition-all duration-500"
                        style={{ width: `${(data.timeAndSales.aggressiveSellVolume / ((data.timeAndSales.aggressiveBuyVolume + data.timeAndSales.aggressiveSellVolume) || 1)) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
                      <span>BUY DOMINANCE</span>
                      <span>SELL DOMINANCE</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-zinc-800/30 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-zinc-900/40 rounded p-1">
                      <div className="text-[8px] text-zinc-500 uppercase">Small</div>
                      <div className="text-[10px] font-bold text-zinc-300">{data.timeAndSales.smallTrades}</div>
                    </div>
                    <div className="bg-zinc-900/40 rounded p-1">
                      <div className="text-[8px] text-zinc-500 uppercase">Mid</div>
                      <div className="text-[10px] font-bold text-blue-300">{data.timeAndSales.midTrades}</div>
                    </div>
                    <div className="bg-zinc-900/40 rounded p-1 border border-yellow-900/20">
                      <div className="text-[8px] text-yellow-700 uppercase">Large</div>
                      <div className="text-[10px] font-bold text-yellow-500">{data.timeAndSales.largeTrades}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* CVD Multi-Timeframe */}
              <div className="lg:col-span-2 space-y-3">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <span className="w-1 h-1 bg-zinc-500 rounded-full"></span>
                  Orderflow Dynamics (CVD)
                </h3>
                <div className="bg-zinc-900/40 rounded-lg border border-zinc-800/50 overflow-hidden h-full">
                  <table className="w-full text-xs h-full">
                    <thead className="bg-zinc-900/60 border-b border-zinc-800/50 text-zinc-500 uppercase font-semibold text-[10px]">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Timeframe</th>
                        <th className="px-4 py-2 text-right font-medium">CVD Value</th>
                        <th className="px-4 py-2 text-right font-medium">Delta Change (Session)</th>
                        <th className="px-4 py-2 text-center font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/30">
                      {[
                        { tf: '1m', ...data.cvd.tf1m },
                        { tf: '5m', ...data.cvd.tf5m },
                        { tf: '15m', ...data.cvd.tf15m }
                      ].map((row) => (
                        <tr key={row.tf} className="hover:bg-zinc-800/10 transition-colors">
                          <td className="px-4 py-3 font-mono text-zinc-400 font-bold">{row.tf}</td>
                          <td className="px-4 py-3 text-right font-mono text-zinc-200">
                            <MetricValue value={row.cvd} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <span className={`px-1.5 py-0.5 rounded ${row.delta > 0 ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>
                              {row.delta > 0 ? '+' : ''}{row.delta.toFixed(0)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${row.state === 'Extreme' ? 'bg-red-900/20 text-red-400 border-red-800/30' :
                                row.state === 'High Vol' ? 'bg-yellow-900/20 text-yellow-500 border-yellow-800/30' :
                                  'bg-zinc-800/50 text-zinc-500 border-zinc-700/30'
                                }`}>
                                {row.state}
                              </span>
                              {row.tf === '1m' && data.advancedMetrics && (
                                <span className="text-[8px] text-zinc-600 font-mono">ATR: {data.advancedMetrics.volatilityIndex.toFixed(2)}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* 3. Advanced Microstructure */}
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                <span className="w-1 h-1 bg-zinc-400 rounded-full"></span>
                Advanced Microstructure
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Liquidity</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <div className="text-zinc-500">MicroPx</div>
                      <div className="text-zinc-100">{fmt(liquidityMetrics?.microPrice, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Wall Z</div>
                      <div className={posNegClass(asNumber(liquidityMetrics?.liquidityWallScore) || 0)}>{fmtSigned(liquidityMetrics?.liquidityWallScore, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Void</div>
                      <div className="text-zinc-200">{fmt(liquidityMetrics?.voidGapScore, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Convexity</div>
                      <div className={posNegClass(asNumber(liquidityMetrics?.bookConvexity) || 0)}>{fmtSigned(liquidityMetrics?.bookConvexity, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Slip Buy</div>
                      <div className="text-zinc-200">{fmtPct(liquidityMetrics?.expectedSlippageBuy, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Slip Sell</div>
                      <div className="text-zinc-200">{fmtPct(liquidityMetrics?.expectedSlippageSell, 3)}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Passive Flow</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <div className="text-zinc-500">Bid Add/s</div>
                      <div className="text-emerald-300">{fmt(passiveFlowMetrics?.bidAddRate, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Ask Add/s</div>
                      <div className="text-rose-300">{fmt(passiveFlowMetrics?.askAddRate, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Bid Cxl/s</div>
                      <div className="text-zinc-200">{fmt(passiveFlowMetrics?.bidCancelRate, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Ask Cxl/s</div>
                      <div className="text-zinc-200">{fmt(passiveFlowMetrics?.askCancelRate, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Spoof</div>
                      <div className={posNegClass(asNumber(passiveFlowMetrics?.spoofScore) || 0)}>{fmt(passiveFlowMetrics?.spoofScore, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Refresh/s</div>
                      <div className="text-zinc-200">{fmt(passiveFlowMetrics?.refreshRate, 2)}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Derivatives</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <div className="text-zinc-500">Mark Dev</div>
                      <div className={posNegClass(markDev || 0)}>{fmtPct(markDev, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Index Dev</div>
                      <div className={posNegClass(indexDev || 0)}>{fmtPct(indexDev, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Basis</div>
                      <div className={posNegClass(perpBasisPct || 0)}>{fmtPct(perpBasisPct, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Basis Z</div>
                      <div className={posNegClass(asNumber(derivativesMetrics?.perpBasisZScore) || 0)}>{fmtSigned(derivativesMetrics?.perpBasisZScore, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Liq Proxy</div>
                      <div className={posNegClass(asNumber(derivativesMetrics?.liquidationProxyScore) || 0)}>{fmt(derivativesMetrics?.liquidationProxyScore, 2)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Resiliency</div>
                      <div className="text-zinc-200">{fmt(liquidityMetrics?.resiliencyMs, 0)} ms</div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Toxicity</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <div className="text-zinc-500">VPIN</div>
                      <div className="text-zinc-100">{fmt(toxicityMetrics?.vpinApprox, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Signed Ratio</div>
                      <div className="text-zinc-100">{fmt(toxicityMetrics?.signedVolumeRatio, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Impact/Ntl</div>
                      <div className={posNegClass(asNumber(toxicityMetrics?.priceImpactPerSignedNotional) || 0)}>{fmtSigned(toxicityMetrics?.priceImpactPerSignedNotional, 6)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Trade/Book</div>
                      <div className="text-zinc-100">{fmt(toxicityMetrics?.tradeToBookRatio, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Burst Persist</div>
                      <div className="text-zinc-100">{fmt(toxicityMetrics?.burstPersistenceScore, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Eff. Spread</div>
                      <div className="text-zinc-100">{fmtPct(liquidityMetrics?.effectiveSpread, 3)}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Regime</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <div className="text-zinc-500">RV 1m</div>
                      <div className="text-zinc-100">{fmt(regimeMetrics?.realizedVol1m, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">RV 5m</div>
                      <div className="text-zinc-100">{fmt(regimeMetrics?.realizedVol5m, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">RV 15m</div>
                      <div className="text-zinc-100">{fmt(regimeMetrics?.realizedVol15m, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Vol of Vol</div>
                      <div className="text-zinc-100">{fmt(regimeMetrics?.volOfVol, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Chop</div>
                      <div className="text-zinc-100">{fmt(regimeMetrics?.chopScore, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Trendiness</div>
                      <div className="text-zinc-100">{fmt(regimeMetrics?.trendinessScore, 3)}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Cross Market</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <div className="text-zinc-500">Enabled</div>
                      <div className={enableCrossMarketConfirmation ? 'text-emerald-300' : 'text-zinc-500'}>
                        {enableCrossMarketConfirmation ? 'ON' : 'OFF'}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Spot-Perp</div>
                      <div className={posNegClass(asNumber(crossMarketMetrics?.spotPerpDivergence) || 0)}>{fmtPct(crossMarketMetrics?.spotPerpDivergence, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Beta BTC</div>
                      <div className="text-zinc-100">{fmt(crossMarketMetrics?.betaToBTC, 3)}</div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Beta ETH</div>
                      <div className="text-zinc-100">{fmt(crossMarketMetrics?.betaToETH, 3)}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-zinc-500">Venue Imbalance Diff</div>
                      <div className={posNegClass(asNumber(crossMarketMetrics?.crossVenueImbalanceDiff) || 0)}>{fmtSigned(crossMarketMetrics?.crossVenueImbalanceDiff, 3)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Strategy & Signal Card */}
            <div className="bg-zinc-900/40 p-5 rounded-lg border border-zinc-800/50">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Active Strategy Signals</h3>
                <div className="text-[10px] font-mono text-zinc-500 px-2 py-1 bg-black/40 rounded border border-zinc-800">
                  HASH: {data.snapshot?.stateHash.substring(0, 8)} | EV:{data.snapshot?.eventId}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-black/20 p-3 rounded border border-zinc-800/50">
                  <div className="text-[9px] text-zinc-600 mb-1 uppercase">Current Signal</div>
                  <div className={`text-lg font-bold ${displaySignal ? (displaySignal.includes('LONG') ? 'text-green-400' : 'text-red-400') : 'text-zinc-700'}`}>
                    {displaySignal || 'NONE'}
                  </div>
                </div>
                <div className="bg-black/20 p-3 rounded border border-zinc-800/50">
                  <div className="text-[9px] text-zinc-600 mb-1 uppercase">Signal Score</div>
                  <div className="text-lg font-mono font-bold text-white">
                    {Math.round(displaySignalScore)}%
                  </div>
                </div>
                <div className="bg-black/20 p-3 rounded border border-zinc-800/50">
                  <div className="text-[9px] text-zinc-600 mb-1 uppercase">Status / Veto</div>
                  <div className="text-xs font-mono text-zinc-400">
                    {displaySignalReason || 'READY'}
                  </div>
                </div>
                <div className="bg-black/20 p-3 rounded border border-zinc-800/50">
                  <div className="text-[9px] text-zinc-600 mb-1 uppercase">Candidate Entry</div>
                  {data.signalDisplay?.candidate ? (
                    <div className="text-xs font-mono text-blue-400 flex flex-col">
                      <span>ENTRY: {data.signalDisplay.candidate.entryPrice.toFixed(2)}</span>
                      <span className="text-[9px] text-zinc-500">TP: {data.signalDisplay.candidate.tpPrice.toFixed(2)}</span>
                    </div>
                  ) : <div className="text-xs text-zinc-700 italic">No entry set</div>}
                </div>
              </div>
            </div>

            {/* 3. Open Interest Section */}
            {data.openInterest && (
              <OpenInterestSection metrics={data.openInterest} />
            )}

          </div>
        </div>
      )}
    </div>
  );
};

export default SymbolRow;
