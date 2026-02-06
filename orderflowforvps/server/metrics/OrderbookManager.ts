/**
 * Orderbook management utilities.
 *
 * Binance depth streams provide incremental updates with sequence IDs. To
 * maintain a consistent in‑memory orderbook we must apply updates
 * sequentially and detect gaps. When a gap is detected we discard
 * incremental updates and fetch a fresh snapshot via the REST API.
 *
 * This module encapsulates the state and logic for an individual
 * symbol's orderbook.  It maintains bids and asks in maps keyed by
 * price (number) and exposes helpers to apply incremental updates,
 * determine the best bid/ask, and retrieve size at a given price.
 */

import { DepthCache } from '../index';

/**
 * UI state for the orderbook.  LIVE indicates the orderbook is up to
 * date with the latest stream.  STALE indicates no updates have been
 * received within the timeout threshold.  RESYNCING indicates a
 * snapshot fetch is in progress after a sequence gap.
 */
export type OrderbookUiState = 'LIVE' | 'STALE' | 'RESYNCING';

export interface OrderbookState {
  lastUpdateId: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
  /** Timestamp of the last depth update received (ms). */
  lastDepthTime: number;
  /** UI state representing data freshness/resyncing. */
  uiState: OrderbookUiState;
  /** Pending resync promise to avoid duplicate fetches. */
  resyncPromise: Promise<void> | null;
}

/**
 * Create a new, empty orderbook state.
 */
export function createOrderbookState(): OrderbookState {
  return {
    lastUpdateId: 0,
    bids: new Map(),
    asks: new Map(),
    lastDepthTime: 0,
    uiState: 'LIVE',
    resyncPromise: null,
  };
}

/**
 * Apply a depth snapshot to the orderbook.  All existing levels are
 * replaced.  This should be called after fetching the snapshot via
 * REST.  It resets lastUpdateId and sets the lastDepthTime to now.
 */
export function applySnapshot(state: OrderbookState, snapshot: DepthCache) {
  state.bids.clear();
  state.asks.clear();
  // Convert bids/asks arrays into maps keyed by numeric price.
  for (const [priceStr, qtyStr] of snapshot.bids) {
    const p = parseFloat(priceStr);
    const q = parseFloat(qtyStr);
    if (q > 0) state.bids.set(p, q);
  }
  for (const [priceStr, qtyStr] of snapshot.asks) {
    const p = parseFloat(priceStr);
    const q = parseFloat(qtyStr);
    if (q > 0) state.asks.set(p, q);
  }
  state.lastUpdateId = snapshot.lastUpdateId;
  state.lastDepthTime = Date.now();
  state.uiState = 'LIVE';
}

/**
 * Apply an incremental depth update.  Returns true if the update was
 * successfully applied, false if a gap was detected (in which case
 * the caller should trigger a snapshot resync).  This function does
 * not perform the snapshot fetch; that should be handled by the
 * caller.
 */
export function applyDepthUpdate(
  state: OrderbookState,
  update: { U: number; u: number; pu?: number; b: [string, string][]; a: [string, string][] }
): boolean {
  // If lastUpdateId is 0 we have not yet loaded a snapshot; cannot apply
  if (state.lastUpdateId === 0) {
    return false;
  }
  // Ensure the update is contiguous.  Binance spec: discard any updates
  // where u <= lastUpdateId or U > lastUpdateId + 1.  We allow
  // updates where U <= lastUpdateId + 1 <= u.
  if (update.u <= state.lastUpdateId || update.U > state.lastUpdateId + 1) {
    return false;
  }
  // Apply bids: price=0 => remove level
  for (const [priceStr, qtyStr] of update.b) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (qty === 0) {
      state.bids.delete(price);
    } else {
      state.bids.set(price, qty);
    }
  }
  // Apply asks
  for (const [priceStr, qtyStr] of update.a) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (qty === 0) {
      state.asks.delete(price);
    } else {
      state.asks.set(price, qty);
    }
  }
  state.lastUpdateId = update.u;
  state.lastDepthTime = Date.now();
  state.uiState = 'LIVE';
  return true;
}

/**
 * Compute the best bid (highest price) for the current orderbook.
 */
export function bestBid(state: OrderbookState): number | null {
  if (state.bids.size === 0) return null;
  let max = -Infinity;
  for (const p of state.bids.keys()) {
    if (p > max) max = p;
  }
  return max;
}

/**
 * Compute the best ask (lowest price) for the current orderbook.
 */
export function bestAsk(state: OrderbookState): number | null {
  if (state.asks.size === 0) return null;
  let min = Infinity;
  for (const p of state.asks.keys()) {
    if (p < min) min = p;
  }
  return min;
}

/**
 * Retrieve the orderbook size at a specific price level.  Returns
 * undefined if the level is not present.
 */
export function getLevelSize(state: OrderbookState, price: number): number | undefined {
  const bidSize = state.bids.get(price);
  if (bidSize !== undefined) return bidSize;
  const askSize = state.asks.get(price);
  if (askSize !== undefined) return askSize;
  return undefined;
}

/**
 * Retrieve the top N bid and ask levels from the orderbook.  Bids are
 * returned in descending price order and asks in ascending price order.
 * Each level is a two‑element tuple of [price, size].  This helper
 * is used by the server to expose a depth ladder to the frontend.
 *
 * @param state The orderbook state
 * @param depth The maximum number of levels to return on each side
 */
/**
 * Retrieve the top N bid and ask levels from the orderbook.  Each
 * returned level includes a cumulative `total` field which is the
 * running sum of sizes up to and including that level.  This allows
 * the frontend to render depth bars without recomputing totals.  Bids
 * are returned in descending price order and asks in ascending price
 * order.
 */
export function getTopLevels(
  state: OrderbookState,
  depth: number
): { bids: [number, number, number][]; asks: [number, number, number][] } {
  // Extract and sort bids descending by price
  const sortedBids = Array.from(state.bids.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, depth);
  // Compute cumulative totals for bids (from best bid downwards)
  let cumulativeBid = 0;
  const bidsArray: [number, number, number][] = sortedBids.map(([price, size]) => {
    cumulativeBid += size;
    return [price, size, cumulativeBid];
  });
  // Extract and sort asks ascending by price
  const sortedAsks = Array.from(state.asks.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, depth);
  // Compute cumulative totals for asks (from best ask upwards)
  let cumulativeAsk = 0;
  const asksArray: [number, number, number][] = sortedAsks.map(([price, size]) => {
    cumulativeAsk += size;
    return [price, size, cumulativeAsk];
  });
  return { bids: bidsArray, asks: asksArray };
}