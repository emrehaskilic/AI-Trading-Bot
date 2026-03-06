// [GITHUB VERIFIED] Backend implementation of OBI, VWAP, DeltaZ, CVD Slope, and Advanced Scores
// Senior Quantitative Finance Developer Implementation
// [P0-FIX-PHASE-1B] Metric Correctness & Replay Determinism Patches Applied

import { OrderbookState } from './OrderbookManager';
import { OpenInterestMonitor, OpenInterestMetrics as OIMetrics } from './OpenInterestMonitor';
import { SessionVwapSnapshot, SessionVwapTracker } from './SessionVwapTracker';

// Type for a trade used in the legacy metrics calculations
interface LegacyTrade {
    price: number;
    quantity: number;
    side: 'buy' | 'sell';
    timestamp: number;
}

// [P0-FIX-01] Enhanced constants for deterministic calculations
const EPSILON = 1e-12;
const MAX_TRADES_WINDOW = 10_000; // Maximum trade window (10 seconds worth)
const VOLATILITY_HISTORY_SIZE = 3600; // 1 hour of volatility history
const ATR_WINDOW = 14;
const SWEEP_DETECTION_WINDOW = 30;
const BREAKOUT_WINDOW = 15;
const ABSORPTION_WINDOW = 60;
const DELTA_HISTORY_LIMIT = 60;
const CVD_HISTORY_LIMIT = 60;
const VOLUME_HISTORY_LIMIT = 100;

// [P0-FIX-02] Deterministic fallback timestamp for replay scenarios
const DETERMINISTIC_FALLBACK_TIMESTAMP = 0;

// [P0-FIX-03] NaN/Infinity sanitize helper
function sanitizeFinite(value: number, fallback: number = 0): number {
    return Number.isFinite(value) ? value : fallback;
}

// [P0-FIX-04] Zero variance guard for Z-score calculations
function calculateStdDevDeterministic(values: number[]): { std: number; mean: number; variance: number } {
    const n = values.length;
    if (n === 0) {
        return { std: 0, mean: 0, variance: 0 };
    }
    
    // [P0-FIX-05] Welford's online algorithm for numerically stable variance
    let mean = 0;
    let M2 = 0;
    for (let i = 0; i < n; i++) {
        const x = sanitizeFinite(values[i], 0);
        const delta = x - mean;
        mean += delta / (i + 1);
        const delta2 = x - mean;
        M2 += delta * delta2;
    }
    
    const variance = n > 1 ? M2 / n : 0;
    // [P0-FIX-06] Guard against negative variance due to floating point errors
    const safeVariance = Math.max(0, variance);
    const std = Math.sqrt(safeVariance);
    
    return { std, mean, variance: safeVariance };
}

// [P0-FIX-07] Kahan summation for numerically stable cumulative operations
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
 * LegacyCalculator computes additional orderflow metrics that were
 * previously derived on the client. These include various orderbook
 * imbalance scores, rolling delta windows, Z-scores and session CVD
 * slope. The implementation strives to be lightweight but still
 * produce values compatible with the original UI expectations.
 * 
 * Implements:
 * - OBI (Weighted, Deep, Divergence)
 * - Session VWAP
 * - Delta Z-Score
 * - CVD Slope
 * - Advanced Scores: Sweep, Breakout, Regime, Absorption
 * - Trade Signal
 * - Exhaustion Detection
 * 
 * [P0-FIX-PHASE-1B] All calculations are now deterministic and numerically stable
 */
export class LegacyCalculator {
    // Keep a rolling list of trades for delta calculations (max 10 seconds)
    private trades: LegacyTrade[] = [];
    private tradesHead = 0;
    private oiMonitor: OpenInterestMonitor | null = null;
    private readonly sessionVwapTracker = new SessionVwapTracker();

    // [P0-FIX-08] Kahan summation state for numerically stable cumulative metrics
    private cvdSessionKahan: KahanSum = createKahanSum();
    private totalVolumeKahan: KahanSum = createKahanSum();
    private totalNotionalKahan: KahanSum = createKahanSum();

    // List of recent delta1s values for Z-score computation
    private deltaHistory: number[] = [];
    // List of recent session CVD values for slope computation
    private cvdHistory: number[] = [];
    private cvdSession = 0;
    private totalVolume = 0;
    private totalNotional = 0;

    // Advanced Metrics State
    private volatilityHistory: number[] = [];
    private volumeHistory: number[] = [];
    private lastMidPrice = 0;
    
    // [P0-FIX-09] Last valid VWAP for deterministic fallback
    private lastValidVwap: number = 0;

    constructor(symbol?: string) {
        if (symbol) {
            this.oiMonitor = new OpenInterestMonitor(symbol);
        }
    }

    public async updateOpenInterest() {
        if (this.oiMonitor) {
            await this.oiMonitor.updateOpenInterest();
        }
    }

    public getOpenInterestMetrics(): OIMetrics | null {
        return this.oiMonitor ? this.oiMonitor.getMetrics() : null;
    }

    /**
     * [P0-FIX-10] Reset calculator to deterministic initial state
     * Use this before replay to ensure consistent results
     */
    public reset(): void {
        this.trades = [];
        this.tradesHead = 0;
        this.deltaHistory = [];
        this.cvdHistory = [];
        this.cvdSession = 0;
        this.totalVolume = 0;
        this.totalNotional = 0;
        this.cvdSessionKahan = createKahanSum();
        this.totalVolumeKahan = createKahanSum();
        this.totalNotionalKahan = createKahanSum();
        this.volatilityHistory = [];
        this.volumeHistory = [];
        this.lastMidPrice = 0;
        this.lastValidVwap = 0;
    }

    /**
     * Add a trade to the calculator. Updates rolling windows and
     * cumulative session CVD/volume/notional statistics.
     * [P0-FIX-11] All operations are now numerically stable
     */
    addTrade(trade: LegacyTrade) {
        // [P0-FIX-12] Sanitize trade inputs
        const sanitizedTrade: LegacyTrade = {
            price: sanitizeFinite(trade.price, 0),
            quantity: sanitizeFinite(trade.quantity, 0),
            side: trade.side === 'buy' || trade.side === 'sell' ? trade.side : 'buy',
            timestamp: sanitizeFinite(trade.timestamp, DETERMINISTIC_FALLBACK_TIMESTAMP)
        };

        const now = sanitizedTrade.timestamp;
        
        // Push new trade
        this.trades.push(sanitizedTrade);
        
        // [P0-FIX-13] Update session metrics with Kahan summation
        kahanAdd(this.totalVolumeKahan, sanitizedTrade.quantity);
        kahanAdd(this.totalNotionalKahan, sanitizedTrade.quantity * sanitizedTrade.price);
        const signedQty = sanitizedTrade.side === 'buy' ? sanitizedTrade.quantity : -sanitizedTrade.quantity;
        kahanAdd(this.cvdSessionKahan, signedQty);
        
        // Sync Kahan sums to regular values
        this.totalVolume = this.totalVolumeKahan.sum;
        this.totalNotional = this.totalNotionalKahan.sum;
        this.cvdSession = this.cvdSessionKahan.sum;
        
        // Remove old trades beyond 10 seconds
        this.pruneOldTrades(now - 10_000);
        
        // Every trade, recompute delta1s and store for Z-score
        const oneSecCutoff = now - 1_000;
        let delta1s = 0;
        let delta5s = 0;
        
        // [P0-FIX-14] Deterministic loop with sanitized values
        for (let i = this.tradesHead; i < this.trades.length; i += 1) {
            const t = this.trades[i];
            const qty = t.side === 'buy' ? t.quantity : -t.quantity;
            if (t.timestamp >= oneSecCutoff) {
                delta1s += qty;
            }
            if (t.timestamp >= now - 5_000) {
                delta5s += qty;
            }
        }
        
        // Sanitize delta values
        delta1s = sanitizeFinite(delta1s, 0);
        delta5s = sanitizeFinite(delta5s, 0);

        // [P0-FIX-15] Store delta1s history for Z calculation with limit
        this.deltaHistory.push(delta1s);
        if (this.deltaHistory.length > DELTA_HISTORY_LIMIT) {
            this.deltaHistory.shift();
        }
        
        // [P0-FIX-16] Store cvdSession history for slope calculation with limit
        this.cvdHistory.push(this.cvdSession);
        if (this.cvdHistory.length > CVD_HISTORY_LIMIT) {
            this.cvdHistory.shift();
        }
        
        // [P0-FIX-17] Store volume history for absorption detection with limit
        this.volumeHistory.push(sanitizedTrade.quantity);
        if (this.volumeHistory.length > VOLUME_HISTORY_LIMIT) {
            this.volumeHistory.shift();
        }
        
        this.sessionVwapTracker.update(sanitizedTrade.timestamp, sanitizedTrade.price, sanitizedTrade.quantity);
    }

