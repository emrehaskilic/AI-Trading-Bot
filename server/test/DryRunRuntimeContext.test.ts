function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

import { deriveDryRunRuntimeContext } from '../runtime/DryRunRuntimeContext';

export function runTests() {
  const withoutReferenceTrade = deriveDryRunRuntimeContext({
    bias15m: 'DOWN',
    trendinessScore: 0.9,
    deltaZ: -1.4,
    cvdSlope: -0.8,
    obiWeighted: -0.3,
    trendPrice: 99,
    sessionVwap: 101,
    bookMidPrice: 99,
    referenceTradePrice: null,
  });
  assert(withoutReferenceTrade.trendState === 'DOWNTREND', 'trend state should still derive from price vs vwap');
  assert(withoutReferenceTrade.bookMarkDeviationPct === null, 'book-mark deviation should stay null without an independent trade reference');

  const withReferenceTrade = deriveDryRunRuntimeContext({
    bias15m: 'UP',
    trendinessScore: 0.7,
    deltaZ: 1.1,
    cvdSlope: 0.4,
    obiWeighted: 0.2,
    trendPrice: 101,
    sessionVwap: 100,
    bookMidPrice: 101,
    referenceTradePrice: 100.5,
  });
  assert(withReferenceTrade.trendState === 'UPTREND', 'up bias should map to uptrend when trend price holds above vwap');
  assert(
    Number(withReferenceTrade.bookMarkDeviationPct) > 0.4 && Number(withReferenceTrade.bookMarkDeviationPct) < 0.6,
    'book-mark deviation should use book mid vs reference trade price, not vwap distance'
  );
}
