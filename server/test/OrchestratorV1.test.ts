import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Input } from '../orchestrator_v1/types';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function baseInput(nowMs: number): OrchestratorV1Input {
  return {
    symbol: 'BTCUSDT',
    nowMs,
    price: 68100,
    bestBid: 68099.9,
    bestAsk: 68100.1,
    spreadPct: 0.0002,
    printsPerSecond: 8,
    deltaZ: 1.1,
    cvdSlope: 0.01,
    cvdTf5mState: 'BUY',
    obiDeep: 0.12,
    obiWeighted: 0.09,
    trendinessScore: 0.7,
    chopScore: 0.3,
    volOfVol: 0.4,
    realizedVol1m: 0.04,
    atr3m: 12,
    atrSource: 'MICRO_ATR',
    orderbookIntegrityLevel: 0,
    oiChangePct: 0.02,
    sessionVwapValue: 68090,
    htfH1BarStartMs: Date.UTC(2026, 1, 26, 12, 0, 0, 0),
    htfH4BarStartMs: Date.UTC(2026, 1, 26, 12, 0, 0, 0),
    backfillDone: true,
    barsLoaded1m: 500,
  };
}

export function runTests() {
  const orch = new OrchestratorV1();
  const now = Date.now();

  const notReady = orch.evaluate({
    ...baseInput(now),
    backfillDone: false,
    barsLoaded1m: 120,
  });
  assert(notReady.intent === 'HOLD', 'must HOLD when readiness fails');
  assert(notReady.orders.length === 0, 'no orders when readiness fails');

  let entry = orch.evaluate(baseInput(now + 1000));
  for (let step = 1; step <= 8 && entry.intent !== 'ENTRY'; step += 1) {
    entry = orch.evaluate(baseInput(now + 1000 + (step * 1200)));
  }
  assert(entry.intent === 'ENTRY', 'must produce ENTRY when readiness and hysteresis confirmations pass');
  assert(entry.orders.length === 2, 'must generate 2 maker orders for entry');
  assert(entry.orders.every((order) => order.kind === 'MAKER'), 'entry orders must be maker');
  assert(entry.orders.every((order) => order.postOnly), 'entry maker orders must be postOnly');
  assert(typeof entry.telemetry?.sideFlipCount5m === 'number', 'telemetry.sideFlipCount5m must exist');
  assert(typeof entry.telemetry?.smoothed?.deltaZ === 'number', 'telemetry.smoothed.deltaZ must exist');

  let sawFallback = false;
  for (let step = 1; step <= 24; step += 1) {
    const next = orch.evaluate(baseInput(now + 15_000 + (step * 1200)));
    const fallback = next.orders.find((order) => order.kind === 'TAKER_ENTRY_FALLBACK');
    if (fallback) {
      sawFallback = true;
      assert(Number(fallback.notionalPct) <= 0.25, 'fallback notional pct must be <= 0.25');
      break;
    }
  }
  assert(sawFallback, 'must emit taker fallback after maker chase window/reprices');

  // Phase3: Add (max2) + Exit risk.
  orch.seedPosition('ETHUSDT', 'BUY', 100, 1);
  const addBase = baseInput(now + 60_000);
  addBase.symbol = 'ETHUSDT';
  addBase.bestBid = 99.99;
  addBase.bestAsk = 100.01;
  addBase.atr3m = 10;
  addBase.obiWeighted = 0.01;
  addBase.cvdSlope = 0.01;
  addBase.oiChangePct = 0.01;
  addBase.cvdTf5mState = 'BUY';

  const add1 = orch.evaluate({
    ...addBase,
    nowMs: now + 61_000,
    price: 100 - (0.55 * 10),
  });
  assert(add1.intent === 'ADD', 'ADD1 must trigger');
  assert(add1.orders.some((order) => order.role === 'ADD_1'), 'ADD1 order role missing');
  const add1EntryVwap = Number(add1.position.entryVwap || 100);

  const add2 = orch.evaluate({
    ...addBase,
    nowMs: now + 61_000 + 91_000,
    price: add1EntryVwap - (1.10 * 10),
  });
  assert(add2.intent === 'ADD', 'ADD2 must trigger');
  assert(add2.orders.some((order) => order.role === 'ADD_2'), 'ADD2 order role missing');
  const add2EntryVwap = Number(add2.position.entryVwap || add1EntryVwap);

  const noAdd3 = orch.evaluate({
    ...addBase,
    nowMs: now + 61_000 + (91_000 * 2),
    price: add2EntryVwap - (1.30 * 10),
  });
  assert(noAdd3.orders.every((order) => order.role !== 'ADD_1' && order.role !== 'ADD_2'), 'ADD3 must not trigger');
  assert(noAdd3.position.addsUsed <= 2, 'addsUsed must stay <= 2');

  const exit1 = orch.evaluate({
    ...addBase,
    nowMs: now + 400_000,
    trendinessScore: 0.50,
    chopScore: 0.60,
  });
  const exit2 = orch.evaluate({
    ...addBase,
    nowMs: now + 401_000,
    trendinessScore: 0.50,
    chopScore: 0.60,
  });
  const exit3 = orch.evaluate({
    ...addBase,
    nowMs: now + 402_000,
    trendinessScore: 0.50,
    chopScore: 0.60,
  });
  assert(exit1.orders.some((order) => order.role === 'EXIT_RISK_MAKER'), 'exit maker attempt #1 missing');
  assert(exit2.orders.some((order) => order.role === 'EXIT_RISK_MAKER'), 'exit maker attempt #2 missing');
  assert(exit3.orders.some((order) => order.role === 'EXIT_RISK_TAKER'), 'exit taker missing');
}
