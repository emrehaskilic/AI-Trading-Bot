import { beforeEach, describe, expect, test } from 'vitest';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1BtcContext, OrchestratorV1Input } from '../orchestrator_v1/types';

function baseInput(nowMs: number, overrides: Partial<OrchestratorV1Input> = {}): OrchestratorV1Input {
  return {
    symbol: 'BTCUSDT',
    nowMs,
    price: 65_000,
    bestBid: 64_999.5,
    bestAsk: 65_000.5,
    spreadPct: 0.0001,
    printsPerSecond: 10,
    deltaZ: 1.4,
    cvdSlope: 0.01,
    cvdTf5mState: 'BUY',
    obiDeep: 0.15,
    obiWeighted: 0.1,
    trendinessScore: 0.8,
    chopScore: 0.2,
    volOfVol: 0.1,
    realizedVol1m: 0.05,
    atr3m: 180,
    atrSource: 'BACKFILL_ATR',
    orderbookIntegrityLevel: 0,
    oiChangePct: 0.01,
    sessionVwapValue: 64_900,
    htfH1BarStartMs: nowMs - 3_600_000,
    htfH4BarStartMs: nowMs - 14_400_000,
    htfH1SwingLow: 64_000,
    htfH1SwingHigh: 66_000,
    htfH1StructureBreakUp: false,
    htfH1StructureBreakDn: false,
    m15SwingLow: 64_500,
    m15SwingHigh: 65_500,
    superScalpEnabled: false,
    backfillDone: true,
    barsLoaded1m: 500,
    crossMarketActive: true,
    ...overrides,
  };
}

function btcContextLong(): OrchestratorV1BtcContext {
  return {
    h1BarStartMs: 1_000,
    h4BarStartMs: 1_000,
    h1StructureUp: true,
    h1StructureDn: false,
    h4StructureUp: true,
    h4StructureDn: false,
    trendiness: 0.8,
    chop: 0.2,
  };
}

