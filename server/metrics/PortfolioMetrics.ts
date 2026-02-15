export interface ReturnDistribution {
  mean: number;
  min: number;
  max: number;
  histogram: Array<{ min: number; max: number; count: number }>;
}

export interface DrawdownClusteringReport {
  maxDrawdown: number;
  averageDrawdownDuration: number;
  drawdownCount: number;
}

export function calculateReturnDistribution(returns: number[], bins = 20): ReturnDistribution {
  if (!returns.length) {
    return { mean: 0, min: 0, max: 0, histogram: [] };
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const min = Math.min(...returns);
  const max = Math.max(...returns);
  const range = max - min || 1;
  const size = range / bins;
  const histogram = Array.from({ length: bins }, (_, idx) => ({
    min: min + idx * size,
    max: min + (idx + 1) * size,
    count: 0,
  }));
  returns.forEach((r) => {
    const idx = Math.min(bins - 1, Math.floor((r - min) / size));
    histogram[idx].count += 1;
  });
  return { mean, min, max, histogram };
}

export function calculateSkewnessKurtosis(returns: number[]): { skewness: number; kurtosis: number } {
  if (returns.length < 2) {
    return { skewness: 0, kurtosis: 0 };
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const diffs = returns.map((r) => r - mean);
  const variance = diffs.reduce((a, b) => a + b * b, 0) / returns.length;
  const std = Math.sqrt(variance) || 1;
  const skewness = diffs.reduce((a, b) => a + Math.pow(b / std, 3), 0) / returns.length;
  const kurtosis = diffs.reduce((a, b) => a + Math.pow(b / std, 4), 0) / returns.length;
  return { skewness, kurtosis };
}

export function analyzeDrawdownClustering(equityCurve: number[]): DrawdownClusteringReport {
  if (!equityCurve.length) {
    return { maxDrawdown: 0, averageDrawdownDuration: 0, drawdownCount: 0 };
  }
  let peak = equityCurve[0];
  let maxDrawdown = 0;
  let drawdownStart = -1;
  const durations: number[] = [];

  equityCurve.forEach((value, idx) => {
    if (value >= peak) {
      if (drawdownStart >= 0) {
        durations.push(idx - drawdownStart);
        drawdownStart = -1;
      }
      peak = value;
    } else {
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      if (drawdownStart < 0) drawdownStart = idx;
    }
  });

  if (drawdownStart >= 0) {
    durations.push(equityCurve.length - drawdownStart);
  }

  const averageDrawdownDuration = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  return {
    maxDrawdown,
    averageDrawdownDuration,
    drawdownCount: durations.length,
  };
}
