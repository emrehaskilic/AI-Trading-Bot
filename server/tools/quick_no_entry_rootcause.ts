import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

type Json = Record<string, any>;
type FallbackBlockedReason = 'NO_TIMEOUT' | 'IMPULSE_FALSE' | 'GATES_FALSE' | 'DRYRUN_BLOCK' | 'CONFIG_BLOCK' | 'OTHER';

const BASE_URL = String(process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const WINDOW_SEC = Math.max(10, Number(process.env.AUDIT_WINDOW_SEC || 60));
const INTERVAL_MS = Math.max(1_000, Number(process.env.AUDIT_INTERVAL_MS || 2_000));
const OUTPUT_FILE = path.join('server', 'logs', 'audit', 'quick_no_entry_rootcause.json');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toWsBase(httpBase: string): string {
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}`;
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}`;
  return `ws://${httpBase}`;
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

function incrementCounter(target: Record<string, number>, key: string): void {
  target[key] = asNumber(target[key], 0) + 1;
}

function deriveBlockReason(orch: Json | null, nowMs: number): string {
  if (!orch) return 'NONE';
  const readiness = Boolean(orch?.readiness?.ready);
  if (!readiness) return 'READINESS';
  if (!Boolean(orch?.gateA?.passed)) {
    if (orch?.gateA?.checks?.trendiness === false) return 'GateA.trendiness';
    if (orch?.gateA?.checks?.chop === false) return 'GateA.chop';
    if (orch?.gateA?.checks?.volOfVol === false) return 'GateA.volOfVol';
    if (orch?.gateA?.checks?.spread === false) return 'GateA.spread';
    if (orch?.gateA?.checks?.oiDrop === false) return 'GateA.oiDrop';
    return 'GateA.other';
  }
  if (!Boolean(orch?.gateB?.passed)) {
    if (orch?.gateB?.checks?.cvd === false) return 'GateB.cvd';
    if (orch?.gateB?.checks?.obiSupport === false) return 'GateB.obiSupport';
    if (orch?.gateB?.checks?.deltaZ === false) return 'GateB.deltaZ';
    if (orch?.gateB?.checks?.side === false) return 'GateB.side';
    return 'GateB.other';
  }
  if (!Boolean(orch?.gateC?.passed)) {
    if (orch?.gateC?.checks?.vwapDistance === false) return 'GateC.vwapDistance';
    if (orch?.gateC?.checks?.vol1m === false) return 'GateC.vol1m';
    return 'GateC.other';
  }
  if (asNumber(orch?.position?.cooldownUntilTs, 0) > nowMs) return 'COOLDOWN';
  return 'NONE';
}

async function openMetricsWs(symbols: string[]): Promise<{
  ws: WebSocket | null;
  wsOpened: boolean;
  latestBySymbol: Map<string, Json>;
}> {
  const latestBySymbol = new Map<string, Json>();
  if (symbols.length === 0) {
    return { ws: null, wsOpened: false, latestBySymbol };
  }

  const params = new URLSearchParams();
  params.set('symbols', symbols.join(','));
  const wsUrl = `${toWsBase(BASE_URL)}/ws?${params.toString()}`;

  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* noop */ }
      resolve({ ws: null, wsOpened: false, latestBySymbol });
    }, 5_000);

    ws.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ws, wsOpened: true, latestBySymbol });
    });

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      try {
        const parsed = JSON.parse(text);
        if (parsed?.type !== 'metrics' || typeof parsed?.symbol !== 'string') return;
        latestBySymbol.set(parsed.symbol, parsed);
      } catch {
        // ignore parse errors
      }
    });
  });
}

