export type VolatilityRegime = 'LOW' | 'MEDIUM' | 'HIGH';
export type TrendRegime = 'TREND_UP' | 'TREND_DOWN' | 'CHOP';

function rollingStd(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
    result.push(Math.sqrt(variance));
  }
  return result;
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * sorted.length)));
  return sorted[idx];
}

export function calculateVolatilityRegime(
  prices: number[],
  windowSize = 20,
  thresholds?: { low?: number; high?: number }
): VolatilityRegime[] {
  const returns = prices.map((p, idx) => (idx === 0 ? 0 : Math.log(p / prices[idx - 1])));
  const vols = rollingStd(returns, windowSize);
  const low = thresholds?.low ?? percentile(vols, 33);
  const high = thresholds?.high ?? percentile(vols, 66);

  return vols.map((v) => {
    if (v <= low) return 'LOW';
    if (v >= high) return 'HIGH';
    return 'MEDIUM';
  });
}

export function identifyTrendChopRegime(
  prices: number[],
  windowSize = 20,
  slopeThreshold = 0.0005
): TrendRegime[] {
  const regimes: TrendRegime[] = [];
  for (let i = 0; i < prices.length; i += 1) {
    const start = Math.max(0, i - windowSize + 1);
    const slice = prices.slice(start, i + 1);
    const first = slice[0] || prices[i];
    const last = slice[slice.length - 1] || prices[i];
    const slope = (last - first) / Math.max(1, slice.length);
    if (slope > slopeThreshold) {
      regimes.push('TREND_UP');
    } else if (slope < -slopeThreshold) {
      regimes.push('TREND_DOWN');
    } else {
      regimes.push('CHOP');
    }
  }
  return regimes;
}
