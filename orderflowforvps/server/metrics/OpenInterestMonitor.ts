/**
 * Open Interest monitor.
 *
 * This class periodically fetches the open interest for a futures
 * symbol from Binance and computes both the absolute value and the
 * delta from the previous reading.  Consumers can subscribe to
 * updates via a callback.  For the purposes of unit testing the
 * `update()` method can be called manually with synthetic data.
 */

export interface OpenInterestMetrics {
  symbol: string;
  openInterest: number;
  delta: number;
}

type Listener = (metrics: OpenInterestMetrics) => void;

export class OpenInterestMonitor {
  private lastValue: number | null = null;
  private readonly listeners: Set<Listener> = new Set();
  private readonly symbol: string;
  private readonly intervalMs: number;
  // Timer handle for periodic polling.  We avoid referring to NodeJS
  // types directly to allow compilation in non‑Node environments.
  private timer: any | null = null;

  constructor(symbol: string, intervalMs: number = 60_000) {
    this.symbol = symbol.toUpperCase();
    this.intervalMs = intervalMs;
  }

  /**
   * Start periodic updates.  This uses fetch to call the Binance
   * endpoint.  In environments without network access this can be
   * unused, and `update()` can be called manually.
   */
  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.fetchAndUpdate().catch(() => {}), this.intervalMs);
    // Immediately fetch once
    this.fetchAndUpdate().catch(() => {});
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Manual update hook for testing.  Provide the latest open
   * interest value (as a number); the delta will be computed and
   * listeners will be notified.
   */
  public update(value: number) {
    const delta = this.lastValue === null ? 0 : value - this.lastValue;
    this.lastValue = value;
    const metrics: OpenInterestMetrics = { symbol: this.symbol, openInterest: value, delta };
    this.listeners.forEach(listener => listener(metrics));
  }

  /**
   * Subscribe to metrics updates.
   */
  public onUpdate(listener: Listener) {
    this.listeners.add(listener);
  }

  /**
   * Internal: fetch from Binance API and update listeners.
   */
  private async fetchAndUpdate(): Promise<void> {
    const url = `https://fapi.binance.com/futures/data/openInterest?symbol=${this.symbol}`;
    const res = await fetch(url);
    const text = await res.text();
    const val = parseFloat(text);
    if (!isNaN(val)) {
      this.update(val);
    }
  }
}