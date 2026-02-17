/**
 * Multi-timeframe Delta and CVD computation.
 *
 * This module consumes trade events (identical to those used by
 * TimeAndSales) and aggregates them into rolling windows of
 * configurable durations. For each timeframe it maintains a
 * cumulative volume delta (CVD) and the net delta (buy minus sell)
 * over the window.
 */

import { TradeEvent } from './TimeAndSales';

export interface CvdMetrics {
  timeframe: string;
  cvd: number;
  delta: number;
}

interface StoredCvdTrade extends TradeEvent {
  arrival: number;
  price: number;
}

interface TimeframeStore {
  windowMs: number;
  trades: StoredCvdTrade[];
  head: number;
}

export class CvdCalculator {
  private readonly stores: Map<string, TimeframeStore> = new Map();

  constructor(timeframes: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000 }) {
    for (const [tf, ms] of Object.entries(timeframes)) {
      this.stores.set(tf, { windowMs: ms, trades: [], head: 0 });
    }
  }

  /**
   * Add a trade event to all tracked timeframes.
   */
  public addTrade(event: TradeEvent & { price: number }): void {
    const arrival = Date.now();
    const signedQty = event.side === 'buy' ? event.quantity : -event.quantity;

    for (const store of this.stores.values()) {
      store.trades.push({ ...event, quantity: signedQty, arrival, price: event.price });
      this.pruneExpired(store, event.timestamp - store.windowMs);
    }
  }

  /**
   * Get trade counts for each timeframe and warmup percentage.
   */
  public getTradeCounts(): Record<string, { count: number; warmUpPct: number }> {
    const counts: Record<string, { count: number; warmUpPct: number }> = {};
    const now = Date.now();

    for (const [tf, store] of this.stores.entries()) {
      const count = this.activeCount(store);
      let warmUpPct = 0;

      if (count > 0) {
        const oldest = store.trades[store.head].timestamp;
        const span = now - oldest;
        warmUpPct = Math.min(100, Math.round((span / store.windowMs) * 100));
      }

      counts[tf] = { count, warmUpPct };
    }
    return counts;
  }

  /**
   * Compute CVD metrics for all timeframes.
   */
  public computeMetrics(): CvdMetrics[] {
    const results: CvdMetrics[] = [];

    for (const [tf, store] of this.stores.entries()) {
      let cvd = 0;
      const arr = store.trades;
      for (let i = store.head; i < arr.length; i += 1) {
        cvd += arr[i].quantity;
      }
      results.push({ timeframe: tf, cvd, delta: cvd });
    }

    return results;
  }

  private activeCount(store: TimeframeStore): number {
    return Math.max(0, store.trades.length - store.head);
  }

  private pruneExpired(store: TimeframeStore, cutoffTs: number): void {
    const arr = store.trades;
    while (store.head < arr.length && arr[store.head].timestamp < cutoffTs) {
      store.head += 1;
    }

    // Compact occasionally to avoid unbounded memory growth.
    if (store.head > 0 && (store.head >= 4096 || store.head > (arr.length >> 1))) {
      store.trades = arr.slice(store.head);
      store.head = 0;
    }
  }
}
