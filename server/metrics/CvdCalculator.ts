/**
 * Multi-timeframe Delta and CVD computation.
 * [P0-FIX-PHASE-1B] Replay Determinism Patches Applied
 * 
 * This module consumes trade events (identical to those used by
 * TimeAndSales) and aggregates them into rolling windows of
 * configurable durations. For each timeframe it maintains a
 * cumulative volume delta (CVD) and the net delta (buy minus sell)
 * over the window.
 */
import { TradeEvent } from './TimeAndSales';

export interface CvdMetrics {
    timeframe: string;
    cvd: number;
    delta: number;
}

interface StoredCvdTrade extends TradeEvent {
    arrival: number;
    price: number;
}

interface TimeframeStore {
    windowMs: number;
    trades: StoredCvdTrade[];
    head: number;
}

// [P0-FIX-01] Deterministic fallback timestamp
const DETERMINISTIC_FALLBACK_TIMESTAMP = 0;

// [P0-FIX-02] NaN/Infinity sanitize helper
function sanitizeFinite(value: number, fallback: number = 0): number {
    return Number.isFinite(value) ? value : fallback;
}

// [P0-FIX-03] Kahan summation for numerically stable CVD calculations
interface KahanSum {
    sum: number;
    compensation: number;
}

function createKahanSum(): KahanSum {
    return { sum: 0, compensation: 0 };
}

function kahanAdd(ks: KahanSum, value: number): void {
    const y = sanitizeFinite(value, 0) - ks.compensation;
    const t = ks.sum + y;
    ks.compensation = (t - ks.sum) - y;
    ks.sum = t;
}

/**
 * [P0-FIX-04] CvdCalculator with full replay determinism
 * All Date.now() dependencies removed - uses deterministic timestamps
 */
export class CvdCalculator {
    private readonly stores: Map<string, TimeframeStore> = new Map();
    
    // [P0-FIX-05] Kahan summation state for each timeframe
    private readonly cvdSums: Map<string, KahanSum> = new Map();

    constructor(
        timeframes: Record<string, number> = {
            '1m': 60_000,
            '5m': 300_000,
            '15m': 900_000
        }
    ) {
        for (const [tf, ms] of Object.entries(timeframes)) {
            this.stores.set(tf, { windowMs: ms, trades: [], head: 0 });
            this.cvdSums.set(tf, createKahanSum());
        }
    }

    /**
     * [P0-FIX-06] Reset calculator to deterministic initial state
     * Use this before replay to ensure consistent results
     */
    public reset(): void {
        for (const store of this.stores.values()) {
            store.trades = [];
            store.head = 0;
        }
        for (const [tf] of this.cvdSums.entries()) {
            this.cvdSums.set(tf, createKahanSum());
        }
    }

    /**
     * [P0-FIX-07] Add a trade event with deterministic timestamp handling
     * @param event - Trade event with timestamp
     * @param referenceTime - Optional deterministic reference time (for replay)
     */
    public addTrade(
        event: TradeEvent & { price: number },
        referenceTime?: number
    ): void {
        // [P0-FIX-08] Sanitize inputs
        const sanitizedEvent = {
            ...event,
            price: sanitizeFinite(event.price, 0),
            quantity: sanitizeFinite(event.quantity, 0),
            timestamp: sanitizeFinite(event.timestamp, DETERMINISTIC_FALLBACK_TIMESTAMP)
        };

        // [P0-FIX-09] Use provided reference time or event timestamp - NO Date.now()
        const arrival = referenceTime !== undefined 
            ? referenceTime 
            : sanitizedEvent.timestamp;

        const signedQty = sanitizedEvent.side === 'buy' 
            ? sanitizedEvent.quantity 
            : -sanitizedEvent.quantity;

        for (const [tf, store] of this.stores.entries()) {
            store.trades.push({
                ...sanitizedEvent,
                quantity: signedQty,
                arrival: sanitizeFinite(arrival, sanitizedEvent.timestamp),
                price: sanitizedEvent.price
            });

            // [P0-FIX-10] Update Kahan sum for this timeframe
            const kahan = this.cvdSums.get(tf)!;
            kahanAdd(kahan, signedQty);

            this.pruneExpired(store, sanitizedEvent.timestamp - store.windowMs);
        }
    }

    /**
     * [P0-FIX-11] Get trade counts with deterministic calculation
     * @param referenceTime - Optional deterministic reference time
     */
    public getTradeCounts(referenceTime?: number): Record<string, { count: number; warmUpPct: number }> {
        const counts: Record<string, { count: number; warmUpPct: number }> = {};

        for (const [tf, store] of this.stores.entries()) {
            const count = this.activeCount(store);
            let warmUpPct = 0;

            if (count > 0) {
                const oldestTrade = store.trades[store.head];
                const newestTrade = store.trades[store.trades.length - 1];
                const deterministicNow = referenceTime !== undefined
                    ? referenceTime
                    : sanitizeFinite(newestTrade?.timestamp ?? DETERMINISTIC_FALLBACK_TIMESTAMP, DETERMINISTIC_FALLBACK_TIMESTAMP);
                
                if (oldestTrade && newestTrade) {
                    const actualWindow = sanitizeFinite(deterministicNow, DETERMINISTIC_FALLBACK_TIMESTAMP) -
                                        sanitizeFinite(oldestTrade.timestamp, DETERMINISTIC_FALLBACK_TIMESTAMP);
                    warmUpPct = Math.min(100, Math.max(0, (actualWindow / store.windowMs) * 100));
                }
            }

            counts[tf] = { count, warmUpPct: sanitizeFinite(warmUpPct, 0) };
        }

        return counts;
    }

    /**
     * [P0-FIX-13] Get CVD metrics with deterministic calculation
     */
    public getMetrics(): CvdMetrics[] {
        const results: CvdMetrics[] = [];

        for (const [tf, store] of this.stores.entries()) {
            // [P0-FIX-14] Use Kahan sum for numerically stable CVD
            const kahan = this.cvdSums.get(tf)!;
            const cvd = sanitizeFinite(kahan.sum, 0);

            // Calculate delta from active trades
            let delta = 0;
            for (let i = store.head; i < store.trades.length; i++) {
                delta += store.trades[i].quantity;
            }

            results.push({
                timeframe: tf,
                cvd,
                delta: sanitizeFinite(delta, 0)
            });
        }

        return results;
    }

    // Backward-compatible alias used by existing call-sites/tests.
    public computeMetrics(referenceTime?: number): CvdMetrics[] {
        if (referenceTime !== undefined) {
            // Keep method signature forward-compatible without changing state.
            this.getTradeCounts(referenceTime);
        }
        return this.getMetrics();
    }

    /**
     * [P0-FIX-15] Get CVD for specific timeframe
     */
    public getCvdForTimeframe(timeframe: string): number {
        const kahan = this.cvdSums.get(timeframe);
        if (!kahan) return 0;
        return sanitizeFinite(kahan.sum, 0);
    }

    private pruneExpired(store: TimeframeStore, cutoff: number): void {
        while (store.head < store.trades.length && store.trades[store.head].timestamp < cutoff) {
            store.head += 1;
        }

        // Compact periodically
        if (store.head > 4096 || store.head > (store.trades.length >> 1)) {
            store.trades = store.trades.slice(store.head);
            store.head = 0;
        }
    }

    private activeCount(store: TimeframeStore): number {
        return Math.max(0, store.trades.length - store.head);
    }
}
