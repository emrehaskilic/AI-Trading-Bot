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
}