describe('OrchestratorV1 - SuperScalp mode', () => {
  let orc: OrchestratorV1;

  beforeEach(() => {
    orc = new OrchestratorV1();
  });

  test('SuperScalp OFF: sideCandidate follows legacy nextSide', () => {
    const now = Date.now();
    const dec = orc.evaluate(baseInput(now, { superScalpEnabled: false }));
    expect(dec.telemetry.reversal.sideCandidate).toBe('BUY');
    expect(dec.telemetry.superScalp.active).toBe(false);
    expect(dec.telemetry.superScalp.sideCandidate).toBeNull();
  });

  test('SuperScalp ON: sweep + reclaim creates BUY/SELL candidates', () => {
    const now = Date.now();

    // BUY candidate: sweep below low, then reclaim above low with positive flow.
    orc.evaluate(baseInput(now, { superScalpEnabled: true, price: 64_400, bestBid: 64_399.5, bestAsk: 64_400.5 }));
    const buyDec = orc.evaluate(baseInput(now + 1_000, {
      superScalpEnabled: true,
      price: 64_650,
      bestBid: 64_649.5,
      bestAsk: 64_650.5,
      sessionVwapValue: 64_620,
    }));
    expect(buyDec.telemetry.superScalp.sideCandidate).toBe('BUY');
    expect(buyDec.telemetry.superScalp.sweepDetected).toBe(true);
    expect(buyDec.telemetry.superScalp.reclaimDetected).toBe(true);

    // SELL candidate: sweep above high, then reclaim below high with negative flow.
    const orcSell = new OrchestratorV1();
    orcSell.evaluate(baseInput(now, {
      superScalpEnabled: true,
      deltaZ: -1.4,
      cvdSlope: -0.01,
      obiDeep: -0.15,
      cvdTf5mState: 'SELL',
      price: 65_600,
      bestBid: 65_599.5,
      bestAsk: 65_600.5,
      sessionVwapValue: 65_620,
    }));
    const sellDec = orcSell.evaluate(baseInput(now + 1_000, {
      superScalpEnabled: true,
      deltaZ: -1.4,
      cvdSlope: -0.01,
      obiDeep: -0.15,
      cvdTf5mState: 'SELL',
      price: 65_350,
      bestBid: 65_349.5,
      bestAsk: 65_350.5,
      sessionVwapValue: 65_380,
    }));
    expect(sellDec.telemetry.superScalp.sideCandidate).toBe('SELL');
    expect(sellDec.telemetry.superScalp.sweepDetected).toBe(true);
    expect(sellDec.telemetry.superScalp.reclaimDetected).toBe(true);
  });

  test('SuperScalp ON: no reclaim means no entry', () => {
    const now = Date.now();
    let last = orc.evaluate(baseInput(now, {
      superScalpEnabled: true,
      price: 64_400,
      bestBid: 64_399.5,
      bestAsk: 64_400.5,
    }));

    for (let i = 1; i <= 10; i += 1) {
      last = orc.evaluate(baseInput(now + (i * 1_000), {
        superScalpEnabled: true,
        price: 64_450,
        bestBid: 64_449.5,
        bestAsk: 64_450.5,
        sessionVwapValue: 64_430,
      }));
      expect(last.intent).toBe('HOLD');
      expect(last.telemetry.superScalp.reclaimDetected).toBe(false);
      expect(last.telemetry.superScalp.sideCandidate).toBeNull();
    }
  });

  test('SuperScalp ON: H1 hard veto still blocks entry', () => {
    const now = Date.now();
    orc.evaluate(baseInput(now, {
      superScalpEnabled: true,
      price: 64_400,
      bestBid: 64_399.5,
      bestAsk: 64_400.5,
      htfH1StructureBreakDn: true,
    }));

    let last = orc.evaluate(baseInput(now + 1_000, {
      superScalpEnabled: true,
      price: 64_650,
      bestBid: 64_649.5,
      bestAsk: 64_650.5,
      sessionVwapValue: 64_620,
      htfH1StructureBreakDn: true,
    }));

    for (let i = 2; i <= 9; i += 1) {
      last = orc.evaluate(baseInput(now + (i * 1_000), {
        superScalpEnabled: true,
        price: 64_650,
        bestBid: 64_649.5,
        bestAsk: 64_650.5,
        sessionVwapValue: 64_620,
        htfH1StructureBreakDn: true,
      }));
    }

    expect(last.intent).toBe('HOLD');
    expect(last.gateA.checks.htfLevelAligned).toBe(false);
    expect(last.telemetry.htf.vetoed).toBe(true);
    expect(last.telemetry.htf.reason).toBe('H1_STRUCTURE_BREAK_DN');
  });

  test('SuperScalp ON: crossMarket veto still blocks when active', () => {
    const now = Date.now();
    const context = btcContextLong();

    // Build SELL candidate under super scalp.
    orc.evaluate(baseInput(now, {
      symbol: 'ETHUSDT',
      superScalpEnabled: true,
      deltaZ: -1.4,
      cvdSlope: -0.01,
      obiDeep: -0.15,
      cvdTf5mState: 'SELL',
      price: 65_600,
      bestBid: 65_599.5,
      bestAsk: 65_600.5,
      sessionVwapValue: 65_620,
      btcContext: context,
      crossMarketActive: true,
    }));

    let last = orc.evaluate(baseInput(now + 1_000, {
      symbol: 'ETHUSDT',
      superScalpEnabled: true,
      deltaZ: -1.4,
      cvdSlope: -0.01,
      obiDeep: -0.15,
      cvdTf5mState: 'SELL',
      price: 65_350,
      bestBid: 65_349.5,
      bestAsk: 65_350.5,
      sessionVwapValue: 65_380,
      btcContext: context,
      crossMarketActive: true,
    }));

    for (let i = 2; i <= 10; i += 1) {
      last = orc.evaluate(baseInput(now + (i * 1_000), {
        symbol: 'ETHUSDT',
        superScalpEnabled: true,
        deltaZ: -1.4,
        cvdSlope: -0.01,
        obiDeep: -0.15,
        cvdTf5mState: 'SELL',
        price: 65_350,
        bestBid: 65_349.5,
        bestAsk: 65_350.5,
        sessionVwapValue: 65_380,
        btcContext: context,
        crossMarketActive: true,
      }));
    }

    expect(last.allGatesPassed).toBe(true);
    expect(last.intent).toBe('HOLD');
    expect(last.crossMarketBlockReason).not.toBeNull();
    expect(last.telemetry.crossMarket.active).toBe(true);
  });
});
