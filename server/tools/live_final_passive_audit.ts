import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

type Json = Record<string, any>;

const BASE_URL = String(process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const SAMPLE_INTERVAL_MS = 2_000;
const DURATION_MS = Math.max(
  SAMPLE_INTERVAL_MS,
  Number.isFinite(Number(process.env.AUDIT_DURATION_MS))
    ? Number(process.env.AUDIT_DURATION_MS)
    : 60_000
);
const SAMPLE_COUNT = Math.max(1, Math.floor(DURATION_MS / SAMPLE_INTERVAL_MS));
const DISABLED_REASON = 'DISABLED_DECISION_ENGINE';
const OUTPUT_FILE_NAME = String(process.env.AUDIT_OUTPUT_FILE || 'live_final_passive_audit.json').trim() || 'live_final_passive_audit.json';

interface RuntimeCounters {
  legacyDecisionCalls: number;
  orchestratorOrdersAttempted: number;
  ordersAttempted: number;
  makerOrdersPlaced: number;
  takerOrdersPlaced: number;
  executorEntrySkipped: number;
}

interface AuditSample {
  index: number;
  ts: number;
  symbol: string | null;
  decisionMode: string | null;
  runtime: RuntimeCounters;
  orchestratorIntent: string | null;
  orchestratorSide: string | null;
  orchestratorPresent: boolean;
  orchestratorReadiness: boolean;
  orchestratorReadinessReasons: string[];
  gateA: boolean;
  gateB: boolean;
  gateC: boolean;
  allGatesTrue: boolean;
  signal: string | null;
  signalVetoReason: string | null;
  signalDisabled: boolean;
  aiBiasSide: string | null;
  aiTrendSide: string | null;
  bootstrapBackfillDone: boolean;
  bootstrapBarsLoaded1m: number;
  printsPerSecond: number | null;
  sessionVwapValue: number | null;
  htfH1BarStartMs: number | null;
  trendinessScore: number | null;
  chopScore: number | null;
  volOfVol: number | null;
  spreadPct: number | null;
  oiChangePct: number | null;
  obiWeighted: number | null;
  obiDeep: number | null;
  deltaZ: number | null;
  cvdSlope: number | null;
  cvdTf5mState: string | null;
}

function toWsBase(httpBase: string): string {
  if (httpBase.startsWith('https://')) {
    return `wss://${httpBase.slice('https://'.length)}`;
  }
  if (httpBase.startsWith('http://')) {
    return `ws://${httpBase.slice('http://'.length)}`;
  }
  return `ws://${httpBase}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

async function getJson(url: string): Promise<Json | null> {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      return null;
    }
    const payload = await res.json().catch(() => null);
    return payload && typeof payload === 'object' ? payload as Json : null;
  } catch {
    return null;
  }
}

function makeRuntimeCounters(health: Json | null): RuntimeCounters {
  const dr = health?.decisionRuntime || {};
  const ordersAttempted = Number(dr?.ordersAttempted || 0);
  return {
    legacyDecisionCalls: Number(dr?.legacyDecisionCalls || 0),
    orchestratorOrdersAttempted: ordersAttempted,
    ordersAttempted,
    makerOrdersPlaced: Number(dr?.makerOrdersPlaced || 0),
    takerOrdersPlaced: Number(dr?.takerOrdersPlaced || 0),
    executorEntrySkipped: Number(dr?.executorEntrySkipped || 0),
  };
}

function pickLatestPayload(latestBySymbol: Map<string, Json>, preferredSymbols: string[]): Json | null {
  for (const symbol of preferredSymbols) {
    const payload = latestBySymbol.get(symbol);
    if (payload) return payload;
  }
  let freshest: Json | null = null;
  let freshestTs = -1;
  for (const payload of latestBySymbol.values()) {
    const ts = Number(payload?.event_time_ms || payload?.snapshot?.ts || 0);
    if (ts > freshestTs) {
      freshest = payload;
      freshestTs = ts;
    }
  }
  return freshest;
}

function valueChanged(series: Array<number | null>, epsilon = 1e-12): boolean {
  const values = series.filter((v): v is number => Number.isFinite(v as number));
  if (values.length < 2) return false;
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i += 1) {
    min = Math.min(min, values[i]);
    max = Math.max(max, values[i]);
  }
  return (max - min) > epsilon;
}

function makeDiagnosis(input: {
  decisionMode: string | null;
  metricsFlowing: boolean;
  readinessOk: boolean;
  signalDisabledCount: number;
  orchestratorPresentCount: number;
  entryIntentCount: number;
  allGatesTrueCount: number;
  ordersAttemptedDelta: number;
}): string {
  if (input.decisionMode !== 'orchestrator_v1') {
    return 'MODE_MISMATCH';
  }
  if (!input.metricsFlowing) {
    return 'DATA_STALL';
  }
  if (input.signalDisabledCount > 0 && input.orchestratorPresentCount > 0) {
    return 'LEGACY_SIGNAL_FIELD_ONLY';
  }
  if (!input.readinessOk) {
    return 'READINESS_BLOCK';
  }
  if (input.entryIntentCount === 0) {
    return input.allGatesTrueCount === 0 ? 'OK_BUT_NO_SETUP' : 'NO_SIGNAL';
  }
  if (input.ordersAttemptedDelta <= 0) {
    return 'EXECUTION_BLOCK';
  }
  return 'OK_BUT_NO_SETUP';
}

async function openMetricsWs(symbols: string[]): Promise<{
  ws: WebSocket | null;
  latestBySymbol: Map<string, Json>;
  wsOpened: boolean;
  wsMessages: { count: number; lastTs: number | null };
}> {
  const latestBySymbol = new Map<string, Json>();
  const wsMessages = { count: 0, lastTs: null as number | null };
  if (symbols.length === 0) {
    return { ws: null, latestBySymbol, wsOpened: false, wsMessages };
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
      resolve({ ws: null, latestBySymbol, wsOpened: false, wsMessages });
    }, 5_000);

    ws.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ws, latestBySymbol, wsOpened: true, wsMessages });
    });

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      try {
        const parsed = JSON.parse(text);
        if (parsed?.type !== 'metrics' || typeof parsed?.symbol !== 'string') {
          return;
        }
        latestBySymbol.set(parsed.symbol, parsed);
        wsMessages.count += 1;
        wsMessages.lastTs = Date.now();
      } catch {
        // Ignore malformed frames.
      }
    });

    ws.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch { /* noop */ }
      resolve({ ws: null, latestBySymbol, wsOpened: false, wsMessages });
    });

    ws.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ws: null, latestBySymbol, wsOpened: false, wsMessages });
    });
  });
}

async function main() {
  const outDir = path.resolve(__dirname, '..', 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, OUTPUT_FILE_NAME);

  const initialHealth = await getJson(`${BASE_URL}/api/health`);
  const initialSymbols = Array.isArray(initialHealth?.activeSymbols)
    ? initialHealth.activeSymbols.map((s: unknown) => String(s || '').toUpperCase()).filter((s: string) => s.length > 0)
    : [];
  const symbols = initialSymbols.length > 0 ? initialSymbols : ['BTCUSDT'];

  const wsBundle = await openMetricsWs(symbols);
  const rows: AuditSample[] = [];
  const printsSeries: Array<number | null> = [];
  const cvdSlopeSeries: Array<number | null> = [];
  const sessionVwapSeries: Array<number | null> = [];

  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const tickStart = Date.now();
    const [health, backfill, status] = await Promise.all([
      getJson(`${BASE_URL}/api/health`),
      getJson(`${BASE_URL}/api/backfill/status`),
      getJson(`${BASE_URL}/api/status`),
    ]);
    const _status = status; // Keep explicit to document 3rd GET endpoint usage.
    void _status;

    const activeSymbols = Array.isArray(health?.activeSymbols)
      ? health.activeSymbols.map((s: unknown) => String(s || '').toUpperCase()).filter((s: string) => s.length > 0)
      : symbols;
    const payload = pickLatestPayload(wsBundle.latestBySymbol, activeSymbols);
    const symbol = asString(payload?.symbol);
    const orchestrator = payload?.orchestratorV1 || null;
    const signalDisplay = payload?.signalDisplay || null;
    const aiBias = payload?.aiBias || null;
    const aiTrend = payload?.aiTrend || null;
    const bootstrap = payload?.bootstrap || null;
    const regime = payload?.regimeMetrics || null;
    const legacy = payload?.legacyMetrics || null;
    const cvd = payload?.cvd || null;
    const runtime = makeRuntimeCounters(health);
    const orchestratorReadiness = asBoolean(orchestrator?.readiness?.ready);
    const sessionVwapValue = asNumber(payload?.sessionVwap?.value);
    const printsPerSecond = asNumber(payload?.timeAndSales?.printsPerSecond);
    const cvdSlope = asNumber(legacy?.cvdSlope);

    printsSeries.push(printsPerSecond);
    cvdSlopeSeries.push(cvdSlope);
    sessionVwapSeries.push(sessionVwapValue);

    const row: AuditSample = {
      index: i + 1,
      ts: Date.now(),
      symbol,
      decisionMode: asString(health?.decisionMode),
      runtime,
      orchestratorIntent: asString(orchestrator?.intent),
      orchestratorSide: asString(orchestrator?.side),
      orchestratorPresent: Boolean(orchestrator && typeof orchestrator === 'object'),
      orchestratorReadiness,
      orchestratorReadinessReasons: Array.isArray(orchestrator?.readiness?.reasons)
        ? orchestrator.readiness.reasons.map((reason: unknown) => String(reason || ''))
        : [],
      gateA: asBoolean(orchestrator?.gateA?.passed),
      gateB: asBoolean(orchestrator?.gateB?.passed),
      gateC: asBoolean(orchestrator?.gateC?.passed),
      allGatesTrue: asBoolean(orchestrator?.allGatesPassed),
      signal: asString(signalDisplay?.signal),
      signalVetoReason: asString(signalDisplay?.vetoReason),
      signalDisabled: String(signalDisplay?.vetoReason || '') === DISABLED_REASON,
      aiBiasSide: asString(aiBias?.side),
      aiTrendSide: asString(aiTrend?.side),
      bootstrapBackfillDone: asBoolean(bootstrap?.backfillDone),
      bootstrapBarsLoaded1m: Number(bootstrap?.barsLoaded1m || 0),
      printsPerSecond,
      sessionVwapValue,
      htfH1BarStartMs: asNumber(payload?.htf?.h1?.barStartMs),
      trendinessScore: asNumber(regime?.trendinessScore),
      chopScore: asNumber(regime?.chopScore),
      volOfVol: asNumber(regime?.volOfVol),
      spreadPct: asNumber(payload?.spreadPct),
      oiChangePct: asNumber(payload?.openInterest?.oiChangePct),
      obiWeighted: asNumber(legacy?.obiWeighted),
      obiDeep: asNumber(legacy?.obiDeep),
      deltaZ: asNumber(legacy?.deltaZ),
      cvdSlope,
      cvdTf5mState: asString(cvd?.tf5m?.state),
    };
    rows.push(row);

    const elapsed = Date.now() - tickStart;
    const waitMs = Math.max(0, SAMPLE_INTERVAL_MS - elapsed);
    if (i < SAMPLE_COUNT - 1 && waitMs > 0) {
      await sleep(waitMs);
    }
  }

  try {
    wsBundle.ws?.close();
  } catch {
    // noop
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const metricsFlowing = Boolean(
    wsBundle.wsMessages.count > 0
    && (valueChanged(printsSeries) || valueChanged(cvdSlopeSeries) || valueChanged(sessionVwapSeries))
  );
  const readinessOk = rows.some((row) =>
    row.orchestratorReadiness
    || (
      row.bootstrapBackfillDone
      && row.bootstrapBarsLoaded1m >= 360
      && row.sessionVwapValue != null
      && row.htfH1BarStartMs != null
      && Number(row.printsPerSecond || 0) > 3
    )
  );

  const signalDisabledCount = rows.filter((row) => row.signalDisabled).length;
  const orchestratorPresentCount = rows.filter((row) => row.orchestratorPresent).length;
  const gateATrueCount = rows.filter((row) => row.gateA).length;
  const gateBTrueCount = rows.filter((row) => row.gateB).length;
  const gateCTrueCount = rows.filter((row) => row.gateC).length;
  const allGatesTrueCount = rows.filter((row) => row.allGatesTrue).length;
  const entryIntentCount = rows.filter((row) => row.orchestratorIntent === 'ENTRY').length;
  const ordersAttemptedDelta = Math.max(0, (last?.runtime.ordersAttempted || 0) - (first?.runtime.ordersAttempted || 0));
  const makerOrdersDelta = Math.max(0, (last?.runtime.makerOrdersPlaced || 0) - (first?.runtime.makerOrdersPlaced || 0));
  const takerOrdersDelta = Math.max(0, (last?.runtime.takerOrdersPlaced || 0) - (first?.runtime.takerOrdersPlaced || 0));
  const legacyDecisionCallsDelta = Math.max(0, (last?.runtime.legacyDecisionCalls || 0) - (first?.runtime.legacyDecisionCalls || 0));
  const decisionMode = asString(last?.decisionMode);

  const diagnosis = makeDiagnosis({
    decisionMode,
    metricsFlowing,
    readinessOk,
    signalDisabledCount,
    orchestratorPresentCount,
    entryIntentCount,
    allGatesTrueCount,
    ordersAttemptedDelta,
  });

  const signalDisabledButOrchestrator = rows.find((row) => row.signalDisabled && row.orchestratorPresent) || null;
  const readinessTrueSample = rows.find((row) => row.orchestratorReadiness) || rows.find((row) =>
    row.bootstrapBackfillDone
    && row.bootstrapBarsLoaded1m >= 360
    && row.sessionVwapValue != null
    && row.htfH1BarStartMs != null
    && Number(row.printsPerSecond || 0) > 3
  ) || null;
  const entryIntentSample = rows.find((row) => row.orchestratorIntent === 'ENTRY') || null;

  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: DURATION_MS,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    sampleCount: rows.length,
    baseUrl: BASE_URL,
    endpoints: {
      health: `${BASE_URL}/api/health`,
      backfillStatus: `${BASE_URL}/api/backfill/status`,
      status: `${BASE_URL}/api/status`,
      metricsWs: `${toWsBase(BASE_URL)}/ws?symbols=${symbols.join(',')}`,
    },
    ws: {
      opened: wsBundle.wsOpened,
      messageCount: wsBundle.wsMessages.count,
      lastMessageTs: wsBundle.wsMessages.lastTs,
    },
    decisionMode,
    metricsFlowing,
    readinessOk,
    signalDisabledCount,
    orchestratorPresentCount,
    gateA_true_count: gateATrueCount,
    gateB_true_count: gateBTrueCount,
    gateC_true_count: gateCTrueCount,
    allGatesTrue_count: allGatesTrueCount,
    entryIntentCount,
    ordersAttemptedDelta,
    makerOrdersDelta,
    takerOrdersDelta,
    legacyDecisionCallsDelta,
    diagnosis,
    sampleRows: {
      signalDisabledButOrchestrator,
      readinessTrueSample,
      entryIntentSample,
    },
    samples: rows,
  };

  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(outPath, body, 'utf8');
  process.stdout.write(`${body}\n`);
}

main().catch((error) => {
  const outDir = path.resolve(__dirname, '..', 'logs', 'audit');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, OUTPUT_FILE_NAME);
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'error',
    error: error instanceof Error ? error.message : 'live_final_passive_audit_failed',
  };
  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(outPath, body, 'utf8');
  process.stdout.write(`${body}\n`);
  process.exit(1);
});
