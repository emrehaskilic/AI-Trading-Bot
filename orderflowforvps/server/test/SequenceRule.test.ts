// Test the Binance diff-depth sequence rule: U <= lastUpdateId + 1 <= u
function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { createOrderbookState, applySnapshot, applyDepthUpdate } from '../metrics/OrderbookManager';
import { DepthCache } from '../index';

export function runTests() {
  const ob = createOrderbookState();
  const snapshot: DepthCache = {
    lastUpdateId: 10,
    bids: [],
    asks: [],
    cachedAt: Date.now(),
  };
  applySnapshot(ob, snapshot);
  // PASS case: U <= lastUpdateId+1 <= u
  const ok = applyDepthUpdate(ob, { U: 11, u: 15, b: [], a: [] });
  assert(ok === true, 'contiguous update should pass when U <= lastUpdateId+1 <= u');
  // FAIL case: U > lastUpdateId+1
  ob.lastUpdateId = 20;
  const bad1 = applyDepthUpdate(ob, { U: 22, u: 25, b: [], a: [] });
  assert(bad1 === false, 'update with U > lastUpdateId+1 should fail');
  // FAIL case: u <= lastUpdateId
  ob.lastUpdateId = 30;
  const bad2 = applyDepthUpdate(ob, { U: 28, u: 30, b: [], a: [] });
  assert(bad2 === false, 'update with u <= lastUpdateId should fail');
}