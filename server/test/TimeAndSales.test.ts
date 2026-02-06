// Minimal assertion helper to avoid relying on Node's built‑in assert
function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
import { TimeAndSales } from '../metrics/TimeAndSales';

/**
 * Unit tests for the TimeAndSales aggregator.  These tests cover
 * volume aggregation, trade size distribution and burst detection.  To
 * execute them run `npm test` from the root of the repository.
 */

export function runTests() {
  const tas = new TimeAndSales(10_000); // 10 second window for testing

  // Simulate a sequence of trades at time t0
  const t0 = Date.now();
  tas.addTrade({ price: 100, quantity: 1, side: 'buy', timestamp: t0 });
  tas.addTrade({ price: 101, quantity: 2, side: 'buy', timestamp: t0 + 100 });
  tas.addTrade({ price: 99, quantity: 3, side: 'sell', timestamp: t0 + 200 });

  let metrics = tas.computeMetrics();
  assert(metrics.aggressiveBuyVolume === 3, 'buy volume should sum to 3');
  assert(metrics.aggressiveSellVolume === 3, 'sell volume should sum to 3');
  assert(metrics.tradeCount === 3, 'trade count should be 3');
  assert(metrics.consecutiveBurst.count === 1, 'burst count resets on side change');

  // Add more trades in the same direction to test burst increment
  tas.addTrade({ price: 98, quantity: 0.5, side: 'sell', timestamp: t0 + 300 });
  tas.addTrade({ price: 97, quantity: 0.5, side: 'sell', timestamp: t0 + 400 });
  metrics = tas.computeMetrics();
  assert(metrics.consecutiveBurst.side === 'sell', 'burst side should be sell');
  assert(metrics.consecutiveBurst.count >= 2, 'burst count should increment for consecutive sells');

  // Test size distribution with thresholds
  // There are now trades with quantities [1,2,3,0.5,0.5] -> thresholds computed from quantiles
  assert(metrics.smallTrades + metrics.midTrades + metrics.largeTrades === metrics.tradeCount, 'size distribution should sum to trade count');

}