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

/**
 * Mobile‑friendly card representation of a symbol. It displays a compact
 * header with key metrics and allows the user to expand advanced
 * statistics. The goal is to mirror the desktop experience in a
 * space‑efficient layout.
 */
const MobileSymbolCard: React.FC<MobileSymbolCardProps> = ({ symbol, metrics, showLatency = false }) => {
  const [open, setOpen] = useState(false);
  if (!metrics || !metrics.legacyMetrics) {
    return (
      <div className="border border-zinc-800 rounded-lg p-4 text-center text-zinc-500">Waiting {symbol}…</div>
    );
  }
  const lm = metrics.legacyMetrics;
  const posNegClass = (n: number) => (n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-zinc-300');
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center" onClick={() => setOpen(!open)}>
        <div>
          <div className="text-lg font-bold text-white">{symbol}</div>
          <div className="text-sm text-zinc-300 font-mono">{lm.price.toFixed(2)}</div>
        </div>
        <Badge state={metrics.state} />
      </div>
      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="text-center">
          <div className="text-zinc-400">OBI W</div>
          <div className={posNegClass(lm.obiWeighted)}>{lm.obiWeighted.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-zinc-400">ΔZ</div>
          <div className={posNegClass(lm.deltaZ)}>{lm.deltaZ.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-zinc-400">CVD Slope</div>
          <div className={posNegClass(lm.cvdSlope)}>{lm.cvdSlope.toFixed(2)}</div>
        </div>
      </div>
      {/* Collapsible advanced section */}
      {open && (
        <div className="mt-2 space-y-4 text-xs">
          {/* Depth ladder for mobile */}
          <OrderBook bids={metrics.bids} asks={metrics.asks} currentPrice={lm.price} />
          <LeftStatsPanel legacyMetrics={lm} />
          <RightStatsPanel metrics={metrics} showLatency={showLatency} />
        </div>
      )}
    </div>
  );
};

export default MobileSymbolCard;