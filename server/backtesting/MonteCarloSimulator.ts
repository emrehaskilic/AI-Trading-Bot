import { MonteCarloConfig, MonteCarloResult } from './types';

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const avg = returns.reduce((acc, v) => acc + v, 0) / returns.length;
  const variance = returns.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (avg / std) * Math.sqrt(252);
}

function computeMaxDrawdown(pnlCurve: number[]): number {
  let peak = 0;
  let maxDd = 0;
  for (const pnl of pnlCurve) {
    peak = Math.max(peak, pnl);
    maxDd = Math.max(maxDd, peak - pnl);
  }
  return maxDd;
}

export function generateRandomTrades(returnsSeries: number[], numTrades: number): number[] {
  if (!returnsSeries.length || numTrades <= 0) return [];
  const trades: number[] = [];
  for (let i = 0; i < numTrades; i += 1) {
    const idx = Math.floor(Math.random() * returnsSeries.length);
    trades.push(returnsSeries[idx]);
  }
  return trades;
}

export function calculateRiskOfRuin(
  tradePnLs: number[],
  initialCapital: number,
  ruinThreshold: number,
  numRuns = 1000
): number {
  if (!tradePnLs.length || initialCapital <= 0) return 0;
  let ruinCount = 0;
  for (let i = 0; i < numRuns; i += 1) {
    let equity = initialCapital;
    for (let j = 0; j < tradePnLs.length; j += 1) {
      const idx = Math.floor(Math.random() * tradePnLs.length);
      equity += tradePnLs[idx];
      if (equity <= initialCapital * (1 - ruinThreshold)) {
        ruinCount += 1;
        break;
      }
    }
  }
  return ruinCount / numRuns;
}

export class MonteCarloSimulator {
  constructor(private readonly config: MonteCarloConfig) {}

  run(returnsSeries: number[]): MonteCarloResult[] {
    const results: MonteCarloResult[] = [];
    const runs = Math.max(1, Math.trunc(this.config.runs));
    if (returnsSeries.length === 0) {
      return results;
    }
    const seed = Number.isFinite(this.config.seed as number) ? Number(this.config.seed) : Date.now();

    for (let i = 0; i < runs; i += 1) {
      let pnl = 0;
      const pnlCurve: number[] = [];
      const sampled: number[] = [];
      for (let j = 0; j < returnsSeries.length; j += 1) {
        const idx = Math.abs(Math.floor((seed + i * 997 + j * 131) % returnsSeries.length));
        const r = returnsSeries[idx];
        pnl += r;
        sampled.push(r);
        pnlCurve.push(pnl);
      }
      const sharpe = computeSharpe(sampled);
      const maxDd = computeMaxDrawdown(pnlCurve);
      results.push({
        runId: i,
        totalPnL: Number(pnl.toFixed(6)),
        maxDrawdown: Number(maxDd.toFixed(6)),
        sharpeRatio: Number(sharpe.toFixed(4)),
      });
    }

    return results;
  }
}
