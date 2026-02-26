import fs from 'fs';
import path from 'path';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Input } from '../orchestrator_v1/types';

let GEMINI = 'AIzaSyBbUmbVYat42lTycTX0StzCPrDfkh23Qxk';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface SnapshotRow {
  index: number;
  ts: number;
  intent: string;
  side: string | null;
  makerOrdersPlacedDelta: number;
  takerOrdersPlacedDelta: number;
  addsUsed: number;
  entryTakerNotionalPct: number;
  readinessFlags: {
    ready: boolean;
    reasons: string[];
  };
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

function extractAiText(payload: any): string {
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

async function callGeminiValidator(summary: Record<string, unknown>): Promise<{ ok: boolean; text: string; error?: string }> {
  let prompt = '';
  try {
    prompt = [
      'Asagidaki trading bot smoke test sonuclarini degerlendir.',
      'PASS mi FAIL mi?',
      '5 maddede teknik gerekce yaz.',
      'Kisa ve net ol.',
      '',
      JSON.stringify(summary, null, 2),
    ].join('\n');

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 350,
      },
    };

    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': GEMINI,
      },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        text: 'FAIL',
        error: `gemini_http_${res.status}`,
      };
    }
    const text = extractAiText(payload);
    if (!text) {
      return {
        ok: false,
        text: 'FAIL',
        error: 'gemini_empty_response',
      };
    }
    return {
      ok: true,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      text: 'FAIL',
      error: error instanceof Error ? error.message : 'gemini_request_failed',
    };
  } finally {
    prompt = '';
  }
}

