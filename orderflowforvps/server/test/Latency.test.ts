// Test for latency clamp: avgLatencyMs should never be negative.
function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { TimeAndSales } from '../metrics/TimeAndSales';

export function runTests() {
  const tas = new TimeAndSales(10_000);
  const now = Date.now();
  // Create a trade whose event time is in the future by 10 seconds.
  tas.addTrade({ price: 100, quantity: 1, side: 'buy', timestamp: now + 10_000 });
  const metrics = tas.computeMetrics();
  assert(metrics.avgLatencyMs === 0, `avgLatencyMs should clamp to 0, got ${metrics.avgLatencyMs}`);
}