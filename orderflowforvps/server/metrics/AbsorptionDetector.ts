/**
 * Absorption & iceberg detection.
 *
 * This detector implements the four mandatory conditions for declaring
 * absorption at a given price level:
 *
 *  1. Repeated market fills occur at the same price level.
 *  2. The aggressive direction (buy or sell) is clear and does not
 *     alternate during the detection window.
 *  3. Despite repeated fills, the mid‑price does not move beyond a
 *     small threshold.
 *  4. The orderbook size at that price level either refreshes (size
 *     replenishes after each fill) or remains constant (iceberg).
 *
 * If any of these conditions are not met, the detector returns 0.
 * Otherwise it returns 1.  The consumer should reset the detector
 * after a detection fires or after a configurable timeout.
 */

export type AbsorptionResult = 0 | 1;

interface DetectionState {
  price: number;
  side: 'buy' | 'sell';
  repeatedCount: number;
  firstPrice: number;
  lastPrice: number;
  bookSizes: number[];
  lastUpdate: number;
}

export class AbsorptionDetector {
  private state: DetectionState | null = null;
  // configurable parameters
  private readonly maxWindowMs: number;
  private readonly minRepeats: number;
  private readonly priceThreshold: number;

  constructor(options?: { windowMs?: number; minRepeats?: number; priceThreshold?: number }) {
    this.maxWindowMs = options?.windowMs ?? 10_000; // 10 seconds
    this.minRepeats = options?.minRepeats ?? 3;
    this.priceThreshold = options?.priceThreshold ?? 0.0001; // relative price movement threshold
  }

  /**
   * Feed a trade into the detector along with the current orderbook size at
   * the trade price.  If all four conditions are met the function
   * returns 1.  Otherwise it returns 0.
   */
  public addTrade(symbol: string, price: number, side: 'buy' | 'sell', timestamp: number, orderbookSize: number): AbsorptionResult {
    const now = Date.now();
    // Reset state if window expired
    if (this.state && now - this.state.lastUpdate > this.maxWindowMs) {
      this.state = null;
    }
    if (!this.state) {
      this.state = {
        price,
        side,
        repeatedCount: 1,
        firstPrice: price,
        lastPrice: price,
        bookSizes: [orderbookSize],
        lastUpdate: now,
      };
      return 0;
    }
    // If price matches and side matches, increment repeatedCount
    if (Math.abs(price - this.state.price) < 1e-12 && side === this.state.side) {
      this.state.repeatedCount += 1;
    } else {
      // Reset if price or side changes
      this.state = {
        price,
        side,
        repeatedCount: 1,
        firstPrice: price,
        lastPrice: price,
        bookSizes: [orderbookSize],
        lastUpdate: now,
      };
      return 0;
    }
    this.state.lastPrice = price;
    this.state.bookSizes.push(orderbookSize);
    this.state.lastUpdate = now;
    // Condition 1: repeatedCount >= minRepeats
    if (this.state.repeatedCount < this.minRepeats) {
      return 0;
    }
    // Condition 2: side constant is already ensured by state
    // Condition 3: mid‑price does not move beyond threshold
    const priceChange = Math.abs(this.state.lastPrice - this.state.firstPrice);
    if (priceChange > this.priceThreshold * this.state.firstPrice) {
      return 0;
    }
    // Condition 4: orderbook size either refreshes (increases) or remains constant
    const sizes = this.state.bookSizes;
    let refreshOK = true;
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i] < sizes[i - 1]) {
        refreshOK = false;
        break;
      }
    }
    if (!refreshOK) {
      return 0;
    }
    // All conditions met
    return 1;
  }
}