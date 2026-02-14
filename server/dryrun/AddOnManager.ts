import { DryRunOrderBook, DryRunOrderRequest } from './types';

export interface AddOnManagerConfig {
  minUnrealizedPnlPct: number;
  signalMin: number;
  cooldownMs: number;
  maxCount: number;
  ttlMs: number;
  maxSpreadPct: number;
  maxNotional: number;
}

export interface AddOnDecision {
  order: DryRunOrderRequest;
  addonIndex: number;
}

function roundTo(value: number, decimals: number): number {
  const m = Math.pow(10, Math.max(0, decimals));
  return Math.round(value * m) / m;
}

export class AddOnManager {
  constructor(private readonly config: AddOnManagerConfig) {}

  buildAddOnOrder(params: {
    side: 'LONG' | 'SHORT';
    positionQty: number;
    markPrice: number;
    unrealizedPnlPct: number;
    signalScore: number;
    book: DryRunOrderBook;
    nowMs: number;
    lastAddOnTs: number;
    addonCount: number;
    addonIndex: number;
    hasPendingAddOn: boolean;
    skipCooldown?: boolean;
  }): AddOnDecision | null {
    if (params.addonCount >= this.config.maxCount) return null;
    if (!params.skipCooldown && params.nowMs > 0 && (params.nowMs - params.lastAddOnTs) < this.config.cooldownMs) return null;
    if (params.hasPendingAddOn) return null;
    if (params.unrealizedPnlPct < this.config.minUnrealizedPnlPct) return null;
    if (params.signalScore < this.config.signalMin) return null;

    const bestBid = params.book.bids?.[0]?.price ?? 0;
    const bestAsk = params.book.asks?.[0]?.price ?? 0;
    if (!(bestBid > 0) || !(bestAsk > 0)) return null;
    const mid = (bestBid + bestAsk) / 2;
    const spreadPct = mid > 0 ? (bestAsk - bestBid) / mid : null;
    if (spreadPct != null && spreadPct > this.config.maxSpreadPct) return null;

    const currentNotional = params.positionQty * params.markPrice;
    const availableNotional = Math.max(0, this.config.maxNotional - currentNotional);
    if (availableNotional <= 0) return null;

    const desiredNotional = Math.min(availableNotional, currentNotional * 0.35);
    const qty = desiredNotional / params.markPrice;
    if (!(qty > 0)) return null;

    const orderSide: 'BUY' | 'SELL' = params.side === 'LONG' ? 'BUY' : 'SELL';
    const limitPrice = params.side === 'LONG' ? bestBid : bestAsk;

    return {
      addonIndex: params.addonIndex,
      order: {
        side: orderSide,
        type: 'LIMIT',
        qty: roundTo(qty, 6),
        price: roundTo(limitPrice, 8),
        timeInForce: 'GTC',
        reduceOnly: false,
        postOnly: true,
        ttlMs: this.config.ttlMs,
        reasonCode: 'ADDON_MAKER',
        addonIndex: params.addonIndex,
      },
    };
  }
}
