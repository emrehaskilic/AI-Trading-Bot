function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

import { NewStrategyV11 } from '../strategy/NewStrategyV11';
import { StrategyInput, StrategyPositionState } from '../types/strategy';

function makeInput(nowMs: number, overrides: Partial<StrategyInput> = {}): StrategyInput {
  return {
    symbol: 'TEST',
    nowMs,
    source: 'real',
    orderbook: {
      lastUpdatedMs: nowMs,
      spreadPct: 0.05,
      bestBid: 100,
      bestAsk: 100.1,
    },
    trades: {
      lastUpdatedMs: nowMs,
      printsPerSecond: 8,
      tradeCount: 30,
      aggressiveBuyVolume: 18,
      aggressiveSellVolume: 4,
      consecutiveBurst: { side: 'buy', count: 6 },
    },
    market: {
      price: 101,
      vwap: 100,
      delta1s: 1.5,
      delta5s: 2.2,
      deltaZ: 2.8,
      cvdSlope: 0.9,
      obiWeighted: 0.8,
      obiDeep: 0.8,
      obiDivergence: 0.2,
    },
    openInterest: null,
    absorption: { value: 1, side: 'buy' },
    bootstrap: { backfillDone: true, barsLoaded1m: 1440 },
    htf: {
      m15: { close: 101, atr: 1, lastSwingHigh: 102, lastSwingLow: 99, structureBreakUp: true, structureBreakDn: false },
      h1: { close: 101, atr: 2, lastSwingHigh: 103, lastSwingLow: 98, structureBreakUp: false, structureBreakDn: false },
    },
    execution: { tradeReady: true, addonReady: true, vetoReason: null },
    volatility: 0.5,
    position: null,
    ...overrides,
  };
}

function warm(strategy: NewStrategyV11, startMs: number): void {
  for (let i = 0; i < 20; i += 1) {
    strategy.evaluate(makeInput(startMs + (i * 1000), {
      market: {
        price: 100,
        vwap: 100,
        delta1s: -0.2,
        delta5s: -0.3,
        deltaZ: -0.3,
        cvdSlope: -0.1,
        obiWeighted: -0.1,
        obiDeep: -0.1,
        obiDivergence: -0.02,
      },
      trades: {
        lastUpdatedMs: startMs + (i * 1000),
        printsPerSecond: 3,
        tradeCount: 15,
        aggressiveBuyVolume: 3,
        aggressiveSellVolume: 6,
        consecutiveBurst: { side: 'sell', count: 2 },
      },
      absorption: { value: 0, side: null },
    }));
  }
}

