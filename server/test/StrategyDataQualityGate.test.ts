function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

import { NewStrategyV11 } from '../strategy/NewStrategyV11';
import { StrategyInput } from '../types/strategy';

function baseInput(nowMs: number, overrides: Partial<StrategyInput> = {}): StrategyInput {
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
      printsPerSecond: 5,
      tradeCount: 20,
      aggressiveBuyVolume: 8,
      aggressiveSellVolume: 10,
      consecutiveBurst: { side: 'sell', count: 4 },
    },
    market: {
      price: 99.6,
      vwap: 100.2,
      delta1s: -0.9,
      delta5s: -1.4,
      deltaZ: -1.6,
      cvdSlope: -0.6,
      obiWeighted: -0.35,
      obiDeep: -0.3,
      obiDivergence: -0.1,
    },
    openInterest: {
      oiChangePct: -0.2,
      lastUpdatedMs: nowMs,
      source: 'real',
    },
    absorption: { value: 0, side: null },
    bootstrap: { backfillDone: true, barsLoaded1m: 1440 },
    htf: {
      m15: { close: 99.5, atr: 1, lastSwingHigh: 101, lastSwingLow: 99, structureBreakUp: false, structureBreakDn: true },
      h1: { close: 99.2, atr: 2, lastSwingHigh: 103, lastSwingLow: 98, structureBreakUp: false, structureBreakDn: false },
    },
    execution: { tradeReady: true, addonReady: true, vetoReason: null },
    volatility: 0.8,
    position: null,
    ...overrides,
  };
}

export function runTests() {
  const strategy = new NewStrategyV11();
  const nowMs = 2_000_000;

  const toleratesModeratelyStaleBook = strategy.evaluate(baseInput(nowMs, {
    orderbook: {
      lastUpdatedMs: nowMs - 3_500,
      spreadPct: 0.05,
      bestBid: 100,
      bestAsk: 100.1,
    },
    trades: {
      lastUpdatedMs: nowMs,
      printsPerSecond: 3,
      tradeCount: 22,
      aggressiveBuyVolume: 5,
      aggressiveSellVolume: 14,
      consecutiveBurst: { side: 'sell', count: 5 },
    },
  }));
  assert(
    !toleratesModeratelyStaleBook.reasons.includes('GATE_STALE_ORDERBOOK'),
    'trend runtime should not block on a 3.5s book lag when top-of-book exists and prints are healthy'
  );

  const toleratesSoftStaleBookWithHealthyTape = strategy.evaluate(baseInput(nowMs, {
    orderbook: {
      lastUpdatedMs: nowMs - 9_000,
      spreadPct: 0.05,
      bestBid: 100,
      bestAsk: 100.1,
    },
  }));
  assert(
    !toleratesSoftStaleBookWithHealthyTape.reasons.includes('GATE_STALE_ORDERBOOK'),
    'trend runtime should tolerate a 9s book lag when top-of-book exists and the tape is healthy'
  );

  const blocksSoftStaleBookWhenTapeIsThin = strategy.evaluate(baseInput(nowMs, {
    orderbook: {
      lastUpdatedMs: nowMs - 9_000,
      spreadPct: 0.05,
      bestBid: 100,
      bestAsk: 100.1,
    },
    trades: {
      lastUpdatedMs: nowMs,
      printsPerSecond: 0.4,
      tradeCount: 8,
      aggressiveBuyVolume: 1,
      aggressiveSellVolume: 2,
      consecutiveBurst: { side: 'sell', count: 1 },
    },
  }));
  assert(
    blocksSoftStaleBookWhenTapeIsThin.reasons.includes('GATE_STALE_ORDERBOOK'),
    'soft-stale orderbook should still block trading when the tape is thin'
  );

  const blocksHardStaleBook = strategy.evaluate(baseInput(nowMs, {
    orderbook: {
      lastUpdatedMs: nowMs - 16_000,
      spreadPct: 0.05,
      bestBid: 100,
      bestAsk: 100.1,
    },
  }));
  assert(
    blocksHardStaleBook.reasons.includes('GATE_STALE_ORDERBOOK'),
    'very stale orderbook should still block trading'
  );

  const blocksUntrustedOrderbookEvenWhenLagLooksFine = strategy.evaluate(baseInput(nowMs, {
    execution: {
      tradeReady: true,
      addonReady: true,
      vetoReason: null,
      orderbookTrusted: false,
      integrityLevel: 'CRITICAL',
    },
    orderbook: {
      lastUpdatedMs: nowMs,
      spreadPct: 0.05,
      bestBid: 100,
      bestAsk: 100.1,
    },
  }));
  assert(
    blocksUntrustedOrderbookEvenWhenLagLooksFine.reasons.includes('GATE_STALE_ORDERBOOK'),
    'strategy must freeze new trading when runtime marks the orderbook as untrusted'
  );

  const blocksMissingTopOfBook = strategy.evaluate(baseInput(nowMs, {
    orderbook: {
      lastUpdatedMs: nowMs,
      spreadPct: 0.05,
      bestBid: null,
      bestAsk: null,
    },
  }));
  assert(
    blocksMissingTopOfBook.reasons.includes('GATE_STALE_ORDERBOOK'),
    'missing top-of-book should still block trading'
  );
}