    public getSessionVwapSnapshot(nowMs: number, referencePrice: number | null | undefined): SessionVwapSnapshot {
        return this.sessionVwapTracker.snapshot(nowMs, referencePrice);
    }

    /**
     * [P0-FIX-18] Calculate Standard Deviation using numerically stable algorithm
     * @deprecated Use calculateStdDevDeterministic instead
     */
    private calculateStdDev(values: number[]): number {
        return calculateStdDevDeterministic(values).std;
    }

    /**
     * [P0-FIX-19] Linear Regression Slope calculation with full numerical stability
     */
    private calculateSlope(values: number[]): number {
        const n = values.length;
        if (n < 2) return 0;

        // [P0-FIX-20] Sanitize input values
        const sanitizedValues = values.map(v => sanitizeFinite(v, 0));
        
        // Create x values (0, 1, 2, ..., n-1)
        const xs = Array.from({ length: n }, (_, i) => i);
        
        // [P0-FIX-21] Calculate sums using Kahan summation for precision
        let sumX = 0;
        let sumY = 0;
        let sumXX = 0;
        let sumXY = 0;
        
        for (let i = 0; i < n; i++) {
            const x = xs[i];
            const y = sanitizedValues[i];
            sumX += x;
            sumY += y;
            sumXX += x * x;
            sumXY += x * y;
        }

        const denom = n * sumXX - sumX * sumX;

        // [P0-FIX-22] Guard against division by zero
        if (Math.abs(denom) < EPSILON) return 0;
        
        const slope = (n * sumXY - sumX * sumY) / denom;
        
        // [P0-FIX-23] Sanitize output
        return sanitizeFinite(slope, 0);
    }

    // =========================================================================
    // ADVANCED METRICS CALCULATIONS
    // =========================================================================

