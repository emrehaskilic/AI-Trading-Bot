// Test the Binance diff-depth sequence rule: U <= lastUpdateId + 1 <= u
function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { createOrderbookState, applySnapshot, applyDepthUpdate, DepthCache } from '../metrics/OrderbookManager';

export function runTests() {
  const ob = createOrderbookState();
  const snapshot: DepthCache = {
    lastUpdateId: 10,
    bids: [],
    asks: [],
  };
  applySnapshot(ob, snapshot);
  // PASS case: U <= lastUpdateId+1 <= u
  const ok = applyDepthUpdate(ob, {
    U: 11,
    u: 15,
    b: [],
    a: [],
    eventTimeMs: Date.now(),
    receiptTimeMs: Date.now(),
  });
  assert(ok.ok === true && ok.applied === true, 'contiguous update should pass when U <= lastUpdateId+1 <= u');
  // FAIL case: U > lastUpdateId+1
  ob.lastUpdateId = 20;
  const bad1 = applyDepthUpdate(ob, {
    U: 22,
    u: 25,
    b: [],
    a: [],
    eventTimeMs: 1000,
    receiptTimeMs: 1000,
  });
  assert(bad1.ok === true && bad1.buffered === true, 'future update should be buffered');
  const badGap = applyDepthUpdate(ob, {
    U: 23,
    u: 26,
    b: [],
    a: [],
    eventTimeMs: 7001,
    receiptTimeMs: 7001,
  });
  assert(badGap.ok === false && badGap.gapDetected === true, 'expired future update should trigger gap');
  // DROP case: u <= lastUpdateId
  ob.lastUpdateId = 30;
  const bad2 = applyDepthUpdate(ob, {
    U: 28,
    u: 30,
    b: [],
    a: [],
    eventTimeMs: Date.now(),
    receiptTimeMs: Date.now(),
  });
  assert(bad2.ok === true && bad2.dropped === true, 'update with u <= lastUpdateId should be dropped');
}
