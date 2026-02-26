import { BackfillCoordinator } from '../backfill/BackfillCoordinator';
import { KlineBackfill } from '../backfill/KlineBackfill';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function buildKlines(count: number): any[] {
  const start = Date.UTC(2026, 1, 26, 10, 0, 0, 0);
  const rows: any[] = [];
  let price = 68000;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const high = open + 12;
    const low = open - 8;
    const close = open + (i % 2 === 0 ? 4 : -3);
    const volume = 10 + i;
    const openTime = start + (i * 60_000);
    const closeTime = openTime + 59_999;
    rows.push([
      openTime,
      String(open),
      String(high),
      String(low),
      String(close),
      String(volume),
      closeTime,
      '0',
      0,
      '0',
      '0',
      '0',
    ]);
    price = close;
  }
  return rows;
}

export async function runTests(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  const payload = buildKlines(120);
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const coordinator = new BackfillCoordinator('https://fapi.binance.com', 500, 30_000);

    await Promise.all([
      coordinator.ensure('BTCUSDT'),
      coordinator.ensure('BTCUSDT'),
      coordinator.ensure('BTCUSDT'),
    ]);

    const state = coordinator.getState('BTCUSDT');
    assert(fetchCalls === 1, `expected single fetch, got ${fetchCalls}`);
    assert(state.fetchCount === 1, `expected fetchCount=1, got ${state.fetchCount}`);
    assert(state.done === true, 'backfill should be done');
    assert(state.inProgress === false, 'inProgress should be false after completion');
    assert(state.barsLoaded1m === payload.length, `barsLoaded1m mismatch ${state.barsLoaded1m}`);
    assert(state.startedAtMs != null, 'startedAtMs missing');
    assert(state.doneAtMs != null, 'doneAtMs missing');
    assert((state.doneAtMs || 0) >= (state.startedAtMs || 0), 'doneAtMs should be >= startedAtMs');

    const klines = coordinator.getKlines('BTCUSDT');
    assert(Array.isArray(klines) && klines.length === payload.length, 'klines should be cached by coordinator');

    const backfill = new KlineBackfill('BTCUSDT');
    backfill.updateFromKlines(klines || []);
    const backfillState = backfill.getState();
    assert(backfillState.ready, 'KlineBackfill must be ready from coordinator klines');
    assert(backfillState.atr > 0, 'KlineBackfill atr must be positive');
    assert(backfillState.recentHigh > backfillState.recentLow, 'recentHigh should be > recentLow');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

