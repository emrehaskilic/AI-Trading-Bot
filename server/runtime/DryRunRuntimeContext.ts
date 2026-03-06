export type RuntimeBias = 'UP' | 'DOWN' | 'NEUTRAL';
export type RuntimeTrendState = 'UPTREND' | 'DOWNTREND' | 'PULLBACK_UP' | 'PULLBACK_DOWN' | 'RANGE';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function deriveDryRunRuntimeContext(input: {
  bias15m: RuntimeBias;
  trendinessScore?: number | null;
  deltaZ?: number | null;
  cvdSlope?: number | null;
  obiWeighted?: number | null;
  trendPrice?: number | null;
  sessionVwap?: number | null;
  bookMidPrice?: number | null;
  referenceTradePrice?: number | null;
}): {
  trendState: RuntimeTrendState;
  trendConfidence: number;
  bookMarkDeviationPct: number | null;
} {
  const trendPrice = Number(input.trendPrice || 0);
  const sessionVwap = Number(input.sessionVwap || 0);
  const bookMidPrice = Number(input.bookMidPrice || 0);
  const referenceTradePrice = Number(input.referenceTradePrice || 0);
  const deltaZ = Number(input.deltaZ || 0);
  const cvdSlope = Number(input.cvdSlope || 0);
  const obiWeighted = Number(input.obiWeighted || 0);
  const trendinessScore = Number(input.trendinessScore || 0);

  const trendState: RuntimeTrendState = input.bias15m === 'UP'
    ? (trendPrice >= sessionVwap ? 'UPTREND' : 'PULLBACK_UP')
    : input.bias15m === 'DOWN'
      ? (trendPrice <= sessionVwap ? 'DOWNTREND' : 'PULLBACK_DOWN')
      : 'RANGE';

  const trendConfidence = clamp01(
    (Math.abs(trendinessScore) * 0.6)
    + (Math.min(2, Math.abs(deltaZ)) * 0.1)
    + (Math.min(2, Math.abs(cvdSlope)) * 0.1)
    + (Math.min(1, Math.abs(obiWeighted)) * 0.2)
  );

  const bookMarkDeviationPct = bookMidPrice > 0 && referenceTradePrice > 0
    ? Math.abs(((bookMidPrice - referenceTradePrice) / referenceTradePrice) * 100)
    : null;

  return {
    trendState,
    trendConfidence,
    bookMarkDeviationPct,
  };
}
