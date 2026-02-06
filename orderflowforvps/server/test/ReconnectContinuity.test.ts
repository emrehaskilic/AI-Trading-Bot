// Test reconnect continuity: CVD/delta should not reset after orderbook resync.
function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { TimeAndSales } from '../metrics/TimeAndSales';
import { CvdCalculator } from '../metrics/CvdCalculator';
import { createOrderbookState, applySnapshot, applyDepthUpdate } from '../metrics/OrderbookManager';
import { DepthCache } from '../index';

export function runTests() {
  const symbol = 'XYZ';
  const tas = new TimeAndSales(60000);
  const cvd = new CvdCalculator({ '1m': 60000 });
  const now = Date.now();
  // Initial trade
  tas.addTrade({ price: 100, quantity: 1, side: 'buy', timestamp: now });
  cvd.addTrade({ price: 100, quantity: 1, side: 'buy', timestamp: now });
  // Metrics before reconnect
  let m1 = tas.computeMetrics();
  let c1 = cvd.computeMetrics()[0];
  assert(m1.aggressiveBuyVolume === 1, 'initial buy volume');
  assert(c1.cvd === 1, 'initial CVD');
  // Simulate orderbook snapshot and gap update (disconnect)
  const ob = createOrderbookState();
  const snap: DepthCache = { lastUpdateId: 10, bids: [], asks: [], cachedAt: now };
  applySnapshot(ob, snap);
  // Apply an out-of-sequence update to simulate gap
  const gap = applyDepthUpdate(ob, { U: 15, u: 20, b: [], a: [] });
  assert(gap === false, 'gap update should fail');
  // After reconnect (new snapshot)
  const snap2: DepthCache = { lastUpdateId: 30, bids: [], asks: [], cachedAt: now + 1000 };
  applySnapshot(ob, snap2);
  // Aggregators should still report original values
  m1 = tas.computeMetrics();
  c1 = cvd.computeMetrics()[0];
  assert(m1.aggressiveBuyVolume === 1, 'buy volume persists after reconnect');
  assert(c1.cvd === 1, 'CVD persists after reconnect');
}