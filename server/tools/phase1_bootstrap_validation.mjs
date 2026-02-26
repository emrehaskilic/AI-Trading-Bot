import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';

const BASE_URL = process.env.VALIDATION_BASE_URL || 'http://127.0.0.1:8787';
const SYMBOL = String(process.env.VALIDATION_SYMBOL || 'BTCUSDT').toUpperCase();
const SAMPLE_TARGET = 10;
const WS_TIMEOUT_MS = 45_000;
const AUDIT_DIR = path.resolve(process.cwd(), 'logs', 'audit');
const OUT_FILE = path.join(AUDIT_DIR, 'phase1_bootstrap_validation.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function collectSamplesFromWs(symbol, limit, timeoutMs) {
  const wsUrl = BASE_URL.replace(/^http/i, 'ws') + `/ws?symbols=${encodeURIComponent(symbol)}`;
  const samples = [];
  let ws = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws?.close();
      } catch {}
      reject(new Error(`ws_timeout_${timeoutMs}`));
    }, timeoutMs);

    ws = new WebSocket(wsUrl);

    ws.on('open', () => {});
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw || ''));
        if (!msg || msg.type !== 'metrics' || String(msg.symbol || '').toUpperCase() !== symbol) return;
        samples.push({
          ts: Number(msg.event_time_ms || msg.snapshot?.ts || Date.now()),
          symbol: msg.symbol,
          price: Number(msg.legacyMetrics?.price || 0),
          deltaZ: Number(msg.legacyMetrics?.deltaZ || 0),
          cvdSlope: Number(msg.legacyMetrics?.cvdSlope || 0),
          aiTrendSide: msg.aiTrend?.side ?? null,
          aiBiasSide: msg.aiBias?.side ?? null,
          signal: msg.signalDisplay?.signal ?? null,
          actions: Array.isArray(msg.signalDisplay?.actions) ? msg.signalDisplay.actions.length : 0,
          bootstrap: msg.bootstrap
            ? {
                backfillInProgress: Boolean(msg.bootstrap.backfillInProgress),
                backfillDone: Boolean(msg.bootstrap.backfillDone),
                barsLoaded1m: Number(msg.bootstrap.barsLoaded1m || 0),
                startedAtMs: msg.bootstrap.startedAtMs ?? null,
                doneAtMs: msg.bootstrap.doneAtMs ?? null,
              }
            : null,
        });
        if (samples.length >= limit) {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {}
          resolve(null);
        }
      } catch {}
    });
    ws.on('close', () => {
      if (samples.length >= limit) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  });

  return samples;
}

async function main() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    symbol: SYMBOL,
    sampleTarget: SAMPLE_TARGET,
    startEndpoint: `${BASE_URL}/api/ai-dry-run/start`,
    status: 'ok',
    checks: {},
    samples: [],
    errors: [],
  };

  const healthBefore = await httpJson(`${BASE_URL}/api/health`, { method: 'GET' });
  report.healthBefore = healthBefore.json;

  const startResp = await httpJson(`${BASE_URL}/api/ai-dry-run/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      symbols: [SYMBOL],
      bootstrapTrendEnabled: true,
      decisionIntervalMs: 250,
    }),
  });
  report.startResponse = { ok: startResp.ok, status: startResp.status, json: startResp.json };

  if (!startResp.ok) {
    report.status = 'error';
    report.errors.push(`start_failed_status_${startResp.status}`);
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  // Allow first payloads to flow.
  await sleep(2_000);

  try {
    const samples = await collectSamplesFromWs(SYMBOL, SAMPLE_TARGET, WS_TIMEOUT_MS);
    report.samples = samples;
  } catch (error) {
    report.status = 'error';
    report.errors.push(error?.message || 'ws_collect_failed');
  }

  const healthAfter = await httpJson(`${BASE_URL}/api/health`, { method: 'GET' });
  report.healthAfter = healthAfter.json;

  const stopResp = await httpJson(`${BASE_URL}/api/ai-dry-run/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  report.stopResponse = { ok: stopResp.ok, status: stopResp.status };

  const bootstrapHealth = report.healthAfter?.bootstrapRuntime?.symbols?.[SYMBOL] || null;
  const limit1m = Number(report.healthAfter?.bootstrapRuntime?.limit1m || 0);
  const ordersAttempted = Number(report.healthAfter?.decisionRuntime?.ordersAttempted || 0);
  const decisionMode = String(report.healthAfter?.decisionMode || '');
  const barsLoadedFromSamples = report.samples
    .map((s) => Number(s.bootstrap?.barsLoaded1m || 0))
    .reduce((max, v) => (v > max ? v : max), 0);

  const sampleDecisionNone = report.samples.every((s) => {
    return s.aiTrendSide === 'NONE'
      && s.aiBiasSide === 'NONE'
      && s.signal === 'NONE'
      && s.actions === 0;
  });

  report.checks = {
    decisionMode,
    ordersAttempted,
    samplesCollected: report.samples.length,
    backfillFetchCount: Number(bootstrapHealth?.fetchCount || 0),
    backfillTriggeredOnce: Number(bootstrapHealth?.fetchCount || 0) === 1,
    barsLoaded1mHealth: Number(bootstrapHealth?.barsLoaded1m || 0),
    barsLoaded1mSamples: barsLoadedFromSamples,
    barsLoadedWithinLimit: Number(bootstrapHealth?.barsLoaded1m || 0) > 0
      && Number(bootstrapHealth?.barsLoaded1m || 0) <= Math.max(1, limit1m),
    decisionFieldsAllNone: sampleDecisionNone,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  const fallback = {
    generatedAt: new Date().toISOString(),
    status: 'error',
    error: error?.message || 'unexpected_failure',
  };
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(fallback, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
  process.exit(1);
});
