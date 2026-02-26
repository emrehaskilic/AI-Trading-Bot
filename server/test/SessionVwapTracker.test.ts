function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, epsilon: number, message: string) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}. expected=${expected}, actual=${actual}`);
  }
}

import { SessionVwapTracker } from '../metrics/SessionVwapTracker';

export function runTests() {
  const tracker = new SessionVwapTracker();

  const londonTradeTs = Date.UTC(2026, 0, 15, 9, 0, 0, 0);
  tracker.update(londonTradeTs, 100, 1);
  tracker.update(londonTradeTs + 1000, 101, 1);

  const snap = tracker.snapshot(londonTradeTs + 2_000, 101);
  assert(snap.name === 'london', 'session should be london');
  assert(snap.sessionStartMs === Date.UTC(2026, 0, 15, 8, 0, 0, 0), 'london session must start at 08:00 UTC');
  assert(snap.elapsedMs >= (60 * 60 * 1000), 'elapsed should be at least 60 minutes');
  assert(snap.value != null, 'session VWAP should exist after trades');
  assert(snap.priceDistanceBps != null, 'price distance bps should exist');
  assert(snap.sessionRangePct != null, 'session range percent should exist');
  assertNear(Number(snap.value), 100.5, 1e-9, 'session vwap mismatch');
  assertNear(Number(snap.priceDistanceBps), ((101 - 100.5) / 100.5) * 10_000, 1e-6, 'session distance bps mismatch');
  assertNear(Number(snap.sessionRangePct), 1, 1e-9, 'session range percent mismatch');

  // A1-equivalent deterministic check: 3 trades weighted VWAP must match tracker snapshot.
  const tA1 = new SessionVwapTracker();
  const a1Trades = [
    { ts: Date.UTC(2026, 1, 26, 12, 0, 0, 0), price: 68133, qty: 0.008 },
    { ts: Date.UTC(2026, 1, 26, 12, 0, 0, 157), price: 68132.9, qty: 0.3 },
    { ts: Date.UTC(2026, 1, 26, 12, 0, 1, 216), price: 68133, qty: 0.024 },
  ];
  let cumPV = 0;
  let cumVol = 0;
  for (const tr of a1Trades) {
    tA1.update(tr.ts, tr.price, tr.qty);
    cumPV += tr.price * tr.qty;
    cumVol += tr.qty;
  }
  const vwapCalc = cumPV / cumVol;
  const snapA1 = tA1.snapshot(a1Trades[a1Trades.length - 1].ts, a1Trades[a1Trades.length - 1].price);
  assert(snapA1.value != null, 'A1 tracker snapshot value missing');
  const diffBps = Math.abs(((vwapCalc - Number(snapA1.value)) / Number(snapA1.value)) * 10_000);
  assert(diffBps <= 0.5, `A1 diff must be <= 0.5 bps, got ${diffBps}`);

  const lastLondonTs = Date.UTC(2026, 0, 15, 15, 59, 0, 0);
  tracker.update(lastLondonTs, 110, 1);
  const preReset = tracker.snapshot(lastLondonTs, 110);
  assert(preReset.name === 'london', 'pre-reset session should stay london');
  assert(preReset.value != null, 'pre-reset value should exist');

  const nyTs = Date.UTC(2026, 0, 15, 16, 1, 0, 0);
  const reset = tracker.snapshot(nyTs, 110);
  assert(reset.name === 'ny', 'session must switch to ny at 16:00 UTC');
  assert(reset.sessionStartMs === Date.UTC(2026, 0, 15, 16, 0, 0, 0), 'ny session start mismatch');
  assert(reset.value == null, 'new session should reset VWAP before first trade');
  assert(reset.sessionHigh == null, 'new session should reset high');
  assert(reset.sessionLow == null, 'new session should reset low');
}
