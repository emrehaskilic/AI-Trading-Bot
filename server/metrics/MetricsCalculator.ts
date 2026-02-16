const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const stdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
};

export function calculateSharpeRatio(returns: number[], riskFreeRate = 0): number {
  if (returns.length < 2) return 0;
  const excess = returns.map((r) => r - riskFreeRate);
  const sd = stdDev(excess);
  if (sd === 0) return 0;
  return mean(excess) / sd;
}

export function calculateSortinoRatio(returns: number[], riskFreeRate = 0): number {
  if (returns.length < 2) return 0;
  const excess = returns.map((r) => r - riskFreeRate);
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return 0;
  const downsideDev = stdDev(downside);
  if (downsideDev === 0) return 0;
  return mean(excess) / downsideDev;
}

export function calculateVaR(returns: number[], confidenceLevel = 0.95): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const clampedConfidence = Math.max(0.5, Math.min(confidenceLevel, 0.999));
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - clampedConfidence) * sorted.length)));
  return sorted[index];
}

export function calculateCVaR(returns: number[], confidenceLevel = 0.95): number {
  if (returns.length === 0) return 0;
  const varThreshold = calculateVaR(returns, confidenceLevel);
  const tail = returns.filter((r) => r <= varThreshold);
  if (tail.length === 0) return 0;
  return mean(tail);
}
