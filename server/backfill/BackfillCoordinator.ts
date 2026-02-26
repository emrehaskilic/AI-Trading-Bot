import { KlineData } from './KlineBackfill';

export interface BootstrapBackfillState {
  inProgress: boolean;
  done: boolean;
  barsLoaded1m: number;
  startedAtMs: number | null;
  doneAtMs: number | null;
  fetchCount: number;
  lastAttemptMs: number | null;
  lastError: string | null;
}

const EMPTY_STATE: BootstrapBackfillState = {
  inProgress: false,
  done: false,
  barsLoaded1m: 0,
  startedAtMs: null,
  doneAtMs: null,
  fetchCount: 0,
  lastAttemptMs: null,
  lastError: null,
};

function cloneState(state: BootstrapBackfillState): BootstrapBackfillState {
  return { ...state };
}

function toFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseKlineRows(data: unknown): KlineData[] {
  if (!Array.isArray(data)) return [];
  const out: KlineData[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const timestamp = toFinite(row[0]);
    const open = toFinite(row[1]);
    const high = toFinite(row[2]);
    const low = toFinite(row[3]);
    const close = toFinite(row[4]);
    const volume = toFinite(row[5]);
    if (
      timestamp == null
      || open == null
      || high == null
      || low == null
      || close == null
      || volume == null
    ) {
      continue;
    }
    out.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return out;
}

export class BackfillCoordinator {
  private readonly states = new Map<string, BootstrapBackfillState>();
  private readonly klinesBySymbol = new Map<string, KlineData[]>();
  private readonly inflight = new Map<string, Promise<void>>();
  private totalFetches = 0;

  constructor(
    private readonly restBaseUrl: string,
    private readonly limit1m: number,
    private readonly retryIntervalMs = 30_000,
    private readonly log?: (event: string, data?: Record<string, unknown>) => void
  ) {}

  public getLimit1m(): number {
    return this.limit1m;
  }

  public getTotalFetches(): number {
    return this.totalFetches;
  }

  public getState(symbolRaw: string): BootstrapBackfillState {
    const symbol = String(symbolRaw || '').toUpperCase();
    const state = this.states.get(symbol) || EMPTY_STATE;
    return cloneState(state);
  }

  public getStates(): Record<string, BootstrapBackfillState> {
    const out: Record<string, BootstrapBackfillState> = {};
    for (const [symbol, state] of this.states.entries()) {
      out[symbol] = cloneState(state);
    }
    return out;
  }

  public getKlines(symbolRaw: string): KlineData[] | null {
    const symbol = String(symbolRaw || '').toUpperCase();
    const rows = this.klinesBySymbol.get(symbol);
    return rows && rows.length > 0 ? rows.slice() : null;
  }

  public async ensure(symbolRaw: string): Promise<void> {
    const symbol = String(symbolRaw || '').toUpperCase();
    if (!symbol) return;
    const existing = this.inflight.get(symbol);
    if (existing) {
      await existing;
      return;
    }

    const state = this.getOrCreate(symbol);
    const now = Date.now();
    const canRetry =
      state.lastAttemptMs == null
      || (now - state.lastAttemptMs) >= this.retryIntervalMs;
    if (state.done || state.inProgress || !canRetry) return;

    const task = this.fetchAndStore(symbol);
    this.inflight.set(symbol, task);
    try {
      await task;
    } finally {
      this.inflight.delete(symbol);
    }
  }

  private getOrCreate(symbol: string): BootstrapBackfillState {
    const current = this.states.get(symbol);
    if (current) return current;
    const next = cloneState(EMPTY_STATE);
    this.states.set(symbol, next);
    return next;
  }

  private async fetchAndStore(symbol: string): Promise<void> {
    const state = this.getOrCreate(symbol);
    const now = Date.now();
    state.inProgress = true;
    state.lastAttemptMs = now;
    state.lastError = null;
    if (state.startedAtMs == null) state.startedAtMs = now;
    state.fetchCount += 1;
    this.totalFetches += 1;
    this.log?.('BOOTSTRAP_1M_FETCH_START', {
      symbol,
      limit: this.limit1m,
      fetchCount: state.fetchCount,
    });

    try {
      const url = `${this.restBaseUrl}/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${this.limit1m}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`status_${res.status}`);
      }
      const data = await res.json();
      const klines = parseKlineRows(data);
      this.klinesBySymbol.set(symbol, klines);
      state.barsLoaded1m = klines.length;
      state.done = klines.length > 0;
      state.doneAtMs = Date.now();
      if (!state.done) {
        state.lastError = 'NO_KLINES';
      }
      this.log?.('BOOTSTRAP_1M_FETCH_DONE', {
        symbol,
        barsLoaded1m: state.barsLoaded1m,
        fetchCount: state.fetchCount,
        done: state.done,
      });
    } catch (error: any) {
      state.done = false;
      state.lastError = error?.message || 'bootstrap_fetch_failed';
      this.log?.('BOOTSTRAP_1M_FETCH_ERROR', {
        symbol,
        fetchCount: state.fetchCount,
        error: state.lastError,
      });
    } finally {
      state.inProgress = false;
      this.states.set(symbol, state);
    }
  }
}