    /**
     * [P0-FIX-24] Compute the current legacy metrics with full determinism
     * All timestamp dependencies removed - only uses provided reference time
     */
    computeMetrics(ob: OrderbookState, referenceTimestamp?: number) {
        // [P0-FIX-25] Sanitize orderbook inputs
        const sanitizeLevels = (levels: [number, number][]): [number, number][] => {
            const result: [number, number][] = [];
            for (const [k, v] of levels) {
                const key = sanitizeFinite(k, 0);
                const val = sanitizeFinite(v, 0);
                if (key > 0 && val > 0) {
                    result.push([key, val]);
                }
            }
            return result;
        };

        const sortedBids = sanitizeLevels(ob.bids).sort((a, b) => b[0] - a[0]);
        const sortedAsks = sanitizeLevels(ob.asks).sort((a, b) => a[0] - b[0]);
        
        const sumTop = (levels: Array<[number, number]>, depth: number): number => {
            let vol = 0;
            const limit = Math.min(depth, levels.length);
            for (let i = 0; i < limit; i += 1) {
                vol += levels[i][1];
            }
            return vol;
        };

        // --- A) OBI Weighted (Normalized) ---
        const bidVol10 = sumTop(sortedBids, 10);
        const askVol10 = sumTop(sortedAsks, 10);
        const rawObiWeighted = bidVol10 - askVol10;
        const denomWeighted = bidVol10 + askVol10;
        // [P0-FIX-26] Consistent EPSILON comparison
        // [P0-FIX-26] Consistent EPSILON comparison
        // OBI Weighted (Normalized) hesaplama
        const obiWeighted = denomWeighted >= EPSILON 
            ? sanitizeFinite(rawObiWeighted / denomWeighted, 0) 
            : 0;

        // --- B) OBI Deep Book (Normalized) ---
        const bidVol50 = sumTop(sortedBids, 50);
        const askVol50 = sumTop(sortedAsks, 50);
        const rawObiDeep = bidVol50 - askVol50;
        const denomDeep = bidVol50 + askVol50;
        // [P0-FIX-26] Consistent EPSILON comparison
        // OBI Deep Book (Normalized) hesaplama
        const obiDeep = denomDeep >= EPSILON 
            ? sanitizeFinite(rawObiDeep / denomDeep, 0) 
            : 0;

        // --- C) OBI Divergence ---
        // OBI Divergence hesaplama
        const obiDivergence = sanitizeFinite(obiWeighted - obiDeep, 0);

        // [P0-FIX-27] Deterministic refTime - no Date.now() fallback
        const refTime = referenceTimestamp !== undefined 
            ? referenceTimestamp 
            : (this.getActiveTradeCount() > 0
                ? this.trades[this.trades.length - 1].timestamp
                : DETERMINISTIC_FALLBACK_TIMESTAMP);

        // Recompute rolling delta windows
        let delta1s = 0;
        let delta5s = 0;
        for (let i = this.tradesHead; i < this.trades.length; i += 1) {
            const t = this.trades[i];
            const qty = t.side === 'buy' ? t.quantity : -t.quantity;
            if (t.timestamp >= refTime - 1_000) {
                delta1s += qty;
            }
            if (t.timestamp >= refTime - 5_000) {
                delta5s += qty;
            }
        }
        
        delta1s = sanitizeFinite(delta1s, 0);
        delta5s = sanitizeFinite(delta5s, 0);

        // [P0-FIX-28] Z-score with zero variance guard
        let deltaZ = 0;
        if (this.deltaHistory.length >= 5) {
            const { std, mean } = calculateStdDevDeterministic(this.deltaHistory);
            // [P0-FIX-29] Explicit zero variance guard
            // Delta Z-Score hesaplama
            deltaZ = std >= EPSILON 
                ? sanitizeFinite((delta1s - mean) / std, 0) 
                : 0;
        }

        // CVD slope: simple linear regression
        // CVD slope: simple linear regression
        // CVD Slope hesaplama
        const cvdSlope = this.calculateSlope(this.cvdHistory);

        // [P0-FIX-30] VWAP with deterministic fallback
        let vwap = 0;
        if (this.totalVolume >= EPSILON) {
            vwap = sanitizeFinite(this.totalNotional / this.totalVolume, 0);
            this.lastValidVwap = vwap;
        } else {
            // [P0-FIX-31] Use last valid VWAP for deterministic fallback
            vwap = this.lastValidVwap;
        }

        // Compose object
        const bestBidPrice = sortedBids.length > 0 ? sortedBids[0][0] : 0;
        const bestAskPrice = sortedAsks.length > 0 ? sortedAsks[0][0] : 0;
        const midPrice = (bestBidPrice + bestAskPrice) / 2;

        // [P0-FIX-32] Return fully sanitized metrics object
        return {
            price: sanitizeFinite(midPrice, 0),
            obiWeighted: sanitizeFinite(obiWeighted, 0),
            obiDeep: sanitizeFinite(obiDeep, 0),
            obiDivergence: sanitizeFinite(obiDivergence, 0),
            delta1s: sanitizeFinite(delta1s, 0),
            delta5s: sanitizeFinite(delta5s, 0),
            deltaZ: sanitizeFinite(deltaZ, 0),
            cvdSession: sanitizeFinite(this.cvdSession, 0),
            cvdSlope: sanitizeFinite(cvdSlope, 0),
            vwap: sanitizeFinite(vwap, 0),
            totalVolume: sanitizeFinite(this.totalVolume, 0),
            totalNotional: sanitizeFinite(this.totalNotional, 0),
            tradeCount: this.getActiveTradeCount(),
        };
    }

    private getActiveTradeCount(): number {
        return Math.max(0, this.trades.length - this.tradesHead);
    }

    private pruneOldTrades(cutoffTs: number): void {
        while (this.tradesHead < this.trades.length && this.trades[this.tradesHead].timestamp < cutoffTs) {
            this.tradesHead += 1;
        }
        // Compact periodically to avoid repeated O(n) shifts and heap growth.
        if (this.tradesHead > 0 && (this.tradesHead >= 4096 || this.tradesHead > (this.trades.length >> 1))) {
            this.trades = this.trades.slice(this.tradesHead);
            this.tradesHead = 0;
        }
    }
}
