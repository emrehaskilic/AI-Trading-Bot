/**
 * Multi‑timeframe Delta and CVD computation.
 *
 * This module consumes trade events (identical to those used by
 * TimeAndSales) and aggregates them into rolling windows of
 * configurable durations.  For each timeframe it maintains a
 * cumulative volume delta (CVD) and the net delta (buy minus sell)
 * over the window.  It also provides a basic exhaustion indicator
 * which triggers when the CVD continues to rise (or fall) while the
 * last trade price fails to make new highs (or lows).  This
 * exhaustion flag is a heuristic and should be supplemented by
 * additional context (e.g. liquidity levels) before making trading
 * decisions.
 */

import { AggressiveSide, TradeEvent } from './TimeAndSales';

export interface CvdMetrics {
  timeframe: string;
  /**
   * Cumulative volume delta (sum of buyQty minus sellQty) over the
   * timeframe.  Positive values indicate net buying pressure.
   */
  cvd: number;
  /**
   * Net delta within the window (identical to `cvd` as we do not
   * normalise by window size).  Provided for clarity.
   */
  delta: number;
  /**
   * Exhaustion flag.  Set to true when delta continues to rise (for
   * buys) or fall (for sells) but the last trade price has not
   * exceeded the extremum seen within the window.  This is a simple
   * implementation; consumers are free to ignore it or implement more
   * sophisticated logic.
   */
  exhaustion: boolean;
}

interface StoredCvdTrade extends TradeEvent {
  arrival: number;
  price: number;
}

export class CvdCalculator {
  private readonly windows: Map<string, number> = new Map();
  private readonly trades: Map<string, StoredCvdTrade[]> = new Map();

  constructor(timeframes: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000 }) {
    for (const [tf, ms] of Object.entries(timeframes)) {
      this.windows.set(tf, ms);
      this.trades.set(tf, []);
    }
  }

  /**
   * Add a trade event to all tracked timeframes.  The `price` field
   * should represent the trade price.  The `timestamp` should be the
   * event time as reported by the exchange.
   */
  public addTrade(event: TradeEvent & { price: number }): void {
    const arrival = Date.now();
    // Normalise side to numeric delta: buy=+quantity, sell=−quantity
    const signedQty = event.side === 'buy' ? event.quantity : -event.quantity;
    for (const [tf, ms] of this.windows.entries()) {
      const arr = this.trades.get(tf)!;
      arr.push({ ...event, quantity: signedQty, arrival, price: event.price });
      // Remove expired trades
      const cutoff = event.timestamp - ms;
      this.trades.set(tf, arr.filter(t => t.timestamp >= cutoff));
    }
  }

  /**
   * Compute CVD metrics for all timeframes.  If no trades exist
   * within a timeframe the corresponding metrics will be zero.
   */
  public computeMetrics(): CvdMetrics[] {
    const results: CvdMetrics[] = [];
    for (const [tf, _ms] of this.windows.entries()) {
      const arr = this.trades.get(tf)!;
      let cvd = 0;
      let maxPrice = -Infinity;
      let minPrice = Infinity;
      let lastPrice = NaN;
      for (const t of arr) {
        cvd += t.quantity;
        if (t.price > maxPrice) maxPrice = t.price;
        if (t.price < minPrice) minPrice = t.price;
        lastPrice = t.price;
      }
      const delta = cvd;
      let exhaustion = false;
      if (arr.length > 0) {
        // If delta is positive (buying pressure) but last price has not
        // surpassed the maximum within the window, we flag exhaustion.
        if (delta > 0 && lastPrice < maxPrice) {
          exhaustion = true;
        }
        // Conversely, if delta is negative (selling pressure) but last
        // price has not breached the minimum, flag exhaustion.
        if (delta < 0 && lastPrice > minPrice) {
          exhaustion = true;
        }
      }
      results.push({ timeframe: tf, cvd, delta, exhaustion });
    }
    return results;
  }
}