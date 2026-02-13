import { DryRunSessionService } from '../dryrun';

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const svc = new DryRunSessionService();

  const started = svc.start({
    symbols: ['BTCUSDT', 'ETHUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 200,
    leverage: 10,
    fundingRate: 0,
    debugAggressiveEntry: true,
    heartbeatIntervalMs: 1000,
  });

  assert(started.running === true, 'session must be running after start');
  assert(started.symbols.length === 2, 'session must track 2 symbols');
  assert(started.logTail.some((l) => l.message.includes('Dry Run Initialized with pairs')), 'init log missing');

  const baseBook = {
    bids: [{ price: 100, qty: 10 }, { price: 99, qty: 10 }],
    asks: [{ price: 101, qty: 10 }, { price: 102, qty: 10 }],
  };

  svc.ingestDepthEvent({ symbol: 'BTCUSDT', eventTimestampMs: 1_700_000_000_000, orderBook: baseBook, markPrice: 100.5 });
  svc.ingestDepthEvent({ symbol: 'ETHUSDT', eventTimestampMs: 1_700_000_000_500, orderBook: baseBook, markPrice: 100.2 });

  const status = svc.getStatus();
  assert(status.perSymbol.BTCUSDT?.eventCount > 0, 'BTCUSDT event count should increase');
  assert(status.perSymbol.ETHUSDT?.eventCount > 0, 'ETHUSDT event count should increase');
  assert(status.logTail.some((l) => l.message.includes('Market Data Received: BTCUSDT')), 'market data log missing for BTCUSDT');
  assert(status.logTail.some((l) => l.message.includes('Running... Scanning ETHUSDT')), 'heartbeat log missing for ETHUSDT');

  svc.submitManualTestOrder('BTCUSDT', 'BUY');
  const afterManual = svc.getStatus();
  assert(afterManual.logTail.some((l) => l.message.includes('Manual test order queued')), 'manual order log missing');
}