export function runTests() {
  const trendFilterStrategy = new NewStrategyV11({
    mhtTRs: 0,
    mhtMRs: 0,
    mhtEVs: 0,
    cooldownSameS: 0,
    cooldownFlipS: 0,
  });
  warm(trendFilterStrategy, 3_000_000);
  const blockedTrendEntry = trendFilterStrategy.evaluate(makeInput(3_030_000, {
    market: {
      price: 101.2,
      vwap: 100,
      delta1s: 1.8,
      delta5s: 2.4,
      deltaZ: 3.0,
      cvdSlope: 1.1,
      obiWeighted: -0.15,
      obiDeep: 0.75,
      obiDivergence: 0.1,
    },
  }));
  assert(
    blockedTrendEntry.reasons.includes('ENTRY_BLOCKED_FILTERS'),
    'trend entry should be blocked when weighted book disagrees with the move'
  );

  const addGuardStrategy = new NewStrategyV11();
  warm(addGuardStrategy, 4_000_000);
  const smallWinner: StrategyPositionState = {
    side: 'LONG',
    qty: 1,
    entryPrice: 100,
    unrealizedPnlPct: 0.001,
    addsUsed: 0,
    timeInPositionMs: 10_000,
  };
  const winnerAddBlocked = addGuardStrategy.evaluate(makeInput(4_030_000, {
    position: smallWinner,
  }));
  assert(
    !winnerAddBlocked.actions.some((action) => action.type === 'ADD'),
    'winner add should wait for pnl cushion and minimum hold time'
  );

  const stopStrategy = new NewStrategyV11();
  warm(stopStrategy, 5_000_000);
  const losingPosition: StrategyPositionState = {
    side: 'LONG',
    qty: 1,
    entryPrice: 100,
    unrealizedPnlPct: -0.013,
    addsUsed: 0,
    timeInPositionMs: 60_000,
  };
  const stopDecision = stopStrategy.evaluate(makeInput(5_030_000, {
    position: losingPosition,
    market: {
      price: 98.7,
      vwap: 99.8,
      delta1s: -1.5,
      delta5s: -1.9,
      deltaZ: -2.4,
      cvdSlope: -0.8,
      obiWeighted: -0.5,
      obiDeep: -0.6,
      obiDivergence: -0.2,
    },
    trades: {
      lastUpdatedMs: 5_030_000,
      printsPerSecond: 7,
      tradeCount: 25,
      aggressiveBuyVolume: 4,
      aggressiveSellVolume: 16,
      consecutiveBurst: { side: 'sell', count: 5 },
    },
    absorption: { value: 1, side: 'sell' },
  }));
  assert(
    stopDecision.actions.some((action) => action.type === 'EXIT' && action.reason === 'EXIT_STOP_LOSS'),
    'default stop profile should cut losers before they become emergency exits'
  );

  const neutralBiasTrendStrategy = new NewStrategyV11({
    mhtTRs: 0,
    mhtMRs: 0,
    mhtEVs: 0,
    cooldownSameS: 0,
    cooldownFlipS: 0,
  });
  warm(neutralBiasTrendStrategy, 6_000_000);
  const neutralBiasEntry = neutralBiasTrendStrategy.evaluate(makeInput(6_030_000, {
    orderbook: {
      lastUpdatedMs: 6_030_000,
      spreadPct: 0.0001,
      bestBid: 100,
      bestAsk: 100.01,
    },
    market: {
      price: 100.35,
      vwap: 100,
      delta1s: 1.2,
      delta5s: 1.8,
      deltaZ: 2.1,
      cvdSlope: 0.8,
      obiWeighted: 0.05,
      obiDeep: 0.04,
      obiDivergence: 0.1,
    },
    trades: {
      lastUpdatedMs: 6_030_000,
      printsPerSecond: 10,
      tradeCount: 40,
      aggressiveBuyVolume: 20,
      aggressiveSellVolume: 5,
      consecutiveBurst: { side: 'buy', count: 7 },
    },
    htf: {
      m15: {
        close: 100.2,
        atr: 0.8,
        lastSwingHigh: 101,
        lastSwingLow: 99,
        structureBreakUp: false,
        structureBreakDn: false,
      },
      h1: {
        close: 100.3,
        atr: 1.6,
        lastSwingHigh: 102,
        lastSwingLow: 98,
        structureBreakUp: false,
        structureBreakDn: false,
      },
    },
  }));
  assert(
    neutralBiasEntry.actions.some((action) => action.type === 'ENTRY' && action.side === 'LONG'),
    'liquid neutral-bias continuation should allow earlier trend entries'
  );

  const neutralBiasShortStrategy = new NewStrategyV11({
    mhtTRs: 0,
    mhtMRs: 0,
    mhtEVs: 0,
    cooldownSameS: 0,
    cooldownFlipS: 0,
  });
  warm(neutralBiasShortStrategy, 6_500_000);
  const neutralBiasShort = neutralBiasShortStrategy.evaluate(makeInput(6_530_000, {
    orderbook: {
      lastUpdatedMs: 6_530_000,
      spreadPct: 0.0001,
      bestBid: 100,
      bestAsk: 100.01,
    },
    market: {
      price: 99.7,
      vwap: 100,
      delta1s: -1.4,
      delta5s: -1.9,
      deltaZ: -3.4,
      cvdSlope: -0.35,
      obiWeighted: -0.01,
      obiDeep: -0.08,
      obiDivergence: -0.05,
    },
    trades: {
      lastUpdatedMs: 6_530_000,
      printsPerSecond: 12,
      tradeCount: 45,
      aggressiveBuyVolume: 5,
      aggressiveSellVolume: 24,
      consecutiveBurst: { side: 'sell', count: 8 },
    },
    htf: {
      m15: {
        close: 99.8,
        atr: 0.8,
        lastSwingHigh: 101,
        lastSwingLow: 99,
        structureBreakUp: false,
        structureBreakDn: false,
      },
      h1: {
        close: 99.7,
        atr: 1.7,
        lastSwingHigh: 102,
        lastSwingLow: 98,
        structureBreakUp: false,
        structureBreakDn: false,
      },
    },
  }));
  assert(
    neutralBiasShort.actions.some((action) => action.type === 'ENTRY' && action.side === 'SHORT'),
    'neutral-bias MR continuation should allow aligned short entries when 3m flow is decisive'
  );

  const inferredTrendBiasLongStrategy = new NewStrategyV11({
    mhtTRs: 0,
    mhtMRs: 0,
    mhtEVs: 0,
    cooldownSameS: 0,
    cooldownFlipS: 0,
  });
  warm(inferredTrendBiasLongStrategy, 6_800_000);
  const inferredTrendBiasLong = inferredTrendBiasLongStrategy.evaluate(makeInput(6_830_000, {
    orderbook: {
      lastUpdatedMs: 6_830_000,
      spreadPct: 0.0008,
      bestBid: 100.84,
      bestAsk: 100.86,
    },
    market: {
      price: 100.85,
      vwap: 100.3,
      delta1s: 0.8,
      delta5s: 1.1,
      deltaZ: 1.5,
      cvdSlope: 0.25,
      obiWeighted: 0.14,
      obiDeep: 0.22,
      obiDivergence: 0.05,
    },
    trades: {
      lastUpdatedMs: 6_830_000,
      printsPerSecond: 7,
      tradeCount: 28,
      aggressiveBuyVolume: 16,
      aggressiveSellVolume: 6,
      consecutiveBurst: { side: 'buy', count: 5 },
    },
    htf: {
      m15: {
        close: 100.9,
        atr: 0.6,
        lastSwingHigh: 101.15,
        lastSwingLow: 99.7,
        structureBreakUp: false,
        structureBreakDn: false,
      },
      h1: {
        close: 101.1,
        atr: 1.5,
        lastSwingHigh: 103,
        lastSwingLow: 98.8,
        structureBreakUp: false,
        structureBreakDn: false,
      },
    },
  }));
  assert(
    inferredTrendBiasLong.actions.some((action) => action.type === 'ENTRY' && action.side === 'LONG'),
    '15m bias should stay bullish inside the upper swing range even before a formal structure break'
  );

  const inferredTrendBiasShortStrategy = new NewStrategyV11({
    mhtTRs: 0,
    mhtMRs: 0,
    mhtEVs: 0,
    cooldownSameS: 0,
    cooldownFlipS: 0,
  });
  warm(inferredTrendBiasShortStrategy, 6_900_000);
  const inferredTrendBiasShort = inferredTrendBiasShortStrategy.evaluate(makeInput(6_930_000, {
    orderbook: {
      lastUpdatedMs: 6_930_000,
      spreadPct: 0.0008,
      bestBid: 99.26,
      bestAsk: 99.28,
    },
    market: {
      price: 99.27,
      vwap: 99.7,
      delta1s: -0.9,
      delta5s: -1.3,
      deltaZ: -1.7,
      cvdSlope: -0.3,
      obiWeighted: -0.16,
      obiDeep: -0.24,
      obiDivergence: -0.06,
    },
    trades: {
      lastUpdatedMs: 6_930_000,
      printsPerSecond: 7,
      tradeCount: 30,
      aggressiveBuyVolume: 5,
      aggressiveSellVolume: 17,
      consecutiveBurst: { side: 'sell', count: 5 },
    },
    htf: {
      m15: {
        close: 99.25,
        atr: 0.65,
        lastSwingHigh: 100.6,
        lastSwingLow: 99.1,
        structureBreakUp: false,
        structureBreakDn: false,
      },
      h1: {
        close: 99.1,
        atr: 1.7,
        lastSwingHigh: 102.4,
        lastSwingLow: 98.7,
        structureBreakUp: false,
        structureBreakDn: false,
      },
    },
  }));
  assert(
    inferredTrendBiasShort.actions.some((action) => action.type === 'ENTRY' && action.side === 'SHORT'),
    '15m bias should stay bearish inside the lower swing range even before a formal structure break'
  );

  const carryProtectStrategy = new NewStrategyV11({
    freshSoftReduceProtectS: 0,
    freshExitProtectS: 0,
    hardRevTicks: 6,
  });
  warm(carryProtectStrategy, 7_000_000);
  carryProtectStrategy.evaluate(makeInput(7_030_000, {
    market: {
      price: 99.6,
      vwap: 100.1,
      delta1s: -2.2,
      delta5s: -2.4,
      deltaZ: -2.8,
      cvdSlope: -1.1,
      obiWeighted: -0.7,
      obiDeep: -0.8,
      obiDivergence: -0.2,
    },
    trades: {
      lastUpdatedMs: 7_030_000,
      printsPerSecond: 10,
      tradeCount: 34,
      aggressiveBuyVolume: 4,
      aggressiveSellVolume: 22,
      consecutiveBurst: { side: 'sell', count: 7 },
    },
    htf: {
      m15: { close: 99.7, atr: 1, lastSwingHigh: 101, lastSwingLow: 99, structureBreakUp: false, structureBreakDn: true },
      h1: { close: 99.9, atr: 2, lastSwingHigh: 103, lastSwingLow: 98, structureBreakUp: false, structureBreakDn: false },
    },
  }));
  const carryProtectDecision = carryProtectStrategy.evaluate(makeInput(7_031_000, {
    position: {
      side: 'SHORT',
      qty: 1,
      entryPrice: 100.1,
      unrealizedPnlPct: 0.004,
      addsUsed: 0,
      timeInPositionMs: 7 * 60 * 1000,
    },
    market: {
      price: 99.85,
      vwap: 99.9,
      delta1s: -0.4,
      delta5s: -0.3,
      deltaZ: -0.35,
      cvdSlope: -0.12,
      obiWeighted: -0.04,
      obiDeep: -0.03,
      obiDivergence: -0.01,
    },
    trades: {
      lastUpdatedMs: 7_031_000,
      printsPerSecond: 7,
      tradeCount: 24,
      aggressiveBuyVolume: 7,
      aggressiveSellVolume: 10,
      consecutiveBurst: { side: 'sell', count: 3 },
    },
    htf: {
      m15: { close: 99.8, atr: 1, lastSwingHigh: 101, lastSwingLow: 99, structureBreakUp: false, structureBreakDn: true },
      h1: { close: 99.9, atr: 2, lastSwingHigh: 103, lastSwingLow: 98, structureBreakUp: false, structureBreakDn: false },
    },
  }));
  assert(
    !carryProtectDecision.actions.some((action) => action.type === 'REDUCE' || action.type === 'EXIT'),
    'aligned trend shorts should not trim or hard-exit during the first carry window on mild pullbacks'
  );

  const carryTrailingStrategy = new NewStrategyV11({
    freshSoftReduceProtectS: 0,
    freshExitProtectS: 0,
    hardRevTicks: 6,
  });
  warm(carryTrailingStrategy, 7_200_000);
  const trailingDecision = carryTrailingStrategy.evaluate(makeInput(7_230_000, {
    position: {
      side: 'LONG',
      qty: 1,
      entryPrice: 100,
      unrealizedPnlPct: 0.0055,
      peakPnlPct: 0.0105,
      addsUsed: 0,
      timeInPositionMs: 16 * 60 * 1000,
    },
    market: {
      price: 100.4,
      vwap: 100.65,
      delta1s: -1.4,
      delta5s: -1.2,
      deltaZ: -1.35,
      cvdSlope: -0.35,
      obiWeighted: -0.08,
      obiDeep: -0.06,
      obiDivergence: -0.09,
    },
    trades: {
      lastUpdatedMs: 7_230_000,
      printsPerSecond: 8,
      tradeCount: 26,
      aggressiveBuyVolume: 6,
      aggressiveSellVolume: 15,
      consecutiveBurst: { side: 'sell', count: 5 },
    },
    htf: {
      m15: { close: 100.45, atr: 1, lastSwingHigh: 102, lastSwingLow: 99.7, structureBreakUp: true, structureBreakDn: false },
      h1: { close: 100.8, atr: 2, lastSwingHigh: 103, lastSwingLow: 98.5, structureBreakUp: false, structureBreakDn: false },
    },
  }));
  assert(
    trailingDecision.actions.some((action) => action.type === 'REDUCE' && action.reason === 'REDUCE_SOFT'),
    'trend carry winners should trim only after meaningful profit giveback and structure pressure'
  );

  const carryExitStrategy = new NewStrategyV11({
    freshExitProtectS: 0,
    hardRevTicks: 6,
  });
  warm(carryExitStrategy, 7_400_000);
  const hardExitDecision = carryExitStrategy.evaluate(makeInput(7_430_000, {
    position: {
      side: 'LONG',
      qty: 1,
      entryPrice: 100,
      unrealizedPnlPct: 0.0035,
      peakPnlPct: 0.0105,
      addsUsed: 0,
      timeInPositionMs: 20 * 60 * 1000,
    },
    market: {
      price: 99.92,
      vwap: 100.45,
      delta1s: -4.2,
      delta5s: -1.6,
      deltaZ: -3.4,
      cvdSlope: -1.35,
      obiWeighted: -0.22,
      obiDeep: -0.52,
      obiDivergence: -0.18,
    },
    trades: {
      lastUpdatedMs: 7_430_000,
      printsPerSecond: 9,
      tradeCount: 32,
      aggressiveBuyVolume: 4,
      aggressiveSellVolume: 20,
      consecutiveBurst: { side: 'sell', count: 9 },
    },
    htf: {
      m15: { close: 100, atr: 1, lastSwingHigh: 102, lastSwingLow: 99.4, structureBreakUp: false, structureBreakDn: true },
      h1: { close: 99.9, atr: 2, lastSwingHigh: 103, lastSwingLow: 98.3, structureBreakUp: false, structureBreakDn: true },
    },
  }));
  assert(
    hardExitDecision.actions.some((action) => action.type === 'EXIT' && action.reason === 'EXIT_HARD'),
    'trend carry winners should hard-exit after severe opposite pressure once profit giveback is large enough'
  );
}
