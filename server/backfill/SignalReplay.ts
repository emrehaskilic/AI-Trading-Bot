import { MarketDataArchive, ArchiveEvent } from './MarketDataArchive';
import { LegacyCalculator } from '../metrics/LegacyCalculator';
import { StrategyEngine } from '../strategy/StrategyEngine';
import { createOrderbookState, applySnapshot } from '../metrics/OrderbookManager';

export interface SignalReplayResult {
  symbol: string;
  signals: Array<{
    timestampMs: number;
    signal: string | null;
    score: number;
    confidence?: string;
  }>;
  sampleCount: number;
}

function updateAtr(history: number[], price: number, window = 14): number {
  history.push(price);
  while (history.length > window + 1) history.shift();
  if (history.length < 2) return 0;
  const diffs = [] as number[];
  for (let i = 1; i < history.length; i += 1) {
    diffs.push(Math.abs(history[i] - history[i - 1]));
  }
  return diffs.reduce((acc, v) => acc + v, 0) / diffs.length;
}

export class SignalReplay {
  constructor(private readonly archive: MarketDataArchive) {}

  async replay(symbol: string, options: { fromMs?: number; toMs?: number; limit?: number } = {}): Promise<SignalReplayResult> {
    const events = await this.archive.loadEvents(symbol, {
      fromMs: options.fromMs,
      toMs: options.toMs,
      limit: options.limit,
      types: ['orderbook', 'trade'],
    });

    const orderbook = createOrderbookState();
    const legacy = new LegacyCalculator();
    const strategy = new StrategyEngine();
    const signals: SignalReplayResult['signals'] = [];
    const priceHistory: number[] = [];
    let atr = 0;

    for (const event of events) {
      if (event.type === 'orderbook') {
        applySnapshot(orderbook, {
          lastUpdateId: event.payload.lastUpdateId || 0,
          bids: event.payload.bids || [],
          asks: event.payload.asks || [],
        });
      }

      if (event.type === 'trade') {
        const price = Number(event.payload.price || event.payload.p || 0);
        const qty = Number(event.payload.quantity || event.payload.q || 0);
        const side = event.payload.side || (event.payload.m ? 'sell' : 'buy');
        if (price > 0) {
          atr = updateAtr(priceHistory, price);
        }
        legacy.addTrade({ price, quantity: qty, side, timestamp: event.timestampMs });
        const metrics = legacy.computeMetrics(orderbook);
        if (metrics) {
          const signal = strategy.compute({
            price,
            atr,
            avgAtr: atr,
            recentHigh: Math.max(...priceHistory, price),
            recentLow: Math.min(...priceHistory, price),
            obi: metrics.obiDeep || 0,
            deltaZ: metrics.deltaZ || 0,
            cvdSlope: metrics.cvdSlope || 0,
            ready: atr > 0,
            vetoReason: atr > 0 ? null : 'NO_ATR',
          });
          signals.push({
            timestampMs: event.timestampMs,
            signal: signal.signal,
            score: signal.score,
            confidence: signal.confidence,
          });
        }
      }
    }

    return { symbol, signals, sampleCount: signals.length };
  }
}
