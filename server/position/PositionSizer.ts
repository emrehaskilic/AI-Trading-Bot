export interface PositionSizerInput {
  equity: number;
  riskPerTradePct: number;
  entryPrice: number;
  stopLossPrice: number;
  minQty?: number;
  quantityPrecision?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const roundTo = (value: number, decimals: number): number => {
  const m = Math.pow(10, Math.max(0, decimals));
  return Math.round(value * m) / m;
};

export class PositionSizer {
  static calculateQuantity(input: PositionSizerInput): number {
    const equity = Number(input.equity);
    const entryPrice = Number(input.entryPrice);
    const stopLossPrice = Number(input.stopLossPrice);
    const riskPerTradePct = clamp(Number(input.riskPerTradePct), 0.0001, 1);
    const minQty = Math.max(0, Number(input.minQty ?? 0));
    const precision = Math.max(0, Math.trunc(Number(input.quantityPrecision ?? 6)));

    if (!(equity > 0) || !(entryPrice > 0) || !(stopLossPrice > 0)) {
      return 0;
    }

    const riskAmount = equity * riskPerTradePct;
    const stopDistance = Math.abs(entryPrice - stopLossPrice);
    if (!(stopDistance > 0)) {
      return 0;
    }

    const rawQty = riskAmount / stopDistance;
    const qty = roundTo(Math.max(minQty, rawQty), precision);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
  }
}
