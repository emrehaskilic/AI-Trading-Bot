export type TradeSide = 'BUY' | 'SELL';

export interface TradeRecord {
  side: TradeSide;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  fees?: number;
  entryTimestampMs?: number;
  exitTimestampMs?: number;
  mae?: number;
  mfe?: number;
}

export interface PrecisionRecallReport {
  longPrecision: number;
  longRecall: number;
  shortPrecision: number;
  shortRecall: number;
  totalWinRate: number;
}

export interface FeeImpactReport {
  totalFees: number;
  grossProfit: number;
  netProfit: number;
  feeToGrossProfitRatio: number;
}

export interface FlipFrequencyReport {
  flips: number;
  flipsPerTrade: number;
  flipsPerDay: number | null;
}

export interface MaeMfeReport {
  maePct: number;
  mfePct: number;
}

function tradeGrossPnL(trade: TradeRecord): number {
  const direction = trade.side === 'BUY' ? 1 : -1;
  return (trade.exitPrice - trade.entryPrice) * trade.quantity * direction;
}

export function calculatePrecisionRecall(trades: TradeRecord[], profitThreshold = 0): PrecisionRecallReport {
  let longWins = 0;
  let longTotal = 0;
  let shortWins = 0;
  let shortTotal = 0;
  let totalWins = 0;

  trades.forEach((trade) => {
    const gross = tradeGrossPnL(trade);
    const net = gross - (trade.fees || 0);
    const isWin = net > profitThreshold;
    if (trade.side === 'BUY') {
      longTotal += 1;
      if (isWin) longWins += 1;
    } else {
      shortTotal += 1;
      if (isWin) shortWins += 1;
    }
    if (isWin) totalWins += 1;
  });

  const longPrecision = longTotal > 0 ? longWins / longTotal : 0;
  const shortPrecision = shortTotal > 0 ? shortWins / shortTotal : 0;
  const total = longTotal + shortTotal;
  const totalWinRate = total > 0 ? totalWins / total : 0;

  return {
    longPrecision,
    longRecall: longPrecision,
    shortPrecision,
    shortRecall: shortPrecision,
    totalWinRate,
  };
}

export function analyzeWinnerExits(trades: TradeRecord[]): { averagePnLToMfe: number; sampleCount: number } {
  const ratios: number[] = [];
  trades.forEach((trade) => {
    const gross = tradeGrossPnL(trade);
    if (gross <= 0 || !Number.isFinite(trade.mfe as number) || (trade.mfe as number) <= 0) return;
    ratios.push(gross / (trade.mfe as number));
  });
  const avg = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  return { averagePnLToMfe: avg, sampleCount: ratios.length };
}

export function analyzeLoserExits(trades: TradeRecord[]): { averagePnLToMae: number; sampleCount: number } {
  const ratios: number[] = [];
  trades.forEach((trade) => {
    const gross = tradeGrossPnL(trade);
    if (gross >= 0 || !Number.isFinite(trade.mae as number) || (trade.mae as number) === 0) return;
    ratios.push(gross / (trade.mae as number));
  });
  const avg = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  return { averagePnLToMae: avg, sampleCount: ratios.length };
}

export function calculateFeeImpact(trades: TradeRecord[]): FeeImpactReport {
  let totalFees = 0;
  let grossProfit = 0;
  let netProfit = 0;
  trades.forEach((trade) => {
    const gross = tradeGrossPnL(trade);
    const fees = trade.fees || 0;
    totalFees += fees;
    grossProfit += gross;
    netProfit += gross - fees;
  });
  const feeToGrossProfitRatio = grossProfit !== 0 ? Math.abs(totalFees / grossProfit) : 0;
  return { totalFees, grossProfit, netProfit, feeToGrossProfitRatio };
}

export function calculateFlipFrequency(trades: TradeRecord[]): FlipFrequencyReport {
  if (trades.length < 2) {
    return { flips: 0, flipsPerTrade: 0, flipsPerDay: null };
  }
  const sorted = [...trades].sort((a, b) => (a.entryTimestampMs || 0) - (b.entryTimestampMs || 0));
  let flips = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].side !== sorted[i - 1].side) {
      flips += 1;
    }
  }
  const flipsPerTrade = flips / (sorted.length - 1);
  const startTs = sorted[0].entryTimestampMs || 0;
  const endTs = sorted[sorted.length - 1].exitTimestampMs || sorted[sorted.length - 1].entryTimestampMs || 0;
  if (startTs > 0 && endTs > startTs) {
    const days = (endTs - startTs) / (24 * 60 * 60 * 1000);
    return { flips, flipsPerTrade, flipsPerDay: days > 0 ? flips / days : null };
  }
  return { flips, flipsPerTrade, flipsPerDay: null };
}

export function calculateAverageGrossEdgePerTrade(trades: TradeRecord[]): number {
  if (trades.length === 0) return 0;
  const total = trades.reduce((acc, trade) => acc + tradeGrossPnL(trade), 0);
  return total / trades.length;
}

export function calculateMaeMfe(entryPrice: number, side: TradeSide, priceSeries: number[]): MaeMfeReport {
  if (!priceSeries.length || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { maePct: 0, mfePct: 0 };
  }
  let mae = 0;
  let mfe = 0;
  for (const price of priceSeries) {
    if (!Number.isFinite(price)) continue;
    const delta = side === 'BUY' ? price - entryPrice : entryPrice - price;
    if (delta < mae) mae = delta;
    if (delta > mfe) mfe = delta;
  }
  return {
    maePct: (mae / entryPrice) * 100,
    mfePct: (mfe / entryPrice) * 100,
  };
}