function topBlockBySymbol(blockCountsBySymbol: Record<string, Record<string, number>>): Array<{ symbol: string; block: string; count: number }> {
  const out: Array<{ symbol: string; block: string; count: number }> = [];
  for (const [symbol, counters] of Object.entries(blockCountsBySymbol)) {
    let topBlock = 'NONE';
    let topCount = 0;
    for (const [block, countRaw] of Object.entries(counters)) {
      const count = asNumber(countRaw, 0);
      if (count > topCount) {
        topCount = count;
        topBlock = block;
      }
    }
    out.push({ symbol, block: topBlock, count: topCount });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

function topFallbackReason(counters: Record<string, number>): string {
  let topReason = 'OTHER';
  let topCount = -1;
  const order: FallbackBlockedReason[] = ['IMPULSE_FALSE', 'GATES_FALSE', 'NO_TIMEOUT', 'DRYRUN_BLOCK', 'CONFIG_BLOCK', 'OTHER'];
  for (const reason of order) {
    const count = asNumber(counters[reason], 0);
    if (count > topCount) {
      topCount = count;
      topReason = reason;
    }
  }
  return topReason;
}

async function main(): Promise<void> {
  const healthStart = await getJson(`${BASE_URL}/api/health`);
  const runtimeStart = (healthStart?.decisionRuntime || {}) as Json;
  const decisionMode = asString(healthStart?.decisionMode) || 'unknown';
  const symbols = Array.isArray(healthStart?.activeSymbols)
    ? healthStart!.activeSymbols.map((s: any) => String(s || '').toUpperCase()).filter((s: string) => s.length > 0)
    : [];

  const wsState = await openMetricsWs(symbols);

  const blockCountsBySymbol: Record<string, Record<string, number>> = {};
  const fallbackBlockedReasonCounts: Record<string, number> = {};
  const prevChaseActive = new Map<string, boolean>();
  const prevChaseExpires = new Map<string, number | null>();

  let allGatesTrueCount = 0;
  let entryCandidateCount = 0;
  let gateBFailCvdCount = 0;
  let gateBFailObiCount = 0;
  let gateBFailDeltaZCount = 0;
  let gateAFailTrendinessCount = 0;
  let chaseStartedCount = 0;
  let chaseTimedOutCount = 0;
  let impulseTrueCount = 0;
  let fallbackEligibleCount = 0;
  let fallbackTriggeredCount = 0;
  let lastPositionQty = 0;

  const iterations = Math.max(1, Math.floor((WINDOW_SEC * 1000) / INTERVAL_MS));
  for (let i = 0; i < iterations; i += 1) {
    const nowMs = Date.now();
    for (const symbol of symbols) {
      const payload = wsState.latestBySymbol.get(symbol);
      if (!payload) continue;
      const orch = payload?.orchestratorV1 || null;
      if (!orch) continue;

      const gateA = Boolean(orch?.gateA?.passed);
      const gateB = Boolean(orch?.gateB?.passed);
      const gateC = Boolean(orch?.gateC?.passed);
      const readiness = Boolean(orch?.readiness?.ready);
      const entryCandidate = readiness && gateA && gateB && gateC;
      const impulse = Boolean(orch?.impulse?.passed);
      const chaseActive = Boolean(orch?.chase?.active);
      const orders = Array.isArray(orch?.orders) ? orch.orders : [];

      if (orch?.gateB?.checks?.cvd === false) gateBFailCvdCount += 1;
      if (orch?.gateB?.checks?.obiSupport === false) gateBFailObiCount += 1;
      if (orch?.gateB?.checks?.deltaZ === false) gateBFailDeltaZCount += 1;
      if (orch?.gateA?.checks?.trendiness === false) gateAFailTrendinessCount += 1;
      if (orch?.allGatesPassed) allGatesTrueCount += 1;
      if (entryCandidate) entryCandidateCount += 1;
      if (impulse) impulseTrueCount += 1;

      const prevActive = Boolean(prevChaseActive.get(symbol));
      const prevExpiresAt = prevChaseExpires.get(symbol) ?? null;
      if (!prevActive && chaseActive) chaseStartedCount += 1;

      const timedOutNow = prevActive && !chaseActive && (
        (Number.isFinite(Number(prevExpiresAt)) && Number(prevExpiresAt) > 0 && nowMs >= Number(prevExpiresAt))
        || asNumber(orch?.chase?.repricesUsed, 0) >= asNumber(orch?.chase?.maxReprices, 0)
      );
      if (timedOutNow) chaseTimedOutCount += 1;

      const fallbackTriggered = orders.some((o: any) => o?.kind === 'TAKER_ENTRY_FALLBACK');
      if (fallbackTriggered) fallbackTriggeredCount += 1;

      const fallbackEligible = Boolean(timedOutNow && impulse && entryCandidate);
      if (fallbackEligible) fallbackEligibleCount += 1;

      let blockedReason: FallbackBlockedReason | null = null;
      if (!fallbackTriggered) {
        if (chaseActive && !timedOutNow) blockedReason = 'NO_TIMEOUT';
        else if (timedOutNow && !impulse) blockedReason = 'IMPULSE_FALSE';
        else if (timedOutNow && !entryCandidate) blockedReason = 'GATES_FALSE';
        else if (timedOutNow && decisionMode !== 'orchestrator_v1') blockedReason = 'CONFIG_BLOCK';
        else if (timedOutNow) blockedReason = 'OTHER';
      }
      if (blockedReason) incrementCounter(fallbackBlockedReasonCounts, blockedReason);

      const blockReason = asString(orch?.debug?.blockReason) || deriveBlockReason(orch, nowMs);
      if (!blockCountsBySymbol[symbol]) blockCountsBySymbol[symbol] = {};
      incrementCounter(blockCountsBySymbol[symbol], blockReason);

      const qty = asNumber(orch?.position?.qty, 0);
      if (qty > 0) lastPositionQty = qty;

      prevChaseActive.set(symbol, chaseActive);
      prevChaseExpires.set(
        symbol,
        Number.isFinite(Number(orch?.chase?.expiresAtMs)) ? Number(orch?.chase?.expiresAtMs) : null
      );
    }
    if (i < iterations - 1) {
      await sleep(INTERVAL_MS);
    }
  }

  if (wsState.ws) {
    try { wsState.ws.close(); } catch { /* noop */ }
  }

  const healthEnd = await getJson(`${BASE_URL}/api/health`);
  const runtimeEnd = (healthEnd?.decisionRuntime || {}) as Json;

  const makerOrdersPlacedDelta = asNumber(runtimeEnd.makerOrdersPlaced, 0) - asNumber(runtimeStart.makerOrdersPlaced, 0);
  const takerOrdersPlacedDelta = asNumber(runtimeEnd.takerOrdersPlaced, 0) - asNumber(runtimeStart.takerOrdersPlaced, 0);
  const makerFillsCountDelta = asNumber(runtimeEnd.makerFillsCount, 0) - asNumber(runtimeStart.makerFillsCount, 0);
  const takerFillsCountDelta = asNumber(runtimeEnd.takerFillsCount, 0) - asNumber(runtimeStart.takerFillsCount, 0);
  const postOnlyRejectDelta = asNumber(runtimeEnd.postOnlyRejectCount, 0) - asNumber(runtimeStart.postOnlyRejectCount, 0);
  const cancelDelta = asNumber(runtimeEnd.cancelCount, 0) - asNumber(runtimeStart.cancelCount, 0);
  const replaceDelta = asNumber(runtimeEnd.replaceCount, 0) - asNumber(runtimeStart.replaceCount, 0);

  const fallbackBlockedReasonTop = topFallbackReason(fallbackBlockedReasonCounts);

  let diagnosis = 'OK';
  if (allGatesTrueCount === 0) {
    diagnosis = 'NO_SETUP_GATES_BLOCKING';
  } else if (entryCandidateCount > 0 && chaseStartedCount === 0) {
    diagnosis = 'ENTRY_PIPELINE_NOT_STARTING_CHASE';
  } else if (chaseStartedCount > 0 && chaseTimedOutCount === 0) {
    diagnosis = 'CHASE_NEVER_TIMEOUTS_OR_REPRICE_LOOP';
  } else if (chaseTimedOutCount > 0 && impulseTrueCount === 0) {
    diagnosis = 'FALLBACK_IMPULSE_NEVER_TRUE';
  } else if (fallbackEligibleCount > 0 && fallbackTriggeredCount === 0) {
    diagnosis = 'FALLBACK_CODEPATH_BLOCKED';
  } else if (makerOrdersPlacedDelta > 0 && makerFillsCountDelta === 0 && asNumber(runtimeEnd.positionQty, lastPositionQty) === 0) {
    diagnosis = 'NO_FILL_POSTONLY_TOO_PASSIVE_OR_REJECTS';
  } else if ((makerFillsCountDelta + takerFillsCountDelta) > 0 && asNumber(runtimeEnd.positionQty, lastPositionQty) === 0) {
    diagnosis = 'POSITION_STATE_NOT_UPDATING';
  }

  const report = {
    windowSec: WINDOW_SEC,
    decisionMode: asString(healthEnd?.decisionMode) || decisionMode,
    allGatesTrue_count: allGatesTrueCount,
    entryCandidateCount,
    gateB_fail_cvd_count: gateBFailCvdCount,
    gateB_fail_obi_count: gateBFailObiCount,
    gateB_fail_deltaZ_count: gateBFailDeltaZCount,
    gateA_fail_trendiness_count: gateAFailTrendinessCount,
    chaseStartedCount,
    chaseTimedOutCount,
    impulseTrueCount,
    fallbackEligibleCount,
    fallbackTriggeredCount,
    fallbackBlockedReasonTop,
    makerOrdersPlacedDelta,
    takerOrdersPlacedDelta,
    makerFillsCountDelta,
    takerFillsCountDelta,
    positionQty: asNumber(runtimeEnd.positionQty, lastPositionQty),
    postOnlyRejectDelta,
    cancelDelta,
    replaceDelta,
    diagnosis,
    topSymbolsByBlockReason: topBlockBySymbol(blockCountsBySymbol),
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`quick_no_entry_rootcause failed: ${message}`);
  process.exitCode = 1;
});
