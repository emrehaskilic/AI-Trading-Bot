/**
 * Orderbook management utilities with canonical Binance snapshot+delta sync.
 */

export interface DepthCache {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export type OrderbookUiState =
  | 'INIT'
  | 'SNAPSHOT_PENDING'
  | 'APPLYING_SNAPSHOT'
  | 'LIVE'
  | 'RESYNCING'
  | 'HALTED';

export interface BufferedDepthUpdate {
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
  eventTimeMs: number;
  receiptTimeMs: number;
}

export interface OrderbookState {
  lastUpdateId: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
  lastDepthTime: number;
  uiState: OrderbookUiState;
  resyncPromise: Promise<void> | null;
  buffer: BufferedDepthUpdate[];
  lastSeenU_u: string;
  stats: {
    applied: number;
    dropped: number;
    buffered: number;
    desyncs: number;
  };
}

export interface SnapshotApplyResult {
  ok: boolean;
  appliedCount: number;
  droppedCount: number;
  gapDetected: boolean;
}

export interface DepthApplyResult {
  ok: boolean;
  applied: boolean;
  dropped: boolean;
  buffered: boolean;
  gapDetected: boolean;
}

export function createOrderbookState(): OrderbookState {
  return {
    lastUpdateId: 0,
    bids: new Map(),
    asks: new Map(),
    lastDepthTime: 0,
    uiState: 'INIT',
    resyncPromise: null,
    buffer: [],
    lastSeenU_u: '',
    stats: { applied: 0, dropped: 0, buffered: 0, desyncs: 0 },
  };
}

export function applySnapshot(state: OrderbookState, snapshot: DepthCache): SnapshotApplyResult {
  state.bids.clear();
  state.asks.clear();

  for (const [priceStr, qtyStr] of snapshot.bids) {
    const qty = parseFloat(qtyStr);
    if (qty > 0) {
      state.bids.set(parseFloat(priceStr), qty);
    }
  }

  for (const [priceStr, qtyStr] of snapshot.asks) {
    const qty = parseFloat(qtyStr);
    if (qty > 0) {
      state.asks.set(parseFloat(priceStr), qty);
    }
  }

  state.lastUpdateId = snapshot.lastUpdateId;
  state.lastDepthTime = Date.now();
  state.uiState = 'APPLYING_SNAPSHOT';

  const result: SnapshotApplyResult = {
    ok: true,
    appliedCount: 0,
    droppedCount: 0,
    gapDetected: false,
  };

  if (state.buffer.length === 0) {
    return result;
  }

  const sorted = state.buffer
    .filter((u) => u.u > snapshot.lastUpdateId)
    .sort((a, b) => a.U - b.U || a.u - b.u);

  state.buffer = [];

  let started = false;
  for (const update of sorted) {
    if (!started) {
      if (update.U <= snapshot.lastUpdateId + 1 && update.u >= snapshot.lastUpdateId + 1) {
        const apply = applyDelta(state, update);
        result.appliedCount += apply.applied ? 1 : 0;
        result.droppedCount += apply.dropped ? 1 : 0;
        started = true;
        continue;
      }
      result.droppedCount += 1;
      continue;
    }

    const apply = applyDepthUpdate(state, update);
    result.appliedCount += apply.applied ? 1 : 0;
    result.droppedCount += apply.dropped ? 1 : 0;
    if (apply.gapDetected) {
      result.ok = false;
      result.gapDetected = true;
      break;
    }
  }

  if (!started && sorted.length > 0) {
    result.ok = false;
    result.gapDetected = true;
  }

  return result;
}

export function applyDepthUpdate(state: OrderbookState, update: BufferedDepthUpdate): DepthApplyResult {
  if (state.uiState !== 'LIVE' && state.uiState !== 'APPLYING_SNAPSHOT') {
    state.buffer.push(update);
    state.stats.buffered++;
    return { ok: true, applied: false, dropped: false, buffered: true, gapDetected: false };
  }

  if (state.lastUpdateId === 0) {
    state.buffer.push(update);
    state.stats.buffered++;
    return { ok: true, applied: false, dropped: false, buffered: true, gapDetected: false };
  }

  if (update.u <= state.lastUpdateId) {
    state.stats.dropped++;
    return { ok: true, applied: false, dropped: true, buffered: false, gapDetected: false };
  }

  const expected = state.lastUpdateId + 1;
  if (update.U > expected) {
    state.stats.desyncs++;
    return { ok: false, applied: false, dropped: false, buffered: false, gapDetected: true };
  }

  if (update.u < expected) {
    state.stats.dropped++;
    return { ok: true, applied: false, dropped: true, buffered: false, gapDetected: false };
  }

  const apply = applyDelta(state, update);
  return { ok: true, applied: apply.applied, dropped: apply.dropped, buffered: false, gapDetected: false };
}

function applyDelta(state: OrderbookState, update: BufferedDepthUpdate): { applied: boolean; dropped: boolean } {
  for (const [p, q] of update.b) {
    const price = parseFloat(p);
    const qty = parseFloat(q);
    if (qty === 0) state.bids.delete(price);
    else state.bids.set(price, qty);
  }

  for (const [p, q] of update.a) {
    const price = parseFloat(p);
    const qty = parseFloat(q);
    if (qty === 0) state.asks.delete(price);
    else state.asks.set(price, qty);
  }

  state.lastUpdateId = update.u;
  state.lastDepthTime = update.receiptTimeMs || Date.now();
  state.stats.applied++;
  return { applied: true, dropped: false };
}

export function bestBid(state: OrderbookState): number | null {
  if (state.bids.size === 0) return null;
  let max = -Infinity;
  for (const p of state.bids.keys()) {
    if (p > max) max = p;
  }
  return max;
}

export function bestAsk(state: OrderbookState): number | null {
  if (state.asks.size === 0) return null;
  let min = Infinity;
  for (const p of state.asks.keys()) {
    if (p < min) min = p;
  }
  return min;
}

export function getLevelSize(state: OrderbookState, price: number): number | undefined {
  const bid = state.bids.get(price);
  if (bid !== undefined) return bid;
  return state.asks.get(price);
}

export function getTopLevels(
  state: OrderbookState,
  depth: number
): { bids: [number, number, number][]; asks: [number, number, number][] } {
  const sortedBids = Array.from(state.bids.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, depth);

  let cumulativeBid = 0;
  const bids: [number, number, number][] = sortedBids.map(([price, size]) => {
    cumulativeBid += size;
    return [price, size, cumulativeBid];
  });

  const sortedAsks = Array.from(state.asks.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, depth);

  let cumulativeAsk = 0;
  const asks: [number, number, number][] = sortedAsks.map(([price, size]) => {
    cumulativeAsk += size;
    return [price, size, cumulativeAsk];
  });

  return { bids, asks };
}
