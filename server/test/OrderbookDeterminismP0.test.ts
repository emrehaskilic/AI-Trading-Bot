import assert from 'node:assert/strict';

import {
  applyDepthUpdate,
  applySnapshot,
  createOrderbookStateMap,
  getLevelSize,
  getOrCreateOrderbookState,
  resetOrderbookState,
} from '../metrics/OrderbookManager';

export function runTests() {
  const store = createOrderbookStateMap();
  const btc = getOrCreateOrderbookState(store, 'btcusdt');
  const eth = getOrCreateOrderbookState(store, 'ethusdt');
  assert.notEqual(btc, eth, 'each symbol must use isolated orderbook state');

  applySnapshot(btc, {
    lastUpdateId: 100,
    bids: [['50000', '2']],
    asks: [['50001', '2']],
  });
  applySnapshot(eth, {
    lastUpdateId: 300,
    bids: [['3000', '5']],
    asks: [['3001', '5']],
  });

  applyDepthUpdate(btc, {
    U: 101,
    u: 101,
    b: [['50000', '3']],
    a: [],
    eventTimeMs: 100,
    receiptTimeMs: 100,
  });
  assert.equal(getLevelSize(btc, 50000), 3, 'BTC update should apply to BTC state');
  assert.equal(getLevelSize(eth, 3000), 5, 'BTC update must not contaminate ETH state');

  // Reconnect/gap reset requires snapshot before accepting diffs.
  resetOrderbookState(btc, { uiState: 'SNAPSHOT_PENDING', keepStats: true });
  const ignored = applyDepthUpdate(btc, {
    U: 102,
    u: 102,
    b: [['50000', '1']],
    a: [],
    eventTimeMs: 200,
    receiptTimeMs: 200,
  });
  assert.equal(ignored.dropped, true, 'diff must be ignored until fresh snapshot arrives');
  assert.equal(btc.lastUpdateId, 0, 'state must stay reset before snapshot');

  applySnapshot(btc, {
    lastUpdateId: 200,
    bids: [['50010', '1']],
    asks: [['50011', '1']],
  });

  // Minimal reorder buffer: future diff waits, then gets drained after missing sequence arrives.
  const future = applyDepthUpdate(btc, {
    U: 202,
    u: 202,
    b: [['50012', '2']],
    a: [],
    eventTimeMs: 300,
    receiptTimeMs: 1000,
  });
  assert.equal(future.buffered, true, 'future update should be buffered');

  const contiguous = applyDepthUpdate(btc, {
    U: 201,
    u: 201,
    b: [['50010', '2']],
    a: [],
    eventTimeMs: 320,
    receiptTimeMs: 1050,
  });
  assert.equal(contiguous.applied, true, 'contiguous update should apply');
  assert.equal(btc.lastUpdateId, 202, 'buffered future update should drain deterministically');

  const stale = applyDepthUpdate(btc, {
    U: 202,
    u: 202,
    b: [],
    a: [],
    eventTimeMs: 400,
    receiptTimeMs: 1100,
  });
  assert.equal(stale.dropped, true, 'u <= lastUpdateId must be dropped');
}

