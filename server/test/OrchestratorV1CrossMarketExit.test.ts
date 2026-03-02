import { beforeEach, describe, expect, test } from 'vitest';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1BtcContext, OrchestratorV1Input } from '../orchestrator_v1/types';

function btcShortContext(): OrchestratorV1BtcContext {
  return {
    h1BarStartMs: 1_000,
    h4BarStartMs: 1_000,
    h1StructureUp: false,
    h1StructureDn: true,
    h4StructureUp: false,
    h4StructureDn: true,
    trendiness: 0.8,
    chop: 0.2,
  };
}

function btcLongContext(): OrchestratorV1BtcContext {
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

function input(nowMs: number, overrides: Partial<OrchestratorV1Input> = {}): OrchestratorV1Input {
  return {
    symbol: 'ETHUSDT',
    nowMs,
    price: 2_000,
    bestBid: 1_999.9,
    bestAsk: 2_000.1,
    spreadPct: 0.0001,
    printsPerSecond: 10,
    deltaZ: 0.8,
    cvdSlope: 0.01,
    cvdTf5mState: 'BUY',
    obiDeep: 0.1,
    obiWeighted: 0.1,
    trendinessScore: 0.8,
    chopScore: 0.2,
    volOfVol: 0.1,
    realizedVol1m: 0.05,
    atr3m: 10,
    atrSource: 'MICRO_ATR',
    orderbookIntegrityLevel: 0,
    oiChangePct: 0.01,
    sessionVwapValue: 2_000,
    htfH1BarStartMs: nowMs - 3_600_000,
    htfH1SwingLow: 1_980,
    htfH1SwingHigh: 2_020,
    htfH1StructureBreakUp: false,
    htfH1StructureBreakDn: false,
    htfH4BarStartMs: nowMs - 14_400_000,
    m15SwingLow: 1_995,
    m15SwingHigh: 2_005,
    superScalpEnabled: false,
    backfillDone: true,
    barsLoaded1m: 500,
    btcContext: btcShortContext(),
    crossMarketActive: true,
    dryRunPosition: {
      hasPosition: true,
      side: 'LONG',
      qty: 2,
      entryPrice: 2_000,
      notional: 4_000,
      addsUsed: 0,
    },
    btcDryRunPosition: {
      hasPosition: true,
      side: 'SHORT',
      qty: 0.2,
      entryPrice: 65_000,
      notional: 13_000,
      addsUsed: 0,
    },
    ...overrides,
  };
}

describe('OrchestratorV1 - CrossMarket mismatch force-exit', () => {
  let orc: OrchestratorV1;

  beforeEach(() => {
    orc = new OrchestratorV1();
  });

  test('ETH LONG vs BTC anchor SELL: exits only after persistMs', () => {
    const t0 = 1_000_000;
    const d1 = orc.evaluate(input(t0));
    expect(d1.intent).toBe('HOLD');
    expect(d1.telemetry.crossMarket.mismatchActive).toBe(true);
    expect(d1.telemetry.crossMarket.mismatchSinceMs).toBe(t0);

    const d2 = orc.evaluate(input(t0 + 29_000));
    expect(d2.intent).toBe('HOLD');
    expect(d2.telemetry.crossMarket.mismatchActive).toBe(true);
    expect(d2.telemetry.crossMarket.exitTriggeredCount).toBe(0);

    const d3 = orc.evaluate(input(t0 + 31_000));
    expect(d3.intent).toBe('EXIT_RISK');
    expect(d3.exitRisk.reason).toBe('CROSSMARKET_MISMATCH');
    expect(d3.telemetry.lastExitReasonCode).toBe('EXIT_CROSSMARKET_MISMATCH');
    expect(d3.telemetry.crossMarket.exitTriggeredCount).toBe(1);
    expect(d3.orders.length).toBeGreaterThan(0);
    expect(d3.orders[0].role).toBe('EXIT_RISK_MAKER');
  });

  test('mismatch resolves before persistMs: no forced exit', () => {
    const t0 = 2_000_000;
    const d1 = orc.evaluate(input(t0));
    expect(d1.telemetry.crossMarket.mismatchActive).toBe(true);
    expect(d1.telemetry.crossMarket.mismatchSinceMs).toBe(t0);

    const resolved = orc.evaluate(input(t0 + 15_000, { btcContext: btcLongContext() }));
    expect(resolved.intent).toBe('HOLD');
    expect(resolved.telemetry.crossMarket.mismatchActive).toBe(false);
    expect(resolved.telemetry.crossMarket.mismatchSinceMs).toBeNull();

    const d2 = orc.evaluate(input(t0 + 20_000));
    expect(d2.telemetry.crossMarket.mismatchActive).toBe(true);
    expect(d2.telemetry.crossMarket.mismatchSinceMs).toBe(t0 + 20_000);

    const d3 = orc.evaluate(input(t0 + 45_000));
    expect(d3.intent).toBe('HOLD');
    expect(d3.telemetry.crossMarket.exitTriggeredCount).toBe(0);
  });

  test('BTC not active: mismatch force-exit disabled', () => {
    const t0 = 3_000_000;
    const d1 = orc.evaluate(input(t0, { crossMarketActive: false }));
    expect(d1.intent).toBe('HOLD');
    expect(d1.telemetry.crossMarket.active).toBe(false);
    expect(d1.telemetry.crossMarket.mismatchActive).toBe(false);
    expect(d1.telemetry.crossMarket.mismatchSinceMs).toBeNull();

    const d2 = orc.evaluate(input(t0 + 60_000, { crossMarketActive: false }));
    expect(d2.intent).toBe('HOLD');
    expect(d2.exitRisk.reason).toBeNull();
    expect(d2.telemetry.crossMarket.exitTriggeredCount).toBe(0);
  });
});
