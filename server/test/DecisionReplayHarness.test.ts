// Minimal assertion helper
function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { replayDecisionLogFile } from '../replay/DecisionReplayHarness';
import { NewStrategyV11 } from '../strategy/NewStrategyV11';
import { StrategyInput } from '../types/strategy';

function makeInput(nowMs: number, overrides: Partial<StrategyInput> = {}): StrategyInput {
  return {
    symbol: 'BTCUSDT',
    nowMs,
    source: 'real',
    orderbook: {
      lastUpdatedMs: nowMs,
      spreadPct: 0.02,
      bestBid: 100,
      bestAsk: 100.1,
    },
    trades: {
      lastUpdatedMs: nowMs,
      printsPerSecond: 8,
      tradeCount: 20,
      aggressiveBuyVolume: 12,
      aggressiveSellVolume: 4,
      consecutiveBurst: { side: 'buy', count: 4 },
    },
    market: {
      price: 100.2,
      vwap: 100,
      delta1s: 1.2,
      delta5s: 0.8,
      deltaZ: 1.5,
      cvdSlope: 0.4,
      obiWeighted: 0.3,
      obiDeep: 0.25,
      obiDivergence: 0.05,
    },
    openInterest: null,
    absorption: { value: 0, side: null },
    bootstrap: { backfillDone: true, barsLoaded1m: 1440 },
    htf: {
      m15: { close: 100.1, atr: 1, lastSwingHigh: 101, lastSwingLow: 99, structureBreakUp: false, structureBreakDn: false },
      h1: { close: 100.2, atr: 2, lastSwingHigh: 102, lastSwingLow: 98, structureBreakUp: false, structureBreakDn: false },
    },
    execution: { tradeReady: true, addonReady: true, vetoReason: null, orderbookTrusted: true, integrityLevel: 'OK' },
    volatility: 0.5,
    position: null,
    ...overrides,
  };
}

export async function runTests() {
  const strategy = new NewStrategyV11({ hardRevTicks: 5 });
  const records = [
    strategy.evaluate(makeInput(1_000_000)).log,
    strategy.evaluate(makeInput(1_001_000, {
      market: {
        price: 99.7,
        vwap: 100,
        delta1s: -1.5,
        delta5s: -1.1,
        deltaZ: -1.9,
        cvdSlope: -0.5,
        obiWeighted: -0.35,
        obiDeep: -0.3,
        obiDivergence: -0.08,
      },
      trades: {
        lastUpdatedMs: 1_001_000,
        printsPerSecond: 9,
        tradeCount: 24,
        aggressiveBuyVolume: 3,
        aggressiveSellVolume: 16,
        consecutiveBurst: { side: 'sell', count: 6 },
      },
    })).log,
  ];

  assert(records.every((record) => record.replayInput), 'decision logs should include replayInput snapshots');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decision-replay-'));
  const filePath = path.join(tmpDir, 'decision_log.jsonl');
  try {
    await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
    const summary = await replayDecisionLogFile(filePath, { symbol: 'BTCUSDT' });
    assert(summary.totalRecords === 2, 'replay should load expected number of records');
    assert(summary.replayedRecords === 2, 'replay should execute all records');
    assert(summary.mismatchedRecords === 0, 'replay should reproduce recorded decisions exactly');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