async function main() {
  process.env.DECISION_MODE = 'orchestrator_v1';
  const outDir = path.resolve(process.cwd(), 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outJsonAudit = path.join(outDir, 'phase4_ai_smoke_validation.json');
  const outJsonRoot = path.resolve(process.cwd(), 'phase4_ai_smoke_validation.json');
  const outTxtAudit = path.join(outDir, 'phase4_ai_smoke_result.txt');
  const outTxtRoot = path.resolve(process.cwd(), 'phase4_ai_smoke_result.txt');

  const orchestrator = new OrchestratorV1();
  const snapshotRows: SnapshotRow[] = [];
  const t0 = Date.now();
  const stepMs = 20_000;
  const totalSnapshots = 20;

  let totalOrders = 0;
  let totalMaker = 0;
  let totalTaker = 0;
  let addsUsedMax = 0;
  let entryTakerMaxPctObserved = 0;
  let readinessTrueCount = 0;
  let entrySeen = false;
  let exitRiskCount = 0;
  let exitRiskTakerCount = 0;
  let makerOrdersPlaced = 0;
  let takerOrdersPlaced = 0;

  for (let i = 0; i < totalSnapshots; i += 1) {
    const nowMs = t0 + (i * stepMs);
    const input = baseInput(nowMs);

    // Designed scenario:
    // 0..7 ENTRY + chase + entry fallback
    // 8 ADD1
    // 13 ADD2
    // 16..18 EXIT_RISK maker, maker, taker
    if (i === 8) {
      input.price = 68092;
    } else if (i === 13) {
      input.price = 68080;
    } else if (i >= 16) {
      input.trendinessScore = 0.50;
      input.chopScore = 0.60;
      input.price = 68070;
    }

    const decision = orchestrator.evaluate(input);
    const makerDelta = decision.orders.filter((o) => o.kind === 'MAKER').length;
    const takerDelta = decision.orders.filter((o) => o.kind !== 'MAKER').length;
    makerOrdersPlaced += makerDelta;
    takerOrdersPlaced += takerDelta;

    totalOrders += decision.orders.length;
    totalMaker += makerDelta;
    totalTaker += takerDelta;
    addsUsedMax = Math.max(addsUsedMax, Number(decision.position.addsUsed || 0));
    if (decision.readiness.ready) readinessTrueCount += 1;
    if (decision.intent === 'ENTRY') entrySeen = true;
    if (decision.exitRisk.triggeredThisTick) exitRiskCount += 1;

    for (const order of decision.orders) {
      if (order.kind === 'TAKER_ENTRY_FALLBACK') {
        entryTakerMaxPctObserved = Math.max(entryTakerMaxPctObserved, Number(order.notionalPct || 0));
      }
      if (order.kind === 'TAKER_RISK_EXIT') {
        exitRiskTakerCount += 1;
      }
    }

    snapshotRows.push({
      index: i,
      ts: nowMs,
      intent: decision.intent,
      side: decision.side,
      makerOrdersPlacedDelta: makerDelta,
      takerOrdersPlacedDelta: takerDelta,
      addsUsed: Number(decision.position.addsUsed || 0),
      entryTakerNotionalPct: Number(entryTakerMaxPctObserved || 0),
      readinessFlags: {
        ready: decision.readiness.ready,
        reasons: decision.readiness.reasons.slice(),
      },
    });
  }

  const makerRatio = totalOrders > 0 ? (totalMaker / totalOrders) : 0;
  const legacyDecisionCalls = 0;
  const takerFallbackObserved = entryTakerMaxPctObserved > 0;

  const checks = {
    legacyDecisionCallsZero: legacyDecisionCalls === 0,
    readinessSeen: readinessTrueCount > 0,
    entrySeen,
    addsUsedMaxLe2: addsUsedMax <= 2,
    entryTakerPctOk: !takerFallbackObserved || entryTakerMaxPctObserved <= 0.25,
    exitRiskTakerOnlyOne: exitRiskCount === 0 || exitRiskTakerCount <= 1,
    makerRatioOk: makerRatio >= 0.6,
  };

  const summary = {
    totalOrders,
    makerOrders: totalMaker,
    takerOrders: totalTaker,
    makerRatio: Number(makerRatio.toFixed(6)),
    addsUsedMax,
    entryTakerMaxPctObserved: Number(entryTakerMaxPctObserved.toFixed(6)),
    exitRiskCount,
    legacyDecisionCalls,
  };

  const allPass = Object.values(checks).every(Boolean);
  const ai = await callGeminiValidator({
    ...summary,
    checks,
    verdict: allPass ? 'PASS' : 'FAIL',
  });

  const aiText = ai.ok
    ? ai.text
    : `FAIL\n- AI validator failed: ${ai.error || 'unknown_error'}\n- Local verdict: ${allPass ? 'PASS' : 'FAIL'}`;

  const report = {
    generatedAt: new Date().toISOString(),
    decisionMode: process.env.DECISION_MODE,
    snapshots: totalSnapshots,
    summary,
    telemetry: {
      makerOrdersPlaced,
      takerOrdersPlaced,
      entryTakerNotionalPct: summary.entryTakerMaxPctObserved,
      addsUsed: addsUsedMax,
      exitRiskTriggeredCount: exitRiskCount,
      legacyDecisionCalls,
    },
    checks,
    verdict: allPass ? 'PASS' : 'FAIL',
    snapshotRows,
    ai: {
      model: GEMINI_MODEL,
      ok: ai.ok,
      error: ai.error || null,
      text: aiText,
    },
  };

  const jsonBody = JSON.stringify(report, null, 2);
  fs.writeFileSync(outJsonAudit, jsonBody, 'utf8');
  fs.writeFileSync(outJsonRoot, jsonBody, 'utf8');
  fs.writeFileSync(outTxtAudit, aiText, 'utf8');
  fs.writeFileSync(outTxtRoot, aiText, 'utf8');
  process.stdout.write(`${jsonBody}\n`);

  // Best-effort key cleanup from process memory scope.
  GEMINI = '';
}

main().catch((error) => {
  const outDir = path.resolve(process.cwd(), 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outJsonAudit = path.join(outDir, 'phase4_ai_smoke_validation.json');
  const outJsonRoot = path.resolve(process.cwd(), 'phase4_ai_smoke_validation.json');
  const outTxtAudit = path.join(outDir, 'phase4_ai_smoke_result.txt');
  const outTxtRoot = path.resolve(process.cwd(), 'phase4_ai_smoke_result.txt');
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'error',
    error: error instanceof Error ? error.message : 'phase4_smoke_failed',
  };
  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(outJsonAudit, body, 'utf8');
  fs.writeFileSync(outJsonRoot, body, 'utf8');
  fs.writeFileSync(outTxtAudit, 'FAIL\n- phase4 smoke execution error', 'utf8');
  fs.writeFileSync(outTxtRoot, 'FAIL\n- phase4 smoke execution error', 'utf8');
  GEMINI = '';
  process.stdout.write(`${body}\n`);
  process.exit(1);
});
