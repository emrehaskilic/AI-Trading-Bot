import { OrderbookState, bestBid, bestAsk } from './OrderbookManager';

// Type for a trade used in the legacy metrics calculations
interface LegacyTrade {
    price: number;
    quantity: number;
    side: 'buy' | 'sell';
    timestamp: number;
}

/**
 * LegacyCalculator computes additional orderflow metrics that were
 * previously derived on the client.  These include various orderbook
 * imbalance scores, rolling delta windows, Z‐scores and session CVD
 * slope.  The implementation strives to be lightweight but still
 * produce values compatible with the original UI expectations.
 */
export class LegacyCalculator {
    // Keep a rolling list of trades for delta calculations (max 10 seconds)
    private trades: LegacyTrade[] = [];
    // List of recent delta1s values for Z‐score computation
    private deltaHistory: number[] = [];
    // List of recent session CVD values for slope computation
    private cvdHistory: number[] = [];
    private cvdSession = 0;
    private totalVolume = 0;
    private totalNotional = 0;

    /**
     * Add a trade to the calculator.  Updates rolling windows and
     * cumulative session CVD/volume/notional statistics.
     */
    addTrade(trade: LegacyTrade) {
        const now = trade.timestamp;
        // Push new trade
        this.trades.push(trade);
        // Update session metrics
        this.totalVolume += trade.quantity;
        this.totalNotional += trade.quantity * trade.price;
        this.cvdSession += trade.side === 'buy' ? trade.quantity : -trade.quantity;
        // Remove old trades beyond 10 seconds
        const cutoff = now - 10_000;
        while (this.trades.length > 0 && this.trades[0].timestamp < cutoff) {
            this.trades.shift();
        }
        // Every trade, recompute delta1s and store for Z‐score.  Compute
        // delta1s as net volume over last 1s.
        const oneSecCutoff = now - 1_000;
        let delta1s = 0;
        let delta5s = 0;
        let count1s = 0;
        for (const t of this.trades) {
            if (t.timestamp >= oneSecCutoff) {
                delta1s += t.side === 'buy' ? t.quantity : -t.quantity;
                count1s++;
            }
            if (t.timestamp >= now - 5_000) {
                delta5s += t.side === 'buy' ? t.quantity : -t.quantity;
            }
        }
        // Store delta1s history for Z calculation (limit 60 entries)
        this.deltaHistory.push(delta1s);
        if (this.deltaHistory.length > 60) {
            this.deltaHistory.shift();
        }
        // Store cvdSession history for slope calculation (limit 60 entries)
        this.cvdHistory.push(this.cvdSession);
        if (this.cvdHistory.length > 60) {
            this.cvdHistory.shift();
        }
    }

    /**
     * Compute the current legacy metrics given the current orderbook
     * state.  The orderbook is used to derive imbalance scores.  The
     * function returns an object containing all metrics required for
     * the original UI.  Undefined values are returned as null.
     */
    computeMetrics(ob: OrderbookState) {
        // Calculate weighted orderbook imbalance using top 10 levels
        const calcObi = (levels: Map<number, number>, depth: number): number => {
            // Convert map to sorted array (desc for bids, asc for asks)
            const entries = Array.from(levels.entries());
            entries.sort((a, b) => b[0] - a[0]);
            let volBid = 0;
            for (let i = 0; i < Math.min(depth, entries.length); i++) {
                volBid += entries[i][1];
            }
            return volBid;
        };
        // Weighted OBI: difference of top 10 bid and ask volumes
        const bidVol10 = calcObi(ob.bids, 10);
        // For asks we need ascending sort
        const askEntries = Array.from(ob.asks.entries());
        askEntries.sort((a, b) => a[0] - b[0]);
        let askVol10 = 0;
        for (let i = 0; i < Math.min(10, askEntries.length); i++) {
            askVol10 += askEntries[i][1];
        }
        const obiWeighted = bidVol10 - askVol10;
        // Deep OBI: top 50 levels difference
        const bidVol50 = calcObi(ob.bids, 50);
        let askVol50 = 0;
        for (let i = 0; i < Math.min(50, askEntries.length); i++) {
            askVol50 += askEntries[i][1];
        }
        const obiDeep = bidVol50 - askVol50;
        const obiDivergence = obiWeighted - obiDeep;
        // Recompute rolling delta windows based on current time.  Using
        // current timestamp ensures the 1s/5s windows reflect the last
        // second and last five seconds rather than the last trade time.
        const now = Date.now();
        let delta1s = 0;
        let delta5s = 0;
        for (const t of this.trades) {
            if (t.timestamp >= now - 1_000) {
                delta1s += t.side === 'buy' ? t.quantity : -t.quantity;
            }
            if (t.timestamp >= now - 5_000) {
                delta5s += t.side === 'buy' ? t.quantity : -t.quantity;
            }
        }
        // Z‐score of delta1s: (value - mean) / std
        let deltaZ = 0;
        if (this.deltaHistory.length >= 5) {
            const mean = this.deltaHistory.reduce((a, b) => a + b, 0) / this.deltaHistory.length;
            const variance = this.deltaHistory.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / this.deltaHistory.length;
            const std = Math.sqrt(variance) || 1;
            deltaZ = (delta1s - mean) / std;
        }
        // CVD slope: simple linear regression on the last cvdHistory values
        let cvdSlope = 0;
        const historyLen = this.cvdHistory.length;
        if (historyLen >= 2) {
            // Compute slope using least squares
            const xs = [...Array(historyLen).keys()].map(i => i);
            const ys = this.cvdHistory;
            const n = historyLen;
            const sumX = xs.reduce((a, b) => a + b, 0);
            const sumY = ys.reduce((a, b) => a + b, 0);
            const sumXX = xs.reduce((a, b) => a + b * b, 0);
            const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
            const denom = n * sumXX - sumX * sumX;
            if (denom !== 0) {
                cvdSlope = (n * sumXY - sumX * sumY) / denom;
            }
        }
        // VWAP: totalNotional / totalVolume
        const vwap = this.totalVolume > 0 ? this.totalNotional / this.totalVolume : 0;
        // Compose object
        const bestBidPrice = bestBid(ob) ?? 0;
        const bestAskPrice = bestAsk(ob) ?? 0;
        const midPrice = (bestBidPrice + bestAskPrice) / 2;
        return {
            price: midPrice,
            obiWeighted,
            obiDeep,
            obiDivergence,
            delta1s,
            delta5s,
            deltaZ,
            cvdSession: this.cvdSession,
            cvdSlope,
            vwap,
            totalVolume: this.totalVolume,
            totalNotional: this.totalNotional,
            // Advanced legacy metrics currently not computed on the server.
            // These fields mirror the original client metrics and are set to 0 by
            // default. They can be implemented later by porting the client
            // logic from useBinanceSocket.ts.  Keeping them present avoids
            // breaking the UI which expects these properties.
            absorptionScore: 0,
            sweepFadeScore: 0,
            breakoutScore: 0,
            regimeWeight: 0,
            tradeCount: this.trades.length
        };
    }
}