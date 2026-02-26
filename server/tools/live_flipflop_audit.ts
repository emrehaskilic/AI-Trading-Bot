import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

type Json = Record<string, any>;

const BASE_URL = String(process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const SAMPLE_INTERVAL_MS = Math.max(1_000, Number(process.env.AUDIT_INTERVAL_MS || 5_000));
const DURATION_MS = Math.max(SAMPLE_INTERVAL_MS, Number(process.env.AUDIT_DURATION_MS || 300_000));
const OUTPUT_FILE = String(
  process.env.AUDIT_OUTPUT_FILE || path.join('server', 'logs', 'audit', 'post_fix_stability_report.json')
);

interface RuntimeCounters {
  legacyDecisionCalls: number;
  ordersAttempted: number;
  makerOrdersPlaced: number;
  takerOrdersPlaced: number;
}

interface Sample {
  index: number;
  ts: number;
  symbol: string | null;
  decisionMode: string | null;
  intent: string | null;
  side: string | null;
  allGatesPassed: boolean;
  telemetrySideFlipCount5m: number;
  telemetrySideFlipPerMin: number;
  telemetryAllGatesTrueCount5m: number;
  telemetryEntryIntentCount5m: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toWsBase(httpBase: string): string {
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}`;
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}`;
  return `ws://${httpBase}`;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

async function getJson(url: string): Promise<Json | null> {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const parsed = await res.json().catch(() => null);
    return parsed && typeof parsed === 'object' ? parsed as Json : null;
  } catch {
    return null;
  }
}

function getRuntimeCounters(health: Json | null): RuntimeCounters {
  const runtime = health?.decisionRuntime || {};
  return {
    legacyDecisionCalls: asNumber(runtime.legacyDecisionCalls, 0),
    ordersAttempted: asNumber(runtime.ordersAttempted, 0),
    makerOrdersPlaced: asNumber(runtime.makerOrdersPlaced, 0),
    takerOrdersPlaced: asNumber(runtime.takerOrdersPlaced, 0),
  };
}

function pickLatestPayload(latestBySymbol: Map<string, Json>, preferredSymbols: string[]): Json | null {
  for (const symbol of preferredSymbols) {
    const match = latestBySymbol.get(symbol);
    if (match) return match;
  }
  let latest: Json | null = null;
  let latestTs = -1;
  for (const item of latestBySymbol.values()) {
    const ts = asNumber(item?.event_time_ms || item?.snapshot?.ts || 0, 0);
    if (ts > latestTs) {
      latestTs = ts;
      latest = item;
    }
  }
  return latest;
}

async function openMetricsWs(symbols: string[]): Promise<{
  ws: WebSocket | null;
  wsOpened: boolean;
  latestBySymbol: Map<string, Json>;
  messageCount: { count: number };
}> {
  const latestBySymbol = new Map<string, Json>();
  const messageCount = { count: 0 };
  if (symbols.length === 0) {
    return { ws: null, wsOpened: false, latestBySymbol, messageCount };
  }

  const wsBase = toWsBase(BASE_URL);
  const params = new URLSearchParams();
  params.set('symbols', symbols.join(','));
  const wsUrl = `${wsBase}/ws?${params.toString()}`;

  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve({ ws: null, wsOpened: false, latestBySymbol, messageCount });
    }, 5_000);

    ws.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ws, wsOpened: true, latestBySymbol, messageCount });
    });

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      try {
        const parsed = JSON.parse(text);
        if (parsed?.type !== 'metrics' || typeof parsed?.symbol !== 'string') return;
        latestBySymbol.set(parsed.symbol, parsed);
        messageCount.count += 1;
      } catch {
        // ignore parse errors
      }
    });
  });
}

