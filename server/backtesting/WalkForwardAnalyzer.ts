import { WalkForwardConfig, WalkForwardReport } from './types';

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const avg = returns.reduce((acc, v) => acc + v, 0) / returns.length;
  const variance = returns.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (avg / std) * Math.sqrt(252);
}

function simulateStrategy(returns: number[], threshold: number): number[] {
  let pnl = 0;
  const pnlCurve: number[] = [];
  for (const r of returns) {
    if (Math.abs(r) >= threshold) {
      pnl += r;
    }
    pnlCurve.push(pnl);
  }
  return pnlCurve;
}

export class WalkForwardAnalyzer {
  constructor(private readonly config: WalkForwardConfig) {}

  run(returnsSeries: number[]): WalkForwardReport[] {
    const reports: WalkForwardReport[] = [];
    const windowSize = Math.max(10, this.config.windowSize);
    const step = Math.max(1, this.config.stepSize);
    const range = this.config.thresholdRange;
    const stepSize = Math.max(1e-6, range.step);

    let windowId = 0;
    for (let start = 0; start + windowSize * 2 <= returnsSeries.length; start += step) {
      windowId += 1;
      const inSample = returnsSeries.slice(start, start + windowSize);
      const outSample = returnsSeries.slice(start + windowSize, start + windowSize * 2);

      let bestThreshold = range.min;
      let bestSharpe = -Infinity;

      for (let t = range.min; t <= range.max; t += stepSize) {
        const pnlCurve = simulateStrategy(inSample, t);
        const returns = pnlCurve.map((p, idx) => (idx === 0 ? 0 : p - pnlCurve[idx - 1]));
        const sharpe = computeSharpe(returns);
        if (sharpe > bestSharpe) {
          bestSharpe = sharpe;
          bestThreshold = t;
        }
      }

      const inCurve = simulateStrategy(inSample, bestThreshold);
      const outCurve = simulateStrategy(outSample, bestThreshold);
      const inSharpe = computeSharpe(inCurve.map((p, idx) => (idx === 0 ? 0 : p - inCurve[idx - 1])));
      const outSharpe = computeSharpe(outCurve.map((p, idx) => (idx === 0 ? 0 : p - outCurve[idx - 1])));

      reports.push({
        windowId,
        inSampleSharpe: Number(inSharpe.toFixed(4)),
        outSampleSharpe: Number(outSharpe.toFixed(4)),
        optimalThreshold: Number(bestThreshold.toFixed(6)),
        overfittingDetected: inSharpe > outSharpe * 1.5,
      });
    }

    return reports;
  }
}
