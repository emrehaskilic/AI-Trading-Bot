import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import WebSocket from 'ws';

type Json = Record<string, any>;

const BASE_URL = String(process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const VIDEO_PATH_INPUT = String(
  process.env.AUDIT_VIDEO_PATH || '/mnt/data/Ekran Kaydı 2026-02-26 19.06.57.mov'
);
const SAMPLE_INTERVAL_MS = Math.max(500, Number(process.env.AUDIT_SAMPLE_INTERVAL_MS || 1000));
const DURATION_MS = Math.max(10_000, Number(process.env.AUDIT_DURATION_MS || 90_000));
const VIDEO_TOLERANCE_MS = 1_000;
const VIDEO_TOLERANCE_FALLBACK_MS = 2_000;
const OUT_DIR = path.resolve(__dirname, '..', 'logs', 'audit');

interface VideoMeta {
  exists: boolean;
  inputPath: string;
  resolvedPath: string | null;
  sizeBytes: number | null;
  mtimeMs: number | null;
  ctimeMs: number | null;
  durationSec: number | null;
  creationTimeIso: string | null;
  frameFps: number;
  frameExtractionEnabled: boolean;
  ocrEnabled: boolean;
  blockingReason: string | null;
}

interface FrameRow {
  frameIndex: number;
  ts_ms: number;
  video_ts_iso: string;
  ui_trend_text: string | null;
  ui_trend_color: string | null;
  screenshotPath: string | null;
  ocrSource: 'tesseract' | 'none';
}

interface PayloadSample {
  snapshotIndex: number;
  symbol: string;
  ts_ms: number;
  receivedAtMs: number;
  orchestrator: {
    intent: string | null;
    side: string | null;
    gates: { gateA: boolean; gateB: boolean; gateC: boolean; allGatesTrue: boolean };
    readiness: boolean;
    readinessReasons: string[];
    add: { step: number | null; triggered: boolean };
    position: { addsUsed: number; cooldownUntilTs: number | null };
  };
  signalDisplay: { signal: string | null; vetoReason: string | null };
  aiTrend: { side: string | null };
  aiBias: { side: string | null };
  metrics: {
    trendinessScore: number | null;
    chopScore: number | null;
    obiWeighted: number | null;
    obiDeep: number | null;
    deltaZ: number | null;
    cvdSlope: number | null;
    cvdTf5mState: string | null;
    printsPerSecond: number | null;
    sessionVwapPriceDistanceBps: number | null;
    oiChangePct: number | null;
  };
  runtimeCounters: {
    orchestratorOrdersAttempted: number;
    makerOrdersPlaced: number;
    takerOrdersPlaced: number;
    legacyDecisionCalls: number;
  };
}

interface MappedRow {
  frameIndex: number;
  frameTsMs: number;
  snapshotIndex: number | null;
  snapshotTsMs: number | null;
  deltaMs: number | null;
  toleranceMsUsed: number;
  symbol: string | null;
  uiTrendText: string | null;
  uiTrendColor: string | null;
  orchestratorSide: string | null;
  orchestratorIntent: string | null;
  signalDisplaySignal: string | null;
  aiTrendSide: string | null;
  aiBiasSide: string | null;
  gates: { gateA: boolean; gateB: boolean; gateC: boolean; allGatesTrue: boolean } | null;
}

function toWsBase(httpBase: string): string {
  if (httpBase.startsWith('https://')) return `wss://${httpBase.slice('https://'.length)}`;
  if (httpBase.startsWith('http://')) return `ws://${httpBase.slice('http://'.length)}`;
  return `ws://${httpBase}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url: string): Promise<Json | null> {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && typeof data === 'object' ? (data as Json) : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function bool(value: unknown): boolean {
  return Boolean(value);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + ((v - m) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function normalizeSide(value: string | null): 'LONG' | 'SHORT' | 'NONE' {
  const v = String(value || '').toUpperCase();
  if (v === 'BUY' || v === 'LONG') return 'LONG';
  if (v === 'SELL' || v === 'SHORT') return 'SHORT';
  return 'NONE';
}

function normalizeSignalDirection(value: string | null): 'LONG' | 'SHORT' | 'NONE' {
  const v = String(value || '').toUpperCase();
  if (v.includes('LONG')) return 'LONG';
  if (v.includes('SHORT')) return 'SHORT';
  return 'NONE';
}

function resolveVideoPath(inputPath: string): string | null {
  const candidates = new Set<string>([
    inputPath,
    inputPath.replace(/\//g, path.sep),
    path.resolve(process.cwd(), inputPath),
  ]);
  if (inputPath.startsWith('/mnt/')) {
    const winFromMnt = `C:${inputPath.replace(/\//g, '\\')}`;
    candidates.add(winFromMnt);
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function commandExists(command: string): boolean {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readVideoMeta(videoPath: string | null): VideoMeta {
  if (!videoPath) {
    return {
      exists: false,
      inputPath: VIDEO_PATH_INPUT,
      resolvedPath: null,
      sizeBytes: null,
      mtimeMs: null,
      ctimeMs: null,
      durationSec: null,
      creationTimeIso: null,
      frameFps: 1,
      frameExtractionEnabled: false,
      ocrEnabled: false,
      blockingReason: 'VIDEO_PATH_NOT_FOUND',
    };
  }

  const stats = fs.statSync(videoPath);
  const ffprobeExists = commandExists('ffprobe');
  const ffmpegExists = commandExists('ffmpeg');
  const tesseractExists = commandExists('tesseract');

  let durationSec: number | null = null;
  let creationTimeIso: string | null = null;
  if (ffprobeExists) {
    try {
      const raw = execFileSync('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        videoPath,
      ], { encoding: 'utf8' });
      const parsed = JSON.parse(raw);
      durationSec = num(parsed?.format?.duration);
      creationTimeIso = str(parsed?.format?.tags?.creation_time);
    } catch {
      // ignore probe failure
    }
  }

  return {
    exists: true,
    inputPath: VIDEO_PATH_INPUT,
    resolvedPath: videoPath,
    sizeBytes: Number(stats.size),
    mtimeMs: Number(stats.mtimeMs),
    ctimeMs: Number(stats.ctimeMs),
    durationSec,
    creationTimeIso,
    frameFps: 1,
    frameExtractionEnabled: ffmpegExists && ffprobeExists,
    ocrEnabled: tesseractExists && ffmpegExists,
    blockingReason: null,
  };
}

async function collectPayloadSeries(durationMs: number): Promise<{
  startedAtMs: number;
  endedAtMs: number;
  decisionMode: string | null;
  readinessState: Json | null;
  payloadSamples: PayloadSample[];
}> {
  const initialHealth = await getJson(`${BASE_URL}/api/health`);
  const decisionMode = str(initialHealth?.decisionMode);
  const activeSymbols = Array.isArray(initialHealth?.activeSymbols)
    ? initialHealth.activeSymbols.map((s: unknown) => String(s || '').toUpperCase()).filter((s: string) => s.length > 0)
    : ['BTCUSDT'];
  const symbolsQuery = activeSymbols.join(',');
  const wsUrl = `${toWsBase(BASE_URL)}/ws?symbols=${symbolsQuery}`;
  const latestBySymbol = new Map<string, Json>();

  const ws = await new Promise<WebSocket | null>((resolve) => {
    let settled = false;
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* noop */ }
      resolve(null);
    }, 5_000);
    socket.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(null);
    });
  });

  if (ws) {
    ws.on('message', (raw) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = JSON.parse(text);
        if (msg?.type === 'metrics' && typeof msg?.symbol === 'string') {
          latestBySymbol.set(msg.symbol, msg);
        }
      } catch {
        // ignore parse
      }
    });
  }

  const payloadSamples: PayloadSample[] = [];
  let snapshotIndex = 0;
  let lastHealth: Json | null = initialHealth;
  const startedAtMs = Date.now();
  const deadline = startedAtMs + durationMs;
  let nextHealthAt = startedAtMs;

  while (Date.now() < deadline) {
    const tickStart = Date.now();
    if (tickStart >= nextHealthAt) {
      lastHealth = await getJson(`${BASE_URL}/api/health`);
      nextHealthAt = tickStart + 2_000;
    }

    for (const symbol of activeSymbols) {
      const payload = latestBySymbol.get(symbol);
      if (!payload) continue;
      snapshotIndex += 1;
      const tsMs = Number(payload?.event_time_ms || payload?.snapshot?.ts || Date.now());
      const orchestrator = payload?.orchestratorV1 || {};
      const sample: PayloadSample = {
        snapshotIndex,
        symbol,
        ts_ms: tsMs,
        receivedAtMs: Date.now(),
        orchestrator: {
          intent: str(orchestrator?.intent),
          side: str(orchestrator?.side),
          gates: {
            gateA: bool(orchestrator?.gateA?.passed),
            gateB: bool(orchestrator?.gateB?.passed),
            gateC: bool(orchestrator?.gateC?.passed),
            allGatesTrue: bool(orchestrator?.allGatesPassed),
          },
          readiness: bool(orchestrator?.readiness?.ready),
          readinessReasons: Array.isArray(orchestrator?.readiness?.reasons)
            ? orchestrator.readiness.reasons.map((reason: unknown) => String(reason || ''))
            : [],
          add: {
            step: num(orchestrator?.add?.step),
            triggered: bool(orchestrator?.add?.triggered),
          },
          position: {
            addsUsed: Number(orchestrator?.position?.addsUsed || 0),
            cooldownUntilTs: num(orchestrator?.position?.cooldownUntilTs),
          },
        },
        signalDisplay: {
          signal: str(payload?.signalDisplay?.signal),
          vetoReason: str(payload?.signalDisplay?.vetoReason),
        },
        aiTrend: {
          side: str(payload?.aiTrend?.side),
        },
        aiBias: {
          side: str(payload?.aiBias?.side),
        },
        metrics: {
          trendinessScore: num(payload?.regimeMetrics?.trendinessScore),
          chopScore: num(payload?.regimeMetrics?.chopScore),
          obiWeighted: num(payload?.legacyMetrics?.obiWeighted),
          obiDeep: num(payload?.legacyMetrics?.obiDeep),
          deltaZ: num(payload?.legacyMetrics?.deltaZ),
          cvdSlope: num(payload?.legacyMetrics?.cvdSlope),
          cvdTf5mState: str(payload?.cvd?.tf5m?.state),
          printsPerSecond: num(payload?.timeAndSales?.printsPerSecond),
          sessionVwapPriceDistanceBps: num(payload?.sessionVwap?.priceDistanceBps),
          oiChangePct: num(payload?.openInterest?.oiChangePct),
        },
        runtimeCounters: {
          orchestratorOrdersAttempted: Number(lastHealth?.decisionRuntime?.ordersAttempted || 0),
          makerOrdersPlaced: Number(lastHealth?.decisionRuntime?.makerOrdersPlaced || 0),
          takerOrdersPlaced: Number(lastHealth?.decisionRuntime?.takerOrdersPlaced || 0),
          legacyDecisionCalls: Number(lastHealth?.decisionRuntime?.legacyDecisionCalls || 0),
        },
      };
      payloadSamples.push(sample);
    }

    const elapsed = Date.now() - tickStart;
    const waitMs = Math.max(0, SAMPLE_INTERVAL_MS - elapsed);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  const endedAtMs = Date.now();
  try { ws?.close(); } catch { /* noop */ }
  return {
    startedAtMs,
    endedAtMs,
    decisionMode,
    readinessState: initialHealth,
    payloadSamples,
  };
}

function flipStats(values: Array<string | null>, durationMs: number): { flips: number; ratePerMinute: number } {
  let flips = 0;
  let prev: string | null = null;
  for (const value of values) {
    const cur = value || null;
    if (prev !== null && cur !== null && cur !== prev) flips += 1;
    prev = cur;
  }
  const ratePerMinute = durationMs > 0 ? flips / (durationMs / 60_000) : 0;
  return {
    flips,
    ratePerMinute: Number(ratePerMinute.toFixed(4)),
  };
}

function mapFramesToSnapshots(frames: FrameRow[], snapshots: PayloadSample[]): MappedRow[] {
  if (frames.length === 0 || snapshots.length === 0) return [];
  return frames.map((frame) => {
    let best: PayloadSample | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const snap of snapshots) {
      const delta = Math.abs(snap.ts_ms - frame.ts_ms);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = snap;
      }
    }
    const toleranceMsUsed = bestDelta <= VIDEO_TOLERANCE_MS ? VIDEO_TOLERANCE_MS : VIDEO_TOLERANCE_FALLBACK_MS;
    if (!best || bestDelta > toleranceMsUsed) {
      return {
        frameIndex: frame.frameIndex,
        frameTsMs: frame.ts_ms,
        snapshotIndex: null,
        snapshotTsMs: null,
        deltaMs: null,
        toleranceMsUsed,
        symbol: null,
        uiTrendText: frame.ui_trend_text,
        uiTrendColor: frame.ui_trend_color,
        orchestratorSide: null,
        orchestratorIntent: null,
        signalDisplaySignal: null,
        aiTrendSide: null,
        aiBiasSide: null,
        gates: null,
      };
    }
    return {
      frameIndex: frame.frameIndex,
      frameTsMs: frame.ts_ms,
      snapshotIndex: best.snapshotIndex,
      snapshotTsMs: best.ts_ms,
      deltaMs: bestDelta,
      toleranceMsUsed,
      symbol: best.symbol,
      uiTrendText: frame.ui_trend_text,
      uiTrendColor: frame.ui_trend_color,
      orchestratorSide: best.orchestrator.side,
      orchestratorIntent: best.orchestrator.intent,
      signalDisplaySignal: best.signalDisplay.signal,
      aiTrendSide: best.aiTrend.side,
      aiBiasSide: best.aiBias.side,
      gates: best.orchestrator.gates,
    };
  });
}

function buildDiagnosis(payloadSamples: PayloadSample[], mappedRows: MappedRow[], durationMs: number): {
  diagnoses: Array<{ code: string; reason: string; evidence: Array<{ frameIndex: number | null; snapshotIndex: number | null }> }>;
  stats: Json;
} {
  const bySymbol = new Map<string, PayloadSample[]>();
  for (const sample of payloadSamples) {
    if (!bySymbol.has(sample.symbol)) bySymbol.set(sample.symbol, []);
    bySymbol.get(sample.symbol)!.push(sample);
  }

  const symbolStats: Json = {};
  let totalAllGatesTrue = 0;
  let totalEntries = 0;
  let totalIntentFlips = 0;
  let totalSideFlips = 0;
  let dataPoints = 0;
  const sideFlipEvidence: Array<{ frameIndex: number | null; snapshotIndex: number | null }> = [];
  const gateFailEvidence: Array<{ frameIndex: number | null; snapshotIndex: number | null }> = [];
  const noisyMetricEvidence: Array<{ frameIndex: number | null; snapshotIndex: number | null }> = [];
  const allGatesTrueEvidence: Array<{ frameIndex: number | null; snapshotIndex: number | null }> = [];

  for (const [symbol, rows] of bySymbol.entries()) {
    const sideSeries = rows.map((r) => normalizeSide(r.orchestrator.side));
    const intentSeries = rows.map((r) => str(r.orchestrator.intent));
    const signalSeries = rows.map((r) => str(r.signalDisplay.signal));
    const sideFlip = flipStats(sideSeries, durationMs);
    const intentFlip = flipStats(intentSeries, durationMs);
    const signalFlip = flipStats(signalSeries, durationMs);
    const allGatesTrue = rows.filter((r) => r.orchestrator.gates.allGatesTrue).length;
    const entryCount = rows.filter((r) => r.orchestrator.intent === 'ENTRY').length;
    totalAllGatesTrue += allGatesTrue;
    totalEntries += entryCount;
    totalIntentFlips += intentFlip.flips;
    totalSideFlips += sideFlip.flips;
    dataPoints += rows.length;

    const deltaZValues = rows.map((r) => r.metrics.deltaZ).filter((v): v is number => v !== null);
    const cvdSlopeValues = rows.map((r) => r.metrics.cvdSlope).filter((v): v is number => v !== null);
    const ppsValues = rows.map((r) => r.metrics.printsPerSecond).filter((v): v is number => v !== null);
    const deltaZStd = stddev(deltaZValues);
    const cvdStd = stddev(cvdSlopeValues);
    const ppsStd = stddev(ppsValues);
    const deltaZMeanAbs = Math.max(1e-9, Math.abs(mean(deltaZValues)));
    const cvdMeanAbs = Math.max(1e-9, Math.abs(mean(cvdSlopeValues)));
    const ppsMeanAbs = Math.max(1e-9, Math.abs(mean(ppsValues)));
    const jitter = {
      deltaZ: Number((deltaZStd / deltaZMeanAbs).toFixed(4)),
      cvdSlope: Number((cvdStd / cvdMeanAbs).toFixed(4)),
      printsPerSecond: Number((ppsStd / ppsMeanAbs).toFixed(4)),
    };

    let prevSide: string | null = null;
    for (const row of rows) {
      const side = normalizeSide(row.orchestrator.side);
      if (prevSide !== null && side !== prevSide) {
        sideFlipEvidence.push({ frameIndex: null, snapshotIndex: row.snapshotIndex });
      }
      prevSide = side;
      if (!row.orchestrator.gates.allGatesTrue) {
        gateFailEvidence.push({ frameIndex: null, snapshotIndex: row.snapshotIndex });
      } else {
        allGatesTrueEvidence.push({ frameIndex: null, snapshotIndex: row.snapshotIndex });
      }
      if (Math.abs(Number(row.metrics.deltaZ || 0)) > 2.5 || Math.abs(Number(row.metrics.cvdSlope || 0)) > 0.05) {
        noisyMetricEvidence.push({ frameIndex: null, snapshotIndex: row.snapshotIndex });
      }
    }

    symbolStats[symbol] = {
      sampleCount: rows.length,
      flips: {
        uiTrend: null,
        orchestratorSide: sideFlip,
        signalDisplay: signalFlip,
        orchestratorIntent: intentFlip,
      },
      allGatesTrueCount: allGatesTrue,
      entryIntentCount: entryCount,
      jitter,
    };
  }

  const first = payloadSamples[0];
  const last = payloadSamples[payloadSamples.length - 1];
  const ordersAttemptedDelta = Math.max(
    0,
    Number(last?.runtimeCounters.orchestratorOrdersAttempted || 0) - Number(first?.runtimeCounters.orchestratorOrdersAttempted || 0)
  );
  const makerOrdersDelta = Math.max(
    0,
    Number(last?.runtimeCounters.makerOrdersPlaced || 0) - Number(first?.runtimeCounters.makerOrdersPlaced || 0)
  );
  const takerOrdersDelta = Math.max(
    0,
    Number(last?.runtimeCounters.takerOrdersPlaced || 0) - Number(first?.runtimeCounters.takerOrdersPlaced || 0)
  );
  const legacyDecisionCallsDelta = Math.max(
    0,
    Number(last?.runtimeCounters.legacyDecisionCalls || 0) - Number(first?.runtimeCounters.legacyDecisionCalls || 0)
  );

  const diagnoses: Array<{ code: string; reason: string; evidence: Array<{ frameIndex: number | null; snapshotIndex: number | null }> }> = [];

  const hasFrameSync = mappedRows.length > 0;
  if (!hasFrameSync) {
    diagnoses.push({
      code: 'UI_LEGACY_FIELD',
      reason: 'Video frame/OCR sync unavailable; UI-vs-orchestrator field correlation cannot be proven from frames.',
      evidence: [{ frameIndex: null, snapshotIndex: null }],
    });
  }

  if (dataPoints > 0) {
    const allGatesTrueRatio = totalAllGatesTrue / dataPoints;
    if (allGatesTrueRatio < 0.1) {
      diagnoses.push({
        code: 'GATES_TOO_STRICT',
        reason: `allGatesTrue ratio is low (${allGatesTrueRatio.toFixed(4)}), setup rarely qualifies.`,
        evidence: gateFailEvidence.slice(0, 5),
      });
    }

    if (totalAllGatesTrue > 0 && totalEntries === 0 && ordersAttemptedDelta > 0) {
      diagnoses.push({
        code: 'COOLDOWN_BLOCK',
        reason: 'Gates pass intermittently but intent remains HOLD while order counters change; cooldown/hold logic likely suppresses entries.',
        evidence: allGatesTrueEvidence.slice(0, 5),
      });
    }

    if (totalAllGatesTrue > 0 && ordersAttemptedDelta === 0) {
      diagnoses.push({
        code: 'EXECUTION_BLOCK',
        reason: 'All gates pass at least once but ordersAttempted delta stayed zero.',
        evidence: allGatesTrueEvidence.slice(0, 5),
      });
    }

    if (totalSideFlips > 8) {
      diagnoses.push({
        code: 'NO_HYSTERESIS',
        reason: `orchestrator side flip count is high (${totalSideFlips}) for sampled duration.`,
        evidence: sideFlipEvidence.slice(0, 5),
      });
    }

    if (noisyMetricEvidence.length > 0) {
      diagnoses.push({
        code: 'METRIC_NOISE',
        reason: 'High-amplitude metric jitter observed around flip windows (deltaZ/cvdSlope).',
        evidence: noisyMetricEvidence.slice(0, 5),
      });
    }
  }

  const stats = {
    sampleCount: payloadSamples.length,
    symbolStats,
    allGatesTrueCount: totalAllGatesTrue,
    entryIntentCount: totalEntries,
    sideFlipCount: totalSideFlips,
    intentFlipCount: totalIntentFlips,
    ordersAttemptedDelta,
    makerOrdersDelta,
    takerOrdersDelta,
    legacyDecisionCallsDelta,
    consecutiveConfirmationsObserved: (() => {
      let maxRun = 0;
      for (const rows of bySymbol.values()) {
        let run = 0;
        for (const row of rows) {
          if (row.orchestrator.gates.allGatesTrue) {
            run += 1;
            if (run > maxRun) maxRun = run;
          } else {
            run = 0;
          }
        }
      }
      return maxRun;
    })(),
  };

  return { diagnoses, stats };
}

function buildPatchSuggestion(diagnoses: string[]): string {
  const lines: string[] = [];
  lines.push('*** Suggested Params Patch (not applied) ***');
  lines.push('*** Update File: server/orchestrator_v1/params.ts');
  if (diagnoses.includes('NO_HYSTERESIS') || diagnoses.includes('COOLDOWN_BLOCK')) {
    lines.push('@@');
    lines.push('-  cooldownMs: 30000,');
    lines.push('+  cooldownMs: 60000,');
    lines.push('+  consecutiveConfirmations: 3,');
    lines.push('+  minHoldMs: 90000,');
  }
  if (diagnoses.includes('METRIC_NOISE')) {
    lines.push('@@');
    lines.push('+  smoothing: {');
    lines.push('+    deltaZEwmaAlpha: 0.30,');
    lines.push('+    cvdSlopeMedianWindow: 3,');
    lines.push('+  },');
  }
  if (diagnoses.includes('GATES_TOO_STRICT')) {
    lines.push('@@');
    lines.push('-  trendinessMin: 0.62,');
    lines.push('-  chopMax: 0.45,');
    lines.push('+  trendinessMin: 0.58,');
    lines.push('+  chopMax: 0.50,');
  }
  lines.push('*** UI Patch Hint ***');
  lines.push('*** Update File: src/components/SymbolRow.tsx');
  lines.push('@@');
  lines.push('- const trendSide = data.signalDisplay.signal;');
  lines.push('+ const trendSide = data.orchestratorV1?.side ?? data.signalDisplay.signal;');
  return `${lines.join('\n')}\n`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const videoPath = resolveVideoPath(VIDEO_PATH_INPUT);
  const videoMeta = readVideoMeta(videoPath);

  const frames: FrameRow[] = [];
  if (videoMeta.exists && videoMeta.frameExtractionEnabled && videoMeta.ocrEnabled) {
    // Placeholder: extraction is intentionally skipped unless explicit dependencies and path are ready.
    videoMeta.blockingReason = 'FRAME_EXTRACTION_NOT_ENABLED_IN_PASSIVE_SCRIPT';
  }

  const payloadCollection = await collectPayloadSeries(DURATION_MS);
  const mapped = mapFramesToSnapshots(frames, payloadCollection.payloadSamples);
  const analysis = buildDiagnosis(payloadCollection.payloadSamples, mapped, payloadCollection.endedAtMs - payloadCollection.startedAtMs);
  const diagnosisCodes = analysis.diagnoses.map((d) => d.code);
  const remPatch = buildPatchSuggestion(diagnosisCodes);

  const framesOut = {
    generatedAt: new Date().toISOString(),
    video: videoMeta,
    note: videoMeta.exists
      ? 'Video exists but frame extraction/OCR not executed in this passive run.'
      : 'Video file could not be found from provided path; frame/OCR evidence unavailable.',
    frames,
  };

  const timeseriesOut = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    decisionMode: payloadCollection.decisionMode,
    captureWindow: {
      startedAtMs: payloadCollection.startedAtMs,
      endedAtMs: payloadCollection.endedAtMs,
      durationMs: payloadCollection.endedAtMs - payloadCollection.startedAtMs,
    },
    readiness: {
      decisionMode: str(payloadCollection.readinessState?.decisionMode),
      decisionEnabled: bool(payloadCollection.readinessState?.decisionEnabled),
      bootstrapRuntime: payloadCollection.readinessState?.bootstrapRuntime || null,
    },
    tolerance: {
      targetMs: VIDEO_TOLERANCE_MS,
      fallbackMs: VIDEO_TOLERANCE_FALLBACK_MS,
      note: 'If video timestamp source is unavailable, mapping uses fallback tolerance.',
    },
    payloadSamples: payloadCollection.payloadSamples,
    mappedRows: mapped,
  };

  const correlationOut = {
    generatedAt: new Date().toISOString(),
    diagnosis: analysis.diagnoses,
    stats: analysis.stats,
    constraints: {
      passiveOnly: true,
      noRestart: true,
      noPostWrite: true,
    },
    references: {
      frameSnapshot: analysis.diagnoses.flatMap((d) => d.evidence).slice(0, 20),
    },
  };

  const summaryLines = [
    `decisionMode=${payloadCollection.decisionMode || 'unknown'}`,
    `videoStatus=${videoMeta.exists ? 'FOUND' : 'MISSING'}`,
    `payloadSamples=${payloadCollection.payloadSamples.length}`,
    `diagnosis=${analysis.diagnoses.map((d) => d.code).join(',') || 'NONE'}`,
    `allGatesTrueCount=${analysis.stats.allGatesTrueCount}`,
    `entryIntentCount=${analysis.stats.entryIntentCount}`,
    `ordersAttemptedDelta=${analysis.stats.ordersAttemptedDelta}`,
    `makerOrdersDelta=${analysis.stats.makerOrdersDelta}`,
    `takerOrdersDelta=${analysis.stats.takerOrdersDelta}`,
    `consecutiveConfirmationsObserved=${analysis.stats.consecutiveConfirmationsObserved}`,
  ];

  fs.writeFileSync(path.join(OUT_DIR, 'live_flip_rootcause_frames.json'), JSON.stringify(framesOut, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'live_flip_payload_timeseries.json'), JSON.stringify(timeseriesOut, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'live_flip_correlation_report.json'), JSON.stringify(correlationOut, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'live_flip_remediations.patch'), remPatch, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'live_flip_summary.txt'), `${summaryLines.join('\n')}\n`, 'utf8');

  process.stdout.write(JSON.stringify({
    ok: true,
    outDir: OUT_DIR,
    files: [
      'live_flip_rootcause_frames.json',
      'live_flip_payload_timeseries.json',
      'live_flip_correlation_report.json',
      'live_flip_remediations.patch',
      'live_flip_summary.txt',
    ],
    summary: summaryLines,
  }, null, 2) + '\n');
}

main().catch((error) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    ok: false,
    error: error instanceof Error ? error.message : 'live_flip_rootcause_audit_failed',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'live_flip_summary.txt'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
});
