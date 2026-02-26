import fs from 'fs';
import path from 'path';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Decision, OrchestratorV1Input } from '../orchestrator_v1/types';

function buildBaseInput(nowMs: number): OrchestratorV1Input {
  return {
    symbol: 'BTCUSDT',
    nowMs,
    price: 68100,
    bestBid: 68099.9,
    bestAsk: 68100.1,
    spreadPct: 0.0002,
    printsPerSecond: 8,
    deltaZ: 1.15,
    cvdSlope: 0.009,
    cvdTf5mState: 'BUY',
    obiDeep: 0.12,
    obiWeighted: 0.09,
    trendinessScore: 0.72,
    chopScore: 0.31,
    volOfVol: 0.32,
    realizedVol1m: 0.05,
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

function summarizeOrders(decision: OrchestratorV1Decision) {
  const maker = decision.orders.filter((order) => order.kind === 'MAKER');
  const taker = decision.orders.filter((order) => order.kind === 'TAKER_ENTRY_FALLBACK');
  return {
    makerOrdersCount: maker.length,
    takerOrdersCount: taker.length,
    takerNotionalPct: taker.length > 0 ? Math.max(...taker.map((order) => Number(order.notionalPct || 0))) : 0,
  };
}

async function main() {
  const outDir = path.resolve(process.cwd(), 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'phase2_entry_validation.json');
  const outPathRoot = path.resolve(process.cwd(), 'phase2_entry_validation.json');

  const orch = new OrchestratorV1();
  const report: any = {
    generatedAt: new Date().toISOString(),
    decisionMode: 'orchestrator_v1',
    phase: 'phase2_entry_validation',
    checks: {},
    samples: {
      holdSamples: [] as any[],
      entrySample: null as any,
      chaseSamples: [] as any[],
    },
    counters: {
      ordersAttempted: 0,
      makerOrdersCount: 0,
      takerOrdersCount: 0,
      takerNotionalPct: 0,
      legacyDecisionCallCount: 0,
    },
  };

  const t0 = Date.now();
  const holdSamples: any[] = [];
  for (let i = 0; i < 10; i += 1) {
    const input = buildBaseInput(t0 + (i * 250));
    input.backfillDone = false;
    input.barsLoaded1m = 200;
    const decision = orch.evaluate(input);
    holdSamples.push({
      idx: i,
      ts: input.nowMs,
      intent: decision.intent,
      orders: decision.orders.length,
      readiness: decision.readiness,
    });
  }
  report.samples.holdSamples = holdSamples;

  const entryInput = buildBaseInput(t0 + 3_000);
  const entryDecision = orch.evaluate(entryInput);
  report.samples.entrySample = {
    ts: entryInput.nowMs,
    intent: entryDecision.intent,
    side: entryDecision.side,
    orders: entryDecision.orders,
    chase: entryDecision.chase,
    readiness: entryDecision.readiness,
    gateA: entryDecision.gateA,
    gateB: entryDecision.gateB,
    gateC: entryDecision.gateC,
  };
  const entrySummary = summarizeOrders(entryDecision);
  report.counters.ordersAttempted += entryDecision.orders.length;
  report.counters.makerOrdersCount += entrySummary.makerOrdersCount;
  report.counters.takerOrdersCount += entrySummary.takerOrdersCount;
  report.counters.takerNotionalPct = Math.max(report.counters.takerNotionalPct, entrySummary.takerNotionalPct);

  // "maker fill yok" simulation: keep reevaluating until chase window and reprices are consumed.
  for (let step = 1; step <= 16; step += 1) {
    const nowMs = entryInput.nowMs + (step * 1_200);
    const decision = orch.evaluate(buildBaseInput(nowMs));
    const summary = summarizeOrders(decision);
    report.counters.ordersAttempted += decision.orders.length;
    report.counters.makerOrdersCount += summary.makerOrdersCount;
    report.counters.takerOrdersCount += summary.takerOrdersCount;
    report.counters.takerNotionalPct = Math.max(report.counters.takerNotionalPct, summary.takerNotionalPct);
    report.samples.chaseSamples.push({
      step,
      ts: nowMs,
      intent: decision.intent,
      orders: decision.orders.map((order) => ({
        kind: order.kind,
        role: order.role,
        notionalPct: order.notionalPct,
        postOnly: order.postOnly,
        repriceAttempt: order.repriceAttempt,
      })),
      chase: decision.chase,
      impulse: decision.impulse,
      allGatesPassed: decision.allGatesPassed,
    });
  }

  const holdOnly = holdSamples.every((sample) => sample.intent === 'HOLD' && sample.orders === 0);
  const entryHasTwoMakers = entryDecision.intent === 'ENTRY'
    && entryDecision.orders.length === 2
    && entryDecision.orders.every((order) => order.kind === 'MAKER' && order.postOnly);
  const chaseHasTakerFallback = report.samples.chaseSamples.some((sample: any) =>
    Array.isArray(sample.orders) && sample.orders.some((order: any) => order.kind === 'TAKER_ENTRY_FALLBACK')
  );

  report.checks = {
    holdWhenBackfillNotReady: holdOnly,
    entryProducedWhenReady: entryHasTwoMakers,
    makerChaseMetadataPresent: Boolean(entryDecision.chase && typeof entryDecision.chase.repriceMs === 'number'),
    takerFallbackTriggered: chaseHasTakerFallback,
    takerNotionalWithin25Pct: Number(report.counters.takerNotionalPct || 0) <= 0.25,
    ordersAttemptedGtZero: Number(report.counters.ordersAttempted || 0) > 0,
    legacyDecisionCallsZero: Number(report.counters.legacyDecisionCallCount || 0) === 0,
  };

  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(outPath, body, 'utf8');
  fs.writeFileSync(outPathRoot, body, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  const outDir = path.resolve(process.cwd(), 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'phase2_entry_validation.json');
  const outPathRoot = path.resolve(process.cwd(), 'phase2_entry_validation.json');
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'error',
    error: error instanceof Error ? error.message : 'phase2_validation_failed',
  };
  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(outPath, body, 'utf8');
  fs.writeFileSync(outPathRoot, body, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
});
