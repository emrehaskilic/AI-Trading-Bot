type Timeframe = '1h' | '4h';

interface KlinePoint {
  openTimeMs: number;
  high: number;
  low: number;
  close: number;
}

export interface HtfFrameMetrics {
  barStartMs: number | null;
  close: number | null;
  atr: number | null;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  structureBreakUp: boolean;
  structureBreakDn: boolean;
}

export interface HtfSnapshot {
  h1: HtfFrameMetrics;
  h4: HtfFrameMetrics;
}

interface MonitorConfig {
  intervalMs: number;
  barsLimit: number;
  atrPeriod: number;
  swingLookback: number;
}

const EMPTY_FRAME: HtfFrameMetrics = {
  barStartMs: null,
  close: null,
  atr: null,
  lastSwingHigh: null,
  lastSwingLow: null,
  structureBreakUp: false,
  structureBreakDn: false,
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseKlines(raw: unknown): KlinePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: KlinePoint[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const openTimeMs = Number(row[0]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    if (!Number.isFinite(openTimeMs) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    if (openTimeMs <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
    out.push({ openTimeMs, high, low, close });
  }
  return out;
}

function computeAtr(klines: KlinePoint[], period: number): number | null {
  if (klines.length < 2) return null;
  const trSeries: number[] = [];
  for (let i = 1; i < klines.length; i += 1) {
    const current = klines[i];
    const previousClose = klines[i - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    );
    if (Number.isFinite(tr)) {
      trSeries.push(tr);
    }
  }
  if (trSeries.length === 0) return null;
  const p = clampInt(period, 2, 200);
  const window = trSeries.slice(-p);
  const sum = window.reduce((acc, v) => acc + v, 0);
  return window.length > 0 ? (sum / window.length) : null;
}

function findLastSwingHigh(klines: KlinePoint[], lookback: number): number | null {
  const lb = clampInt(lookback, 1, 10);
  if (klines.length < (lb * 2) + 1) return null;
  for (let i = klines.length - 1 - lb; i >= lb; i -= 1) {
    const center = klines[i].high;
    let ok = true;
    for (let j = 1; j <= lb; j += 1) {
      if (center <= klines[i - j].high || center < klines[i + j].high) {
        ok = false;
        break;
      }
    }
    if (ok) return center;
  }
  return null;
}

function findLastSwingLow(klines: KlinePoint[], lookback: number): number | null {
  const lb = clampInt(lookback, 1, 10);
  if (klines.length < (lb * 2) + 1) return null;
  for (let i = klines.length - 1 - lb; i >= lb; i -= 1) {
    const center = klines[i].low;
    let ok = true;
    for (let j = 1; j <= lb; j += 1) {
      if (center >= klines[i - j].low || center > klines[i + j].low) {
        ok = false;
        break;
      }
    }
    if (ok) return center;
  }
  return null;
}

export function deriveHtfFrameMetricsFromKlines(
  klines: KlinePoint[],
  atrPeriod: number,
  swingLookback: number,
): HtfFrameMetrics {
  const barStartMs = klines.length > 0 ? klines[klines.length - 1].openTimeMs : null;
  const close = klines.length > 0 ? klines[klines.length - 1].close : null;
  const atr = computeAtr(klines, atrPeriod);
  const lastSwingHigh = findLastSwingHigh(klines, swingLookback);
  const lastSwingLow = findLastSwingLow(klines, swingLookback);
  const structureBreakUp = close != null && lastSwingHigh != null ? close > lastSwingHigh : false;
  const structureBreakDn = close != null && lastSwingLow != null ? close < lastSwingLow : false;
  return {
    barStartMs,
    close,
    atr,
    lastSwingHigh,
    lastSwingLow,
    structureBreakUp,
    structureBreakDn,
  };
}

export class HtfStructureMonitor {
  private readonly config: MonitorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private metrics: HtfSnapshot = { h1: { ...EMPTY_FRAME }, h4: { ...EMPTY_FRAME } };

  constructor(
    private readonly symbol: string,
    private readonly restBaseUrl: string = 'https://fapi.binance.com',
  ) {
    this.config = {
      intervalMs: Math.max(5_000, Number(process.env.HTF_REFRESH_MS || 60_000)),
      barsLimit: clampInt(Number(process.env.HTF_BARS_LIMIT || 150), 40, 500),
      atrPeriod: clampInt(Number(process.env.HTF_ATR_PERIOD || 14), 2, 100),
      swingLookback: clampInt(Number(process.env.HTF_SWING_LOOKBACK || 2), 1, 10),
    };
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.fetchAndUpdate();
    }, this.config.intervalMs);
    void this.fetchAndUpdate();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public getSnapshot(): HtfSnapshot {
    return {
      h1: { ...this.metrics.h1 },
      h4: { ...this.metrics.h4 },
    };
  }

  private async fetchAndUpdate(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const [h1, h4] = await Promise.all([
        this.fetchFrame('1h'),
        this.fetchFrame('4h'),
      ]);
      this.metrics = {
        h1: h1 || this.metrics.h1,
        h4: h4 || this.metrics.h4,
      };
    } finally {
      this.inFlight = false;
    }
  }

  private async fetchFrame(tf: Timeframe): Promise<HtfFrameMetrics | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const url = `${this.restBaseUrl}/fapi/v1/klines?symbol=${this.symbol}&interval=${tf}&limit=${this.config.barsLimit}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const raw = await res.json();
      const klines = parseKlines(raw);
      if (klines.length === 0) return null;
      return deriveHtfFrameMetricsFromKlines(klines, this.config.atrPeriod, this.config.swingLookback);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
