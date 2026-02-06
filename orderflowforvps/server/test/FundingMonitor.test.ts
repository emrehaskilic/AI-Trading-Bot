// Minimal assertion helper
function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { FundingMonitor } from '../metrics/FundingMonitor';

/**
 * Tests for the FundingMonitor.  We manually call update() to
 * simulate funding rate changes and verify trend and time to next
 * funding calculations.
 */
export function runTests() {
  const mon = new FundingMonitor('BTCUSDT');
  let received: any = null;
  mon.onUpdate(m => {
    received = m;
  });
  const now = Date.now();
  // First update: no trend (flat)
  mon.update(0.0001, now + 3600000); // funding in 1h
  assert(received.rate === 0.0001, 'funding rate value');
  assert(received.trend === 'flat', 'first trend flat');
  // timeToFundingMs should be approx 3600000 (allow some tolerance)
  assert(received.timeToFundingMs > 3599000 && received.timeToFundingMs <= 3600000, 'time to funding around 1h');
  // Second update: rate goes up -> trend up
  mon.update(0.0002, now + 7200000);
  assert(received.trend === 'up', 'trend up when rate increases');
}