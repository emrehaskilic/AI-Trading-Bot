/**
 * Orderbook management utilities with deterministic Binance snapshot+diff sync.
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
  pu?: number;
  b: [string, string][];
  a: [string, string][];
  eventTimeMs: number;
  receiptTimeMs: number;
}

interface ReorderBufferEntry {
  update: BufferedDepthUpdate;
  insertedAtMs: number;
}

export interface OrderbookState {
  lastUpdateId: number;
  bids: [number, number][];
  asks: [number, number][];
  lastDepthTime: number;
  uiState: OrderbookUiState;
  resyncPromise: Promise<void> | null;
  buffer: BufferedDepthUpdate[];
  reorderBuffer: Map<string, ReorderBufferEntry>;
  snapshotRequired: boolean;
  lastSeenU_u: string;
  stats: {
    applied: number;
    dropped: number;
    buffered: number;
    desyncs: number;
    reordered: number;
  };
}

export type OrderbookStateMap = Map<string, OrderbookState>;

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

export interface ResetOrderbookOptions {
  uiState?: OrderbookUiState;
  keepStats?: boolean;
  desync?: boolean;
}

const MAX_LEVELS_PER_SIDE = Math.max(200, Number(process.env.ORDERBOOK_MAX_LEVELS_PER_SIDE || 2000));
const SNAPSHOT_BRIDGE_BUFFER_MAX = Math.max(200, Number(process.env.ORDERBOOK_SNAPSHOT_BUFFER_MAX || 4000));
// Keep reorder buffer bounded but tolerant to short network jitter on 100ms streams.
// Binance futures diff streams can legitimately trail a fresh REST snapshot by several
// seconds on busy symbols. If we expire the reorder buffer too early, we resync-loop
// before the stream catches up and OBI becomes trade-driven instead of depth-driven.
const REORDER_BUFFER_MAX = Math.max(32, Number(process.env.ORDERBOOK_REORDER_BUFFER_MAX || 1024));
const REORDER_BUFFER_TTL_MS = Math.max(1000, Number(process.env.ORDERBOOK_REORDER_BUFFER_TTL_MS || 30000));

type SequenceDecision = 'apply' | 'future' | 'stale' | 'gap';

export function createOrderbookStateMap(): OrderbookStateMap {
  return new Map<string, OrderbookState>();
}

export function getOrCreateOrderbookState(stateMap: OrderbookStateMap, symbol: string): OrderbookState {
  const normalized = String(symbol || '').trim().toUpperCase();
  let state = stateMap.get(normalized);
  if (!state) {
    state = createOrderbookState();
    stateMap.set(normalized, state);
  }
  return state;
}

export function createOrderbookState(): OrderbookState {
  return {
    lastUpdateId: 0,
    bids: [],
    asks: [],
    lastDepthTime: 0,
    uiState: 'INIT',
    resyncPromise: null,
    buffer: [],
    reorderBuffer: new Map(),
    snapshotRequired: true,
    lastSeenU_u: '',
    stats: { applied: 0, dropped: 0, buffered: 0, desyncs: 0, reordered: 0 },
  };
}

export function resetOrderbookState(state: OrderbookState, options: ResetOrderbookOptions = {}): void {
  state.lastUpdateId = 0;
  state.bids = [];
  state.asks = [];
  state.lastDepthTime = 0;
  state.resyncPromise = null;
  state.buffer = [];
  state.reorderBuffer.clear();
  state.snapshotRequired = true;
  state.lastSeenU_u = '';
  state.uiState = options.uiState || 'SNAPSHOT_PENDING';
  if (options.keepStats) {
    if (options.desync) {
      state.stats.desyncs += 1;
    }
    return;
  }
  state.stats = {
    applied: 0,
    dropped: 0,
    buffered: 0,
    desyncs: options.desync ? 1 : 0,
    reordered: 0,
  };
}

export function applySnapshot(state: OrderbookState, snapshot: DepthCache): SnapshotApplyResult {
  const snapshotId = Math.trunc(Number(snapshot?.lastUpdateId || 0));
  const result: SnapshotApplyResult = {
    ok: snapshotId > 0,
    appliedCount: 0,
    droppedCount: 0,
    gapDetected: snapshotId <= 0,
  };
  if (snapshotId <= 0) {
    return result;
  }

  state.bids = [];
  state.asks = [];

  for (const [priceStr, qtyStr] of snapshot.bids || []) {
    const price = Number(priceStr);
    const qty = Number(qtyStr);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(qty) && qty > 0) {
      let insertIndex = 0;
      while (insertIndex < state.bids.length && state.bids[insertIndex][0] > price) {
        insertIndex++;
      }
      state.bids.splice(insertIndex, 0, [price, qty]);
    }
  }

  for (const [priceStr, qtyStr] of snapshot.asks || []) {
    const price = Number(priceStr);
    const qty = Number(qtyStr);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(qty) && qty > 0) {
      let insertIndex = 0;
      while (insertIndex < state.asks.length && state.asks[insertIndex][0] < price) {
        insertIndex++;
      }
      state.asks.splice(insertIndex, 0, [price, qty]);
    }
  }

  state.lastUpdateId = snapshotId;
  state.lastDepthTime = Date.now();
  state.uiState = 'APPLYING_SNAPSHOT';
  state.snapshotRequired = false;
  state.reorderBuffer.clear();

  if (state.buffer.length === 0) {
    return result;
  }

  const sorted = state.buffer
    .filter((u) => u.u > snapshotId)
    .sort((a, b) => a.U - b.U || a.u - b.u);
  state.buffer = [];

  for (const update of sorted) {
    const apply = applyDepthUpdate(state, update);
    result.appliedCount += apply.applied ? 1 : 0;
    result.droppedCount += apply.dropped ? 1 : 0;
    if (!apply.ok && apply.gapDetected) {
      result.ok = false;
      result.gapDetected = true;
      break;
    }
  }

  return result;
}

export function applyDepthUpdate(state: OrderbookState, update: BufferedDepthUpdate): DepthApplyResult {
  const now = Number.isFinite(update.receiptTimeMs) && update.receiptTimeMs > 0
    ? update.receiptTimeMs
    : Date.now();

  if (!isValidDepthUpdate(update)) {
    state.stats.dropped++;
    return { ok: true, applied: false, dropped: true, buffered: false, gapDetected: false };
  }

  // During snapshot-required phases we must buffer diffs for snapshot->diff bridging.
  if (state.snapshotRequired || state.lastUpdateId <= 0) {
    bufferSnapshotBridgeUpdate(state, update);
    return { ok: true, applied: false, dropped: false, buffered: true, gapDetected: false };
  }

  if (!canApplyDeltaInState(state.uiState)) {
    state.stats.dropped++;
    return { ok: true, applied: false, dropped: true, buffered: false, gapDetected: false };
  }

  if (update.u <= state.lastUpdateId) {
    state.stats.dropped++;
    return { ok: true, applied: false, dropped: true, buffered: false, gapDetected: false };
  }

  const expected = state.lastUpdateId + 1;
  if (evictExpiredReorderEntries(state, now, expected)) {
    state.stats.desyncs++;
    return { ok: false, applied: false, dropped: false, buffered: false, gapDetected: true };
  }

  const decision = classifyUpdate(state, update, expected);
  if (decision === 'stale') {
    state.stats.dropped++;
    return { ok: true, applied: false, dropped: true, buffered: false, gapDetected: false };
  }
  if (decision === 'gap') {
    state.stats.desyncs++;
    return { ok: false, applied: false, dropped: false, buffered: false, gapDetected: true };
  }
  if (decision === 'future') {
    const buffered = bufferFutureUpdate(state, update, now, expected);
    if (!buffered) {
      state.stats.desyncs++;
      return { ok: false, applied: false, dropped: false, buffered: false, gapDetected: true };
    }
    return { ok: true, applied: false, dropped: false, buffered: true, gapDetected: false };
  }

  const apply = applyDelta(state, update);
  const drain = drainReorderBuffer(state, now);
  if (drain.gapDetected) {
    state.stats.desyncs++;
    return { ok: false, applied: apply.applied, dropped: false, buffered: false, gapDetected: true };
  }
  return { ok: true, applied: apply.applied, dropped: false, buffered: false, gapDetected: false };
}

function bufferSnapshotBridgeUpdate(state: OrderbookState, update: BufferedDepthUpdate): void {
  if (state.buffer.length >= SNAPSHOT_BRIDGE_BUFFER_MAX) {
    // Keep most recent updates during prolonged snapshot waits.
    state.buffer.shift();
    state.stats.dropped++;
  }
  state.buffer.push(update);
  state.stats.buffered++;
}

function canApplyDeltaInState(uiState: OrderbookUiState): boolean {
  return uiState === 'LIVE' || uiState === 'APPLYING_SNAPSHOT';
}

function isValidDepthUpdate(update: BufferedDepthUpdate): boolean {
  const U = Math.trunc(Number(update.U));
  const u = Math.trunc(Number(update.u));
  if (!(Number.isFinite(U) && Number.isFinite(u) && U > 0 && u > 0)) {
    return false;
  }
  if (U > u) {
    return false;
  }
  return Array.isArray(update.b) && Array.isArray(update.a);
}

function classifyUpdate(state: OrderbookState, update: BufferedDepthUpdate, expected: number): SequenceDecision {
  if (update.u <= state.lastUpdateId) {
    return 'stale';
  }

  const spansExpected = update.U <= expected && update.u >= expected;
  // Binance snapshot->diff bridge must prioritize U/u continuity.
  // `pu` can legitimately lag snapshot id on the first live diff after snapshot.
  if (spansExpected) {
    return 'apply';
  }

  const hasPrevUpdatePointer = Number.isFinite(update.pu) && Number(update.pu) > 0;
  if (hasPrevUpdatePointer) {
    const pu = Number(update.pu);
    if (pu < state.lastUpdateId) {
      return 'stale';
    }
    if (pu > state.lastUpdateId) {
      return 'future';
    }
    return 'apply';
  }
  if (update.U > expected) {
    return 'future';
  }
  return 'stale';
}

function reorderKey(update: BufferedDepthUpdate): string {
  return `${Math.trunc(update.U)}:${Math.trunc(update.u)}:${Math.trunc(Number(update.pu || 0))}`;
}

function bufferFutureUpdate(
  state: OrderbookState,
  update: BufferedDepthUpdate,
  now: number,
  expected: number
): boolean {
  if (evictExpiredReorderEntries(state, now, expected)) {
    return false;
  }
  const key = reorderKey(update);
  if (state.reorderBuffer.has(key)) {
    state.stats.dropped++;
    return true;
  }
  if (state.reorderBuffer.size >= REORDER_BUFFER_MAX) {
    return false;
  }
  state.reorderBuffer.set(key, { update, insertedAtMs: now });
  state.stats.buffered++;
  return true;
}

function evictExpiredReorderEntries(state: OrderbookState, now: number, expected: number): boolean {
  let expiredRelevant = false;
  for (const [key, entry] of state.reorderBuffer.entries()) {
    if (now - entry.insertedAtMs <= REORDER_BUFFER_TTL_MS) {
      continue;
    }
    if (entry.update.u >= expected) {
      expiredRelevant = true;
    }
    state.reorderBuffer.delete(key);
  }
  return expiredRelevant;
}

function selectNextBuffered(
  state: OrderbookState,
  expected: number
): { key: string; entry: ReorderBufferEntry } | null {
  const sorted = Array.from(state.reorderBuffer.entries())
    .sort((a, b) => a[1].update.U - b[1].update.U || a[1].update.u - b[1].update.u);

  for (const [key, entry] of sorted) {
    const decision = classifyUpdate(state, entry.update, expected);
    if (decision === 'stale') {
      state.reorderBuffer.delete(key);
      state.stats.dropped++;
      continue;
    }
    if (decision === 'apply') {
      return { key, entry };
    }
  }
  return null;
}

function drainReorderBuffer(state: OrderbookState, now: number): { appliedCount: number; gapDetected: boolean } {
  let appliedCount = 0;
  while (state.reorderBuffer.size > 0) {
    const expected = state.lastUpdateId + 1;
    if (evictExpiredReorderEntries(state, now, expected)) {
      return { appliedCount, gapDetected: true };
    }
    const next = selectNextBuffered(state, expected);
    if (!next) {
      break;
    }
    state.reorderBuffer.delete(next.key);
    const apply = applyDelta(state, next.entry.update);
    if (apply.applied) {
      appliedCount += 1;
      state.stats.reordered += 1;
    }
  }
  return { appliedCount, gapDetected: false };
}

function applyDelta(state: OrderbookState, update: BufferedDepthUpdate): { applied: boolean; dropped: boolean } {
  for (const [p, q] of update.b) {
    const price = Number(p);
    const qty = Number(q);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty < 0) {
      continue;
    }
    upsertLevel(state.bids, price, qty, false);
  }

  for (const [p, q] of update.a) {
    const price = Number(p);
    const qty = Number(q);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty < 0) {
      continue;
    }
    upsertLevel(state.asks, price, qty, true);
  }

  // Keep depth maps bounded to prevent unbounded memory/CPU growth.
  pruneLevels(state.bids, false);
  pruneLevels(state.asks, true);

  state.lastUpdateId = Math.trunc(update.u);
  state.lastDepthTime = update.receiptTimeMs || Date.now();
  state.lastSeenU_u = `${Math.trunc(update.U)}-${Math.trunc(update.u)}`;
  state.stats.applied++;
  return { applied: true, dropped: false };
}

function upsertLevel(levels: [number, number][], price: number, qty: number, isAsk: boolean): void {
  const index = levels.findIndex((level) => level[0] === price);
  if (qty === 0) {
    if (index !== -1) {
      levels.splice(index, 1);
    }
    return;
  }

  if (index !== -1) {
    levels[index][1] = qty;
    return;
  }

  let insertIndex = 0;
  while (
    insertIndex < levels.length
    && (isAsk ? levels[insertIndex][0] < price : levels[insertIndex][0] > price)
  ) {
    insertIndex += 1;
  }
  levels.splice(insertIndex, 0, [price, qty]);
}

function pruneLevels(levels: [number, number][], _isAsk: boolean): void {
  if (levels.length <= MAX_LEVELS_PER_SIDE) return;
  levels.splice(MAX_LEVELS_PER_SIDE);
}

export function bestBid(state: OrderbookState): number | null {
  if (state.bids.length === 0) return null;
  return state.bids[0][0];
}

export function bestAsk(state: OrderbookState): number | null {
  if (state.asks.length === 0) return null;
  return state.asks[0][0];
}

export function getLevelSize(state: OrderbookState, price: number): number | undefined {
  const bid = state.bids.find((level) => level[0] === price)?.[1];
  if (bid !== undefined) return bid;
  return state.asks.find((level) => level[0] === price)?.[1];
}

export function getTopLevels(
  state: OrderbookState,
  depth: number
): { bids: [number, number, number][]; asks: [number, number, number][] } {
  const sortedBids = state.bids
    .slice(0, depth);

  let cumulativeBid = 0;
  const bids: [number, number, number][] = sortedBids.map(([price, size]) => {
    cumulativeBid += size;
    return [price, size, cumulativeBid];
  });

  const sortedAsks = state.asks
    .slice(0, depth);

  let cumulativeAsk = 0;
  const asks: [number, number, number][] = sortedAsks.map(([price, size]) => {
    cumulativeAsk += size;
    return [price, size, cumulativeAsk];
  });

  return { bids, asks };
}