async function main(): Promise<void> {
  const healthStart = await getJson(`${BASE_URL}/api/health`);
  const symbolsFromHealth = Array.isArray(healthStart?.activeSymbols)
    ? healthStart!.activeSymbols.map((s: any) => String(s || '').toUpperCase()).filter((s: string) => s.length > 0)
    : [];
  const symbolsEnv = String(process.env.AUDIT_SYMBOLS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const symbols = symbolsEnv.length > 0 ? symbolsEnv : symbolsFromHealth;
  const preferredSymbols = symbols.length > 0 ? symbols : ['BTCUSDT'];

  const runtimeStart = getRuntimeCounters(healthStart);
  const wsState = await openMetricsWs(symbols);
  const samples: Sample[] = [];

  const sampleCount = Math.max(1, Math.floor(DURATION_MS / SAMPLE_INTERVAL_MS));
  for (let i = 0; i < sampleCount; i += 1) {
    const health = await getJson(`${BASE_URL}/api/health`);
    const payload = pickLatestPayload(wsState.latestBySymbol, preferredSymbols);
    const orch = payload?.orchestratorV1 || null;
    const telemetry = orch?.telemetry || {};
    samples.push({
      index: i + 1,
      ts: Date.now(),
      symbol: asString(payload?.symbol),
      decisionMode: asString(health?.decisionMode),
      intent: asString(orch?.intent),
      side: asString(orch?.side),
      allGatesPassed: Boolean(orch?.allGatesPassed),
      telemetrySideFlipCount5m: asNumber(telemetry?.sideFlipCount5m, 0),
      telemetrySideFlipPerMin: asNumber(telemetry?.sideFlipPerMin, 0),
      telemetryAllGatesTrueCount5m: asNumber(telemetry?.allGatesTrueCount5m, 0),
      telemetryEntryIntentCount5m: asNumber(telemetry?.entryIntentCount5m, 0),
    });
    if (i < sampleCount - 1) {
      await sleep(SAMPLE_INTERVAL_MS);
    }
  }

  if (wsState.ws) {
    try { wsState.ws.close(); } catch { /* noop */ }
  }

  const healthEnd = await getJson(`${BASE_URL}/api/health`);
  const runtimeEnd = getRuntimeCounters(healthEnd);

  const maxSideFlipCount = samples.reduce((acc, s) => Math.max(acc, s.telemetrySideFlipCount5m), 0);
  const maxSideFlipPerMin = samples.reduce((acc, s) => Math.max(acc, s.telemetrySideFlipPerMin), 0);
  const maxAllGatesTrue = samples.reduce((acc, s) => Math.max(acc, s.telemetryAllGatesTrueCount5m), 0);
  const maxEntryIntent = samples.reduce((acc, s) => Math.max(acc, s.telemetryEntryIntentCount5m), 0);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    durationMs: DURATION_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    sampleCount: samples.length,
    decisionMode: asString(healthEnd?.decisionMode),
    wsOpened: wsState.wsOpened,
    wsMetricsMessages: wsState.messageCount.count,
    sideFlipCount: maxSideFlipCount,
    sideFlipPerMin: maxSideFlipPerMin,
    allGatesTrueCount: maxAllGatesTrue,
    entryIntentCount: maxEntryIntent,
    makerOrdersPlacedDelta: runtimeEnd.makerOrdersPlaced - runtimeStart.makerOrdersPlaced,
    takerOrdersPlacedDelta: runtimeEnd.takerOrdersPlaced - runtimeStart.takerOrdersPlaced,
    ordersAttemptedDelta: runtimeEnd.ordersAttempted - runtimeStart.ordersAttempted,
    legacyDecisionCallsDelta: runtimeEnd.legacyDecisionCalls - runtimeStart.legacyDecisionCalls,
    samples,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    output: OUTPUT_FILE,
    decisionMode: report.decisionMode,
    sideFlipCount: report.sideFlipCount,
    sideFlipPerMin: report.sideFlipPerMin,
    allGatesTrueCount: report.allGatesTrueCount,
    entryIntentCount: report.entryIntentCount,
    makerOrdersPlacedDelta: report.makerOrdersPlacedDelta,
    takerOrdersPlacedDelta: report.takerOrdersPlacedDelta,
    legacyDecisionCallsDelta: report.legacyDecisionCallsDelta,
  }, null, 2));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`live_flipflop_audit failed: ${message}`);
  process.exitCode = 1;
});
