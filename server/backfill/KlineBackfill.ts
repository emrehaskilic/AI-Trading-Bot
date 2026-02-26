export interface KlineData {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
}

export interface SymbolBackfillState {
    atr: number;
    avgAtr: number;
    recentHigh: number;
    recentLow: number;
    ready: boolean;
    vetoReason: string | null;
}

export class KlineBackfill {
    private symbol: string;
    private state: SymbolBackfillState = {
        atr: 0,
        avgAtr: 0,
        recentHigh: 0,
        recentLow: 0,
        ready: false,
        vetoReason: 'INITIALIZING',
    };

    constructor(symbol: string) {
        this.symbol = symbol;
    }

    public getState(): SymbolBackfillState {
        return this.state;
    }

    public updateFromKlines(klines: KlineData[]): void {
        if (!Array.isArray(klines) || klines.length === 0) {
            this.state.ready = false;
            this.state.vetoReason = 'NO_KLINE_DATA';
            return;
        }

        // Compute ATR (simple average TR + 14-window ATR)
        let totalTr = 0;
        const trSeries: number[] = [];
        for (let i = 1; i < klines.length; i++) {
            const tr = Math.max(
                klines[i].high - klines[i].low,
                Math.abs(klines[i].high - klines[i - 1].close),
                Math.abs(klines[i].low - klines[i - 1].close)
            );
            totalTr += tr;
            trSeries.push(tr);
        }
        this.state.avgAtr = trSeries.length > 0 ? totalTr / trSeries.length : 0;
        const atrWindow = trSeries.slice(-14);
        this.state.atr = atrWindow.length > 0
            ? atrWindow.reduce((sum, v) => sum + v, 0) / atrWindow.length
            : this.state.avgAtr;

        // Recent High/Low
        let high = -Infinity;
        let low = Infinity;
        for (const k of klines) {
            if (k.high > high) high = k.high;
            if (k.low < low) low = k.low;
        }
        this.state.recentHigh = Number.isFinite(high) ? high : 0;
        this.state.recentLow = Number.isFinite(low) ? low : 0;

        if (this.state.atr > 0 && this.state.recentHigh > 0) {
            this.state.ready = true;
            this.state.vetoReason = null;
            return;
        }
        this.state.ready = false;
        this.state.vetoReason = 'ZERO_ATR_OR_LEVELS';
    }

    public markBackfillError(message: string): void {
        this.state.ready = false;
        this.state.vetoReason = `BACKFILL_FAILED: ${message}`;
    }
}
