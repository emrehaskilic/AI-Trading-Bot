// Minimal assertion helper
function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import {
  createOrderbookState,
  applySnapshot,
  applyDepthUpdate,
  bestBid,
  bestAsk,
  getLevelSize,
  DepthCache,
} from '../metrics/OrderbookManager';

/**
 * Tests for OrderbookManager functions.  These tests cover snapshot
 * application, incremental update ordering, gap detection and best
 * price computations.
 */
export function runTests() {
  // Prepare a snapshot with two bid levels and two ask levels
  const snapshot: DepthCache = {
    lastUpdateId: 10,
    bids: [
      ['100.0', '5'],
      ['99.0', '3'],
    ],
    asks: [
      ['101.0', '4'],
      ['102.0', '6'],
    ],
  };
  const ob = createOrderbookState();
  applySnapshot(ob, snapshot);
  assert(ob.lastUpdateId === 10, 'snapshot sets lastUpdateId');
  assert(bestBid(ob) === 100.0, 'best bid should be highest price');
  assert(bestAsk(ob) === 101.0, 'best ask should be lowest price');
  assert(getLevelSize(ob, 100.0) === 5, 'getLevelSize for bid');
  assert(getLevelSize(ob, 101.0) === 4, 'getLevelSize for ask');
  // Apply incremental update contiguous
  const ok = applyDepthUpdate(ob, {
    U: 11,
    u: 11,
    b: [['100.0', '4']],
    a: [['101.0', '5']],
    eventTimeMs: Date.now(),
    receiptTimeMs: Date.now(),
  });
  assert(ok.ok, 'contiguous update should succeed');
  assert(ob.lastUpdateId === 11, 'lastUpdateId updates');
  assert(getLevelSize(ob, 100.0) === 4, 'bid updated');
  assert(getLevelSize(ob, 101.0) === 5, 'ask updated');
  // Apply gap update: U greater than lastUpdateId + 1 -> expect false
  const bad = applyDepthUpdate(ob, {
    U: 13,
    u: 13,
    b: [['100.0', '5']],
    a: [],
    eventTimeMs: 1000,
    receiptTimeMs: 1000,
  });
  assert(bad.ok === true && bad.buffered === true, 'future update should enter reorder buffer');
  const gap = applyDepthUpdate(ob, {
    U: 14,
    u: 14,
    b: [],
    a: [],
    eventTimeMs: 7001,
    receiptTimeMs: 7001,
  });
  assert(gap.ok === false && gap.gapDetected === true, 'expired reorder entry should trigger gap');

  const obWithPuBridge = createOrderbookState();
  applySnapshot(obWithPuBridge, snapshot);
  const bridged = applyDepthUpdate(obWithPuBridge, {
    U: 13,
    u: 15,
    pu: 10,
    b: [['100.0', '6']],
    a: [['101.0', '3']],
    eventTimeMs: Date.now(),
    receiptTimeMs: Date.now(),
  });
  assert(bridged.ok === true && bridged.applied === true, 'pu continuity update should apply');
  assert(obWithPuBridge.lastUpdateId === 15, 'pu continuity update should advance lastUpdateId');
  assert(getLevelSize(obWithPuBridge, 100.0) === 6, 'bridged bid update should apply');
  assert(getLevelSize(obWithPuBridge, 101.0) === 3, 'bridged ask update should apply');
}
