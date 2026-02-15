export interface ExecutionLog {
  side: 'BUY' | 'SELL';
  requestedPrice: number;
  filledPrice: number;
  quantity: number;
  spreadBps?: number;
}

export interface SpreadPerformance {
  bucket: 'TIGHT' | 'MEDIUM' | 'WIDE';
  avgPnl: number;
  winRate: number;
  tradeCount: number;
}

export interface SizePerformance {
  bucket: 'SMALL' | 'MEDIUM' | 'LARGE';
  avgPnl: number;
  avgSlippageBps: number;
  tradeCount: number;
}

function slippageBps(side: 'BUY' | 'SELL', requested: number, filled: number): number {
  if (!(requested > 0)) return 0;
  const raw = side === 'BUY'
    ? ((filled - requested) / requested) * 10000
    : ((requested - filled) / requested) * 10000;
  return raw;
}

export function calculateSlippage(logs: ExecutionLog[]): { averageBps: number; medianBps: number } {
  if (!logs.length) return { averageBps: 0, medianBps: 0 };
  const slippages = logs.map((log) => slippageBps(log.side, log.requestedPrice, log.filledPrice));
  const avg = slippages.reduce((a, b) => a + b, 0) / slippages.length;
  const sorted = [...slippages].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { averageBps: avg, medianBps: median };
}

export function analyzePerformanceBySpread(trades: Array<{ pnl: number; spreadBps: number }>): SpreadPerformance[] {
  if (!trades.length) return [];
  const spreads = trades.map((t) => t.spreadBps).sort((a, b) => a - b);
  const p33 = spreads[Math.floor(spreads.length * 0.33)] ?? 0;
  const p66 = spreads[Math.floor(spreads.length * 0.66)] ?? 0;

  const buckets: Record<'TIGHT' | 'MEDIUM' | 'WIDE', { pnl: number[] }> = {
    TIGHT: { pnl: [] },
    MEDIUM: { pnl: [] },
    WIDE: { pnl: [] },
  };

  trades.forEach((trade) => {
    if (trade.spreadBps <= p33) buckets.TIGHT.pnl.push(trade.pnl);
    else if (trade.spreadBps <= p66) buckets.MEDIUM.pnl.push(trade.pnl);
    else buckets.WIDE.pnl.push(trade.pnl);
  });

  return (Object.keys(buckets) as Array<'TIGHT' | 'MEDIUM' | 'WIDE'>).map((bucket) => {
    const pnl = buckets[bucket].pnl;
    const avgPnl = pnl.length ? pnl.reduce((a, b) => a + b, 0) / pnl.length : 0;
    const wins = pnl.filter((v) => v > 0).length;
    return {
      bucket,
      avgPnl,
      winRate: pnl.length ? wins / pnl.length : 0,
      tradeCount: pnl.length,
    };
  });
}

export function analyzePerformanceByOrderSize(trades: Array<{ pnl: number; quantity: number; slippageBps: number }>): SizePerformance[] {
  if (!trades.length) return [];
  const sizes = trades.map((t) => t.quantity).sort((a, b) => a - b);
  const p33 = sizes[Math.floor(sizes.length * 0.33)] ?? 0;
  const p66 = sizes[Math.floor(sizes.length * 0.66)] ?? 0;

  const buckets: Record<'SMALL' | 'MEDIUM' | 'LARGE', Array<{ pnl: number; slippageBps: number }>> = {
    SMALL: [],
    MEDIUM: [],
    LARGE: [],
  };

  trades.forEach((trade) => {
    if (trade.quantity <= p33) buckets.SMALL.push(trade);
    else if (trade.quantity <= p66) buckets.MEDIUM.push(trade);
    else buckets.LARGE.push(trade);
  });

  return (Object.keys(buckets) as Array<'SMALL' | 'MEDIUM' | 'LARGE'>).map((bucket) => {
    const data = buckets[bucket];
    const avgPnl = data.length ? data.reduce((a, b) => a + b.pnl, 0) / data.length : 0;
    const avgSlippage = data.length ? data.reduce((a, b) => a + b.slippageBps, 0) / data.length : 0;
    return {
      bucket,
      avgPnl,
      avgSlippageBps: avgSlippage,
      tradeCount: data.length,
    };
  });
}
