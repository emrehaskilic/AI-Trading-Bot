/**
 * OpenInterestMonitor tracks futures open interest metrics
 * 
 * Metrics:
 * - Current OI
 * - OI delta (change)
 * - OI trend (up/down/flat)
 * - OI volatility
 * - OI-based signals
 */

export interface OpenInterestMetrics {
  openInterest: number;        // Current OI value
  oiChangeAbs: number;         // oi_now - oi_prev
  oiChangePct: number;         // (oi_now - oi_prev) / oi_prev * 100
  oiDeltaWindow: number;       // Change over fixed window (60s)
  lastUpdated: number;         // Timestamp
  source: 'real' | 'mock';
}

type OpenInterestListener = (metrics: OpenInterestMetrics) => void;

export class OpenInterestMonitor {
  private symbol: string;
  private currentOI = 0;
  private previousOI = 0;
  private baselineOI = 0; // For 60s window
  private oiHistory: Array<{ value: number; timestamp: number }> = [];
  private lastFetchTime = 0;
  private lastBaselineUpdate = 0;
  private readonly FETCH_INTERVAL_MS = 10_000;    // Poll every 10 seconds for smoothness
  private readonly WINDOW_MS = 300_000;            // 5 minute delta window (300s)
  private readonly listeners: Set<OpenInterestListener> = new Set();

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  /**
   * Fetch latest OI from Binance API
   */
  public async updateOpenInterest(): Promise<void> {
    const now = Date.now();

    // Throttle polling - no need to spam but 60s was too slow for "live" feel
    if (now - this.lastFetchTime < this.FETCH_INTERVAL_MS && this.currentOI > 0) {
      return;
    }
    this.lastFetchTime = now; // Prevent concurrent fetches and spam

    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${this.symbol}`
      );

      if (!response.ok) {
        if (response.status !== 429) {
          console.error(`[OI] Failed fetch ${this.symbol}: ${response.status}`);
        }
        return;
      }

      const data: any = await response.json();
      const newVal = parseFloat(data.openInterest);

      if (!isNaN(newVal) && newVal > 0) {
        if (this.currentOI === 0) {
          this.baselineOI = newVal;
          this.lastBaselineUpdate = now;
        }

        this.previousOI = this.currentOI > 0 ? this.currentOI : newVal;
        this.currentOI = newVal;

        // Manage rolling history
        this.oiHistory.push({ value: newVal, timestamp: now });

        // Update baseline if window expired
        if (now - this.lastBaselineUpdate >= this.WINDOW_MS) {
          // Find the oldest record within the last 60-70 seconds
          const windowStart = now - this.WINDOW_MS;
          const baselineRecord = this.oiHistory.find(h => h.timestamp >= windowStart);
          if (baselineRecord) {
            this.baselineOI = baselineRecord.value;
            this.lastBaselineUpdate = now;
          }
        }

        // Cleanup history (keep 5 minutes)
        const cutoff = now - 300_000;
        while (this.oiHistory.length > 0 && this.oiHistory[0].timestamp < cutoff) {
          this.oiHistory.shift();
        }

        this.emitUpdate('real');
        this.lastFetchTime = now;
      }
    } catch (error) {
      console.error(`[OI] Fetch error ${this.symbol}: ${error}`);
    }
  }

  public getMetrics(): OpenInterestMetrics {
    return this.buildMetrics('real');
  }

  public update(openInterest: number): void {
    if (!Number.isFinite(openInterest) || openInterest < 0) return;
    const now = Date.now();
    if (this.currentOI === 0) this.baselineOI = openInterest;
    this.previousOI = this.currentOI > 0 ? this.currentOI : openInterest;
    this.currentOI = openInterest;
    this.oiHistory.push({ value: openInterest, timestamp: now });
    this.lastFetchTime = now;
    this.emitUpdate('mock');
  }

  public onUpdate(listener: OpenInterestListener): void {
    this.listeners.add(listener);
  }

  private buildMetrics(source: 'real' | 'mock'): OpenInterestMetrics {
    const now = Date.now();
    const windowStart = now - this.WINDOW_MS;

    // Find item closest to 60s ago
    const baselineItem = this.oiHistory.find(h => h.timestamp >= windowStart) || this.oiHistory[0];
    const baseline = baselineItem ? baselineItem.value : this.currentOI;

    const oiDeltaWindow = this.currentOI - baseline;
    const oiChangePct = baseline > 0
      ? (oiDeltaWindow / baseline) * 100
      : 0;

    return {
      openInterest: this.currentOI,
      oiChangeAbs: oiDeltaWindow, // User wants this to be the delta change
      oiChangePct: oiChangePct,
      oiDeltaWindow: oiDeltaWindow,
      lastUpdated: this.lastFetchTime || Date.now(),
      source,
    };
  }

  private emitUpdate(source: 'real' | 'mock'): void {
    const metrics = this.buildMetrics(source);
    this.listeners.forEach((l) => l(metrics));
  }
}

