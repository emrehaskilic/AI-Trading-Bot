export type SessionName = 'asia' | 'london' | 'ny';

export interface SessionVwapSnapshot {
  name: SessionName;
  sessionStartMs: number;
  elapsedMs: number;
  value: number | null;
  priceDistanceBps: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  sessionRangePct: number | null;
}

interface SessionWindow {
  name: SessionName;
  startHourUtc: number;
}

interface SessionState {
  name: SessionName;
  sessionStartMs: number;
  volume: number;
  notional: number;
  high: number | null;
  low: number | null;
}

const DEFAULT_WINDOWS: SessionWindow[] = [
  { name: 'asia', startHourUtc: 0 },
  { name: 'london', startHourUtc: 8 },
  { name: 'ny', startHourUtc: 16 },
];

function parseStartHour(raw: string | undefined, fallback: number): number {
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
    return fallback;
  }
  return parsed;
}

function buildWindowsFromEnv(): SessionWindow[] {
  const configured: SessionWindow[] = [
    {
      name: 'asia',
      startHourUtc: parseStartHour(process.env.SESSION_ASIA_START_UTC_HOUR, DEFAULT_WINDOWS[0].startHourUtc),
    },
    {
      name: 'london',
      startHourUtc: parseStartHour(process.env.SESSION_LONDON_START_UTC_HOUR, DEFAULT_WINDOWS[1].startHourUtc),
    },
    {
      name: 'ny',
      startHourUtc: parseStartHour(process.env.SESSION_NY_START_UTC_HOUR, DEFAULT_WINDOWS[2].startHourUtc),
    },
  ];
  return configured.sort((a, b) => a.startHourUtc - b.startHourUtc);
}

function resolveSession(timestampMs: number, windows: SessionWindow[]): { name: SessionName; sessionStartMs: number } {
  const ts = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const dayStartMs = Date.UTC(year, month, day, 0, 0, 0, 0);
  const minutesOfDay = (d.getUTCHours() * 60) + d.getUTCMinutes();

  let selected: SessionWindow | null = null;
  for (let i = windows.length - 1; i >= 0; i -= 1) {
    const candidate = windows[i];
    if (minutesOfDay >= candidate.startHourUtc * 60) {
      selected = candidate;
      break;
    }
  }

  if (selected) {
    return {
      name: selected.name,
      sessionStartMs: dayStartMs + (selected.startHourUtc * 60 * 60 * 1000),
    };
  }

  const prev = windows[windows.length - 1];
  return {
    name: prev.name,
    sessionStartMs: (dayStartMs - (24 * 60 * 60 * 1000)) + (prev.startHourUtc * 60 * 60 * 1000),
  };
}

export class SessionVwapTracker {
  private readonly windows: SessionWindow[];
  private state: SessionState | null = null;

  constructor() {
    this.windows = buildWindowsFromEnv();
  }

  public update(tradeTimestampMs: number, price: number, quantity: number): void {
    this.rollSessionIfNeeded(tradeTimestampMs);
    if (!this.state) return;
    const px = Number(price);
    const qty = Number(quantity);
    if (!Number.isFinite(px) || !Number.isFinite(qty) || px <= 0 || qty <= 0) return;

    this.state.notional += px * qty;
    this.state.volume += qty;
    this.state.high = this.state.high == null ? px : Math.max(this.state.high, px);
    this.state.low = this.state.low == null ? px : Math.min(this.state.low, px);
  }

  public snapshot(nowMs: number, referencePrice: number | null | undefined): SessionVwapSnapshot {
    this.rollSessionIfNeeded(nowMs);
    if (!this.state) {
      const fallback = resolveSession(nowMs, this.windows);
      return {
        name: fallback.name,
        sessionStartMs: fallback.sessionStartMs,
        elapsedMs: Math.max(0, nowMs - fallback.sessionStartMs),
        value: null,
        priceDistanceBps: null,
        sessionHigh: null,
        sessionLow: null,
        sessionRangePct: null,
      };
    }

    const value = this.state.volume > 0 ? this.state.notional / this.state.volume : null;
    const ref = Number(referencePrice);
    const canCalcDistance = value != null && value > 0 && Number.isFinite(ref) && ref > 0;
    const priceDistanceBps = canCalcDistance ? ((ref - value) / value) * 10_000 : null;
    const canCalcRange = this.state.high != null && this.state.low != null && this.state.low > 0;
    const sessionRangePct = canCalcRange
      ? ((this.state.high! - this.state.low!) / this.state.low!) * 100
      : null;

    return {
      name: this.state.name,
      sessionStartMs: this.state.sessionStartMs,
      elapsedMs: Math.max(0, nowMs - this.state.sessionStartMs),
      value,
      priceDistanceBps,
      sessionHigh: this.state.high,
      sessionLow: this.state.low,
      sessionRangePct,
    };
  }

  private rollSessionIfNeeded(timestampMs: number): void {
    const next = resolveSession(timestampMs, this.windows);
    if (this.state && this.state.sessionStartMs === next.sessionStartMs && this.state.name === next.name) {
      return;
    }
    this.state = {
      name: next.name,
      sessionStartMs: next.sessionStartMs,
      volume: 0,
      notional: 0,
      high: null,
      low: null,
    };
  }
}
