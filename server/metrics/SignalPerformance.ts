export interface SignalEvent {
  timestampMs: number;
  side: 'BUY' | 'SELL';
  strength?: number;
}

export interface PricePoint {
  timestampMs: number;
  price: number;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

function findFuturePrice(prices: PricePoint[], timestampMs: number): number | null {
  let left = 0;
  let right = prices.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (prices[mid].timestampMs < timestampMs) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  const idx = Math.min(left, prices.length - 1);
  return prices[idx]?.price ?? null;
}

export function calculateSignalReturnCorrelation(
  signals: SignalEvent[],
  prices: PricePoint[],
  lookaheadMs: number
): { longCorrelation: number; shortCorrelation: number; sampleCount: number } {
  if (!signals.length || !prices.length) {
    return { longCorrelation: 0, shortCorrelation: 0, sampleCount: 0 };
  }
  const sortedPrices = [...prices].sort((a, b) => a.timestampMs - b.timestampMs);

  const longStrengths: number[] = [];
  const longReturns: number[] = [];
  const shortStrengths: number[] = [];
  const shortReturns: number[] = [];

  signals.forEach((signal) => {
    const priceAtSignal = findFuturePrice(sortedPrices, signal.timestampMs);
    const priceAtFuture = findFuturePrice(sortedPrices, signal.timestampMs + lookaheadMs);
    if (!priceAtSignal || !priceAtFuture) return;
    const futureReturn = (priceAtFuture - priceAtSignal) / priceAtSignal;
    const strength = Number.isFinite(signal.strength as number) ? (signal.strength as number) : 1;
    if (signal.side === 'BUY') {
      longStrengths.push(strength);
      longReturns.push(futureReturn);
    } else {
      shortStrengths.push(strength);
      shortReturns.push(-futureReturn);
    }
  });

  return {
    longCorrelation: pearsonCorrelation(longStrengths, longReturns),
    shortCorrelation: pearsonCorrelation(shortStrengths, shortReturns),
    sampleCount: longStrengths.length + shortStrengths.length,
  };
}
