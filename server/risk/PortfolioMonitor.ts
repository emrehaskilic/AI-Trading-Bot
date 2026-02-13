export interface CorrelationMatrix {
  symbols: string[];
  values: number[][];
}

export interface PortfolioSnapshot {
  updatedAt: number;
  correlation: CorrelationMatrix;
  betas: Record<string, number>;
  netDeltaBySymbol: Record<string, number>;
  totalNetDelta: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const sliceA = a.slice(a.length - n);
  const sliceB = b.slice(b.length - n);
  const meanA = mean(sliceA);
  const meanB = mean(sliceB);
  let cov = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (sliceA[i] - meanA) * (sliceB[i] - meanB);
  }
  cov /= n;
  const stdA = std(sliceA);
  const stdB = std(sliceB);
  if (stdA === 0 || stdB === 0) return 0;
  return cov / (stdA * stdB);
}

export class PortfolioMonitor {
  private readonly returns = new Map<string, number[]>();
  private readonly lastPrice = new Map<string, number>();
  private readonly windowSize: number;

  constructor(windowSize: number = 120) {
    this.windowSize = windowSize;
  }

  ingestPrice(symbol: string, price: number): void {
    if (!symbol || !(price > 0)) return;
    const prev = this.lastPrice.get(symbol);
    this.lastPrice.set(symbol, price);
    if (!(prev && prev > 0)) return;

    const ret = Math.log(price / prev);
    const series = this.returns.get(symbol) ?? [];
    series.push(ret);
    while (series.length > this.windowSize) series.shift();
    this.returns.set(symbol, series);
  }

  snapshot(exposures?: Record<string, number>): PortfolioSnapshot {
    const symbols = Array.from(this.returns.keys()).sort();
    const values: number[][] = symbols.map(() => symbols.map(() => 0));

    for (let i = 0; i < symbols.length; i += 1) {
      for (let j = 0; j < symbols.length; j += 1) {
        if (i === j) {
          values[i][j] = 1;
        } else {
          const a = this.returns.get(symbols[i]) ?? [];
          const b = this.returns.get(symbols[j]) ?? [];
          values[i][j] = Number(correlation(a, b).toFixed(3));
        }
      }
    }

    const betas: Record<string, number> = {};
    const reference = symbols[0];
    if (reference) {
      const refReturns = this.returns.get(reference) ?? [];
      const refVar = Math.pow(std(refReturns), 2);
      for (const symbol of symbols) {
        if (symbol === reference) {
          betas[symbol] = 1;
          continue;
        }
        const series = this.returns.get(symbol) ?? [];
        const corr = correlation(series, refReturns);
        const beta = refVar > 0 ? corr * (std(series) / Math.sqrt(refVar)) : 0;
        betas[symbol] = Number(beta.toFixed(3));
      }
    }

    const netDeltaBySymbol: Record<string, number> = {};
    let totalNetDelta = 0;
    if (exposures) {
      for (const [symbol, value] of Object.entries(exposures)) {
        netDeltaBySymbol[symbol] = Number(value.toFixed(2));
        totalNetDelta += value;
      }
    }

    return {
      updatedAt: Date.now(),
      correlation: { symbols, values },
      betas,
      netDeltaBySymbol,
      totalNetDelta: Number(totalNetDelta.toFixed(2)),
    };
  }
}
