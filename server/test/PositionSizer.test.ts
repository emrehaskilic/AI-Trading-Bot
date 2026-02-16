import { PositionSizer } from '../position/PositionSizer';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function runTests() {
  {
    const qty = PositionSizer.calculateQuantity({
      equity: 10_000,
      riskPerTradePct: 0.01,
      entryPrice: 50_000,
      stopLossPrice: 49_500,
      minQty: 0.001,
      quantityPrecision: 6,
    });
    assert(qty > 0, 'quantity should be positive');
  }

  {
    const qty = PositionSizer.calculateQuantity({
      equity: 0,
      riskPerTradePct: 0.01,
      entryPrice: 50_000,
      stopLossPrice: 49_500,
    });
    assert(qty === 0, 'invalid equity should return zero quantity');
  }
}
