function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, epsilon: number, message: string) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}. expected=${expected}, actual=${actual}`);
  }
}

import { deriveHtfFrameMetricsFromKlines } from '../metrics/HtfStructureMonitor';

export function runTests() {
  const klines = [
    { openTimeMs: 1_000, high: 100, low: 97, close: 98 },
    { openTimeMs: 2_000, high: 101, low: 95, close: 100 },
    { openTimeMs: 3_000, high: 105, low: 99, close: 104 },
    { openTimeMs: 4_000, high: 103, low: 98, close: 99 },
    { openTimeMs: 5_000, high: 106, low: 100, close: 107 },
  ];

  const metrics = deriveHtfFrameMetricsFromKlines(klines, 3, 1);
  assert(metrics.barStartMs === 5_000, 'last barStartMs mismatch');
  assert(metrics.close === 107, 'last close mismatch');
  assert(metrics.lastSwingHigh === 105, 'last swing high mismatch');
  assert(metrics.lastSwingLow === 98, 'last swing low mismatch');
  assert(metrics.structureBreakUp === true, 'structure break up should be true');
  assert(metrics.structureBreakDn === false, 'structure break down should be false');
  assert(metrics.atr != null, 'atr should be available');
  assertNear(Number(metrics.atr), (6 + 6 + 7) / 3, 1e-9, 'atr calculation mismatch');

  const weak = deriveHtfFrameMetricsFromKlines(
    [{ openTimeMs: 2_000, high: 100, low: 99, close: 99.5 }],
    14,
    2,
  );
  assert(weak.barStartMs === 2_000, 'barStartMs should still be present with one bar');
  assert(weak.atr == null, 'atr should be null with insufficient bars');
  assert(weak.lastSwingHigh == null, 'swing high should be null with insufficient bars');
  assert(weak.lastSwingLow == null, 'swing low should be null with insufficient bars');
  assert(weak.structureBreakUp === false, 'break up should be false with insufficient bars');
  assert(weak.structureBreakDn === false, 'break down should be false with insufficient bars');
}
