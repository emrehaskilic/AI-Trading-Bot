export interface SpotReferenceMetrics {
  symbol: string;
  midPrice: number | null;
  imbalance10: number | null;
  lastUpdated: number;
  source: 'real' | 'stale';
}

export class SpotReferenceMonitor {
  private timer: any | null = null;
  private inFlight = false;
  private metrics: SpotReferenceMetrics;

  constructor(
    private readonly symbol: string,
    private readonly intervalMs: number = Math.max(1_000, Number(process.env.SPOT_REF_INTERVAL_MS || 5_000))
  ) {
    this.metrics = {
      symbol: this.symbol,
      midPrice: null,
      imbalance10: null,
      lastUpdated: 0,
      source: 'stale',
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.fetchAndUpdate();
    }, this.intervalMs);
    void this.fetchAndUpdate();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getMetrics(): SpotReferenceMetrics {
    return { ...this.metrics };
  }

  private async fetchAndUpdate(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const now = Date.now();
    try {
      const depthUrl = `https://api.binance.com/api/v3/depth?symbol=${this.symbol}&limit=50`;
      const res = await fetch(depthUrl);
      if (!res.ok) return;
      const data: any = await res.json();
      if (!Array.isArray(data?.bids) || !Array.isArray(data?.asks)) return;

      const bids = data.bids
        .map((x: [string, string]) => [Number(x[0]), Number(x[1])] as [number, number])
        .filter((x: [number, number]) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > 0)
        .sort((a: [number, number], b: [number, number]) => b[0] - a[0]);
      const asks = data.asks
        .map((x: [string, string]) => [Number(x[0]), Number(x[1])] as [number, number])
        .filter((x: [number, number]) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > 0)
        .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);

      const bestBid = bids[0]?.[0] ?? null;
      const bestAsk = asks[0]?.[0] ?? null;
      const midPrice = (bestBid && bestAsk) ? ((bestBid + bestAsk) / 2) : null;

      const bid10 = bids.slice(0, 10).reduce((acc: number, v: [number, number]) => acc + v[1], 0);
      const ask10 = asks.slice(0, 10).reduce((acc: number, v: [number, number]) => acc + v[1], 0);
      const denom = bid10 + ask10;
      const imbalance10 = denom > 0 ? bid10 / denom : null;

      this.metrics = {
        symbol: this.symbol,
        midPrice,
        imbalance10,
        lastUpdated: now,
        source: 'real',
      };
    } catch {
      this.metrics = {
        ...this.metrics,
        source: 'stale',
      };
    } finally {
      this.inFlight = false;
    }
  }
}

