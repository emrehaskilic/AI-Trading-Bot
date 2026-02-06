// Minimal assertion helper to avoid dependency on Node assert module
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}
import { LegacyCalculator } from '../metrics/LegacyCalculator';
import { createOrderbookState } from '../metrics/OrderbookManager';

export function runTests() {
  // Test OBI weighted and deep using a small synthetic orderbook
  const ob = createOrderbookState();
  // Bids at 100:10 and 99:5, asks at 101:7 and 102:3
  ob.bids.set(100, 10);
  ob.bids.set(99, 5);
  ob.asks.set(101, 7);
  ob.asks.set(102, 3);
  const legacy = new LegacyCalculator();
  const metrics = legacy.computeMetrics(ob);
  // Weighted OBI and deep OBI should be identical for this tiny book
  const expectedObi = (10 + 5) - (7 + 3); // 15 - 10 = 5
  assert(metrics.obiWeighted === expectedObi, 'OBI weighted should equal sum(bids) - sum(asks)');
  assert(metrics.obiDeep === expectedObi, 'OBI deep should equal weighted for small depth');
  assert(metrics.obiDivergence === 0, 'OBI divergence should be zero when weighted and deep are equal');

  // Prepare trades for delta windows, VWAP and CVD session tests
  const now = Date.now();
  // Add three trades: buy 2 at t-500ms, sell 1 at t-400ms, buy 3 at t-4000ms
  legacy.addTrade({ price: 100, quantity: 2, side: 'buy', timestamp: now - 500 });
  legacy.addTrade({ price: 101, quantity: 1, side: 'sell', timestamp: now - 400 });
  legacy.addTrade({ price: 99, quantity: 3, side: 'buy', timestamp: now - 4000 });

  // Override Date.now temporarily for deterministic windows
  const originalNow = Date.now;
  (Date as any).now = () => now;
  const metrics2 = legacy.computeMetrics(ob);
  // Restore Date.now
  (Date as any).now = originalNow;

  // Delta 1s: last 1 second includes first two trades (buy 2, sell 1) -> net +1
  assert(metrics2.delta1s === 1, 'delta1s should be net volume in last 1s');
  // Delta 5s: last 5 seconds includes all three trades -> +2 -1 +3 = +4
  assert(metrics2.delta5s === 4, 'delta5s should be net volume in last 5s');
  // VWAP: total notional / total volume
  const totalNotional = 2 * 100 + 1 * 101 + 3 * 99; // = 598
  const totalVol = 2 + 1 + 3; // = 6
  const expectedVwap = totalNotional / totalVol;
  assert(Math.abs(metrics2.vwap - expectedVwap) < 1e-6, 'VWAP should equal notional/volume');
  // CVD session: buy volume minus sell volume -> 2+3 - 1 = 4
  assert(metrics2.cvdSession === 4, 'CVD session should accumulate buy minus sell quantities');
}