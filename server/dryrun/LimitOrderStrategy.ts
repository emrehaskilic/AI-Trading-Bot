import { DryRunOrderBook, DryRunOrderRequest, DryRunSide } from './types';

export type LimitStrategyMode = 'MARKET' | 'PASSIVE' | 'AGGRESSIVE' | 'SPLIT';

export interface LimitOrderStrategyConfig {
  mode: LimitStrategyMode;
  splitLevels: number;
  passiveOffsetBps: number;
  maxSlices: number;
}

const DEFAULT_CONFIG: LimitOrderStrategyConfig = {
  mode: 'MARKET',
  splitLevels: 3,
  passiveOffsetBps: 2,
  maxSlices: 4,
};

function roundTo(value: number, decimals: number): number {
  const m = Math.pow(10, Math.max(0, decimals));
  return Math.round(value * m) / m;
}

export class LimitOrderStrategy {
  private readonly config: LimitOrderStrategyConfig;

  constructor(config?: Partial<LimitOrderStrategyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  buildEntryOrders(params: {
    side: DryRunSide;
    qty: number;
    markPrice: number;
    orderBook: DryRunOrderBook;
    urgency?: number; // 0-1
  }): DryRunOrderRequest[] {
    const { side, qty, markPrice, orderBook } = params;
    if (!(qty > 0) || !(markPrice > 0)) return [];

    const urgency = Math.max(0, Math.min(1, params.urgency ?? 0));
    const mode = urgency > 0.85 ? 'AGGRESSIVE' : this.config.mode;

    if (mode === 'MARKET' || mode === 'AGGRESSIVE') {
      return [{ side, type: 'MARKET', qty, timeInForce: 'IOC', reduceOnly: false }];
    }

    const bestBid = orderBook.bids?.[0]?.price ?? 0;
    const bestAsk = orderBook.asks?.[0]?.price ?? 0;
    if (!(bestBid > 0) || !(bestAsk > 0)) {
      return [{ side, type: 'MARKET', qty, timeInForce: 'IOC', reduceOnly: false }];
    }

    if (mode === 'PASSIVE') {
      const offset = this.config.passiveOffsetBps / 10000;
      const target = side === 'BUY'
        ? bestBid * (1 - offset)
        : bestAsk * (1 + offset);
      return [{
        side,
        type: 'LIMIT',
        qty,
        price: roundTo(target, 6),
        timeInForce: 'GTC',
        reduceOnly: false,
      }];
    }

    // SPLIT
    const levels = Math.max(1, Math.min(this.config.splitLevels, this.config.maxSlices));
    const perSlice = qty / levels;
    const orders: DryRunOrderRequest[] = [];
    const bookLevels = side === 'BUY' ? orderBook.bids : orderBook.asks;
    for (let i = 0; i < levels; i += 1) {
      const lvl = bookLevels?.[i];
      const price = lvl?.price ?? (side === 'BUY' ? bestBid : bestAsk);
      orders.push({
        side,
        type: 'LIMIT',
        qty: roundTo(perSlice, 6),
        price: roundTo(price, 6),
        timeInForce: 'GTC',
        reduceOnly: false,
      });
    }
    return orders;
  }
}
