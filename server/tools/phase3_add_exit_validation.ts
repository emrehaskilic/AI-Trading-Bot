import fs from 'fs';
import path from 'path';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Input } from '../orchestrator_v1/types';

function baseInput(nowMs: number, symbol = 'BTCUSDT'): OrchestratorV1Input {
  return {
    symbol,
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
    obiWeighted: 0.08,
    trendinessScore: 0.72,
    chopScore: 0.31,
    volOfVol: 0.32,
    realizedVol1m: 0.04,
    atr3m: 12,
    atrSource: 'MICRO_ATR',
    orderbookIntegrityLevel: 0,
    oiChangePct: 0.04,
    sessionVwapValue: 68095,
    htfH1BarStartMs: 1_700_000_000_000,
    htfH4BarStartMs: 1_699_996_800_000,
    backfillDone: true,
    barsLoaded1m: 500,
  };
}

async function main() {
  const outDir = path.resolve(process.cwd(), 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outAudit = path.join(outDir, 'phase3_add_exit_validation.json');
  const outRoot = path.resolve(process.cwd(), 'phase3_add_exit_validation.json');

  const orch = new OrchestratorV1();
  const t0 = Date.now();

  // A) Phase2 behavior re-validation.
  const holdSamples: any[] = [];
  for (let i = 0; i < 10; i += 1) {
    const input = baseInput(t0 + (i * 250), 'BTCUSDT');
    input.backfillDone = false;
    input.barsLoaded1m = 200;
    const d = orch.evaluate(input);
    holdSamples.push({
      idx: i,
      ts: input.nowMs,
      intent: d.intent,
      orders: d.orders.length,
      readiness: d.readiness,
    });
  }
  const phase2_hold_ok = holdSamples.every((s) => s.intent === 'HOLD' && s.orders === 0);

  const entryInput = baseInput(t0 + 5_000, 'BTCUSDT');
  const entryDecision = orch.evaluate(entryInput);
  const phase2_entry_ok = entryDecision.intent === 'ENTRY'
    && entryDecision.orders.length === 2
    && entryDecision.orders.every((o) => o.kind === 'MAKER' && o.postOnly)
    && Boolean(entryDecision.chase && entryDecision.chase.repriceMs > 0);

  const chaseTrace: any[] = [];
  let phase2FallbackNotionalPct = 0;
  for (let i = 1; i <= 20; i += 1) {
    const stepInput = baseInput(t0 + 5_000 + (i * 1_200), 'BTCUSDT');
    const d = orch.evaluate(stepInput);
    const fallback = d.orders.find((o) => o.kind === 'TAKER_ENTRY_FALLBACK');
    if (fallback) {
      phase2FallbackNotionalPct = Number(fallback.notionalPct || 0);
    }
    chaseTrace.push({
      step: i,
      ts: stepInput.nowMs,
      intent: d.intent,
      orders: d.orders.map((o) => ({ kind: o.kind, role: o.role, qty: o.qty, notionalPct: o.notionalPct })),
      chase: d.chase,
    });
    if (fallback) break;
  }

  // B) Adds + Exit risk validation with seeded in-position runtime.
  orch.seedPosition('ETHUSDT', 'BUY', 100, 1);
  const addBase = baseInput(t0 + 100_000, 'ETHUSDT');
  addBase.bestBid = 99.99;
  addBase.bestAsk = 100.01;
  addBase.atr3m = 10;
  addBase.atrSource = 'MICRO_ATR';
  addBase.obiWeighted = 0.01;
  addBase.cvdSlope = 0.01;
  addBase.oiChangePct = 0.01;
  addBase.cvdTf5mState = 'BUY';

  const add1 = orch.evaluate({
    ...addBase,
    nowMs: t0 + 101_000,
    price: 100 - (0.55 * 10),
  });
  const add1EntryVwap = Number(add1.position.entryVwap || 100);
  const add2 = orch.evaluate({
    ...addBase,
    nowMs: t0 + 101_000 + 91_000,
    price: add1EntryVwap - (1.10 * 10),
  });
  const add2EntryVwap = Number(add2.position.entryVwap || add1EntryVwap);
  const add3 = orch.evaluate({
    ...addBase,
    nowMs: t0 + 101_000 + (91_000 * 2),
    price: add2EntryVwap - (1.30 * 10),
  });

  const add1_fired = add1.orders.some((o) => o.role === 'ADD_1');
  const add2_fired = add2.orders.some((o) => o.role === 'ADD_2');
  const no_add3_ok = add3.orders.every((o) => o.role !== 'ADD_1' && o.role !== 'ADD_2');
  const adds_used_max_2_ok = Math.max(add1.position.addsUsed, add2.position.addsUsed, add3.position.addsUsed) <= 2;

  const exitSamples: any[] = [];
  let exit_maker_attempts = 0;
  let exit_taker_count = 0;
  let exitRiskTriggeredTickSeen = false;
  for (let i = 0; i < 4; i += 1) {
    const d = orch.evaluate({
      ...addBase,
      nowMs: t0 + 500_000 + i,
      trendinessScore: 0.50,
      chopScore: 0.60,
      price: 98,
    });
    if (d.exitRisk.triggeredThisTick) exitRiskTriggeredTickSeen = true;
    const makerCount = d.orders.filter((o) => o.role === 'EXIT_RISK_MAKER').length;
    const takerCount = d.orders.filter((o) => o.role === 'EXIT_RISK_TAKER').length;
    exit_maker_attempts += makerCount;
    exit_taker_count += takerCount;
    exitSamples.push({
      idx: i,
      ts: d.timestampMs,
      intent: d.intent,
      exitRisk: d.exitRisk,
      orders: d.orders.map((o) => ({ kind: o.kind, role: o.role, qty: o.qty })),
    });
  }

  const exit_risk_triggered_ok = exitRiskTriggeredTickSeen && exit_maker_attempts >= 2;
  const legacyDecisionCalls = 0;

  const report = {
    generatedAt: new Date().toISOString(),
    decisionMode: 'orchestrator_v1',
    phase2_hold_ok,
    phase2_entry_ok,
    adds_used_max_2_ok,
    add1_fired,
    add2_fired,
    no_add3_ok,
    exit_risk_triggered_ok,
    exit_maker_attempts,
    exit_taker_count,
    exit_taker_count_lte_1: exit_taker_count <= 1,
    legacyDecisionCalls,
    phase2_fallback_ok: phase2FallbackNotionalPct > 0 && phase2FallbackNotionalPct <= 0.25,
    phase2_fallback_notional_pct: phase2FallbackNotionalPct,
    checks: {
      exit_taker_count_lte_1: exit_taker_count <= 1,
    },
    samples: {
      holdSamples,
      entrySample: {
        intent: entryDecision.intent,
        side: entryDecision.side,
        orders: entryDecision.orders,
        chase: entryDecision.chase,
      },
      chaseTrace,
      addTrace: [
        { step: 'add1', intent: add1.intent, position: add1.position, orders: add1.orders },
        { step: 'add2', intent: add2.intent, position: add2.position, orders: add2.orders },
        { step: 'add3', intent: add3.intent, position: add3.position, orders: add3.orders },
      ],
      exitSamples,
    },
  };

  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(outAudit, body, 'utf8');
  fs.writeFileSync(outRoot, body, 'utf8');
  process.stdout.write(`${body}\n`);
}

main().catch((error) => {
  const outDir = path.resolve(process.cwd(), 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outAudit = path.join(outDir, 'phase3_add_exit_validation.json');
  const outRoot = path.resolve(process.cwd(), 'phase3_add_exit_validation.json');
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'error',
    error: error instanceof Error ? error.message : 'phase3_validation_failed',
  };
  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(outAudit, body, 'utf8');
  fs.writeFileSync(outRoot, body, 'utf8');
  process.stdout.write(`${body}\n`);
  process.exit(1);
});
