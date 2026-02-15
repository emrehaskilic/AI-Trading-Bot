function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

export function tTestPValue(samples: number[]): number {
  if (samples.length < 2) return 1;
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 1;
  const tStat = mean / (std / Math.sqrt(n));
  const p = 2 * (1 - normalCdf(Math.abs(tStat)));
  return Math.max(0, Math.min(1, p));
}

export function bootstrapMeanCI(samples: number[], iterations = 1000, alpha = 0.05): { lower: number; upper: number } {
  if (!samples.length) return { lower: 0, upper: 0 };
  const means: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < samples.length; j += 1) {
      const idx = Math.floor(Math.random() * samples.length);
      sum += samples[idx];
    }
    means.push(sum / samples.length);
  }
  means.sort((a, b) => a - b);
  const lowerIdx = Math.floor((alpha / 2) * means.length);
  const upperIdx = Math.floor((1 - alpha / 2) * means.length);
  return { lower: means[lowerIdx] ?? means[0], upper: means[upperIdx] ?? means[means.length - 1] };
}
