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

  const partialEntrySvc = new DryRunSessionService();
  partialEntrySvc.start({
    symbols: ['BTCUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 500,
    leverage: 10,
    fundingRate: 0,
    debugAggressiveEntry: false,
    heartbeatIntervalMs: 1000,
  });

  const partialBook = {
    bids: [{ price: 99, qty: 10 }],
    asks: [{ price: 100, qty: 1 }, { price: 101, qty: 10 }],
  };
  const partialSession = (partialEntrySvc as any).sessions.get('BTCUSDT');
  partialSession.manualOrders.push({
    side: 'BUY',
    type: 'LIMIT',
    qty: 3,
    price: 100,
    timeInForce: 'GTC',
    reduceOnly: false,
    reasonCode: 'STRAT_ENTRY',
  });
  partialEntrySvc.ingestDepthEvent({
    symbol: 'BTCUSDT',
    eventTimestampMs: 1_700_000_001_000,
    orderBook: partialBook,
    markPrice: 100,
  });

  const afterPartialEntry = partialEntrySvc.getStatus();
  assert(afterPartialEntry.perSymbol.BTCUSDT?.openLimitOrders.length === 0, 'stale STRAT_ENTRY remainder must be canceled after first fill');
  assert(afterPartialEntry.perSymbol.BTCUSDT?.position?.qty === 1, 'partial fill should keep only the filled entry size');

  const workingOrderSvc = new DryRunSessionService();
  workingOrderSvc.start({
    symbols: ['BTCUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 500,
    leverage: 10,
    fundingRate: 0,
    debugAggressiveEntry: false,
    heartbeatIntervalMs: 1000,
  });
  const workingSession = (workingOrderSvc as any).sessions.get('BTCUSDT');
  workingSession.manualOrders.push({
    side: 'BUY',
    type: 'LIMIT',
    qty: 1,
    price: 99,
    timeInForce: 'GTC',
    reduceOnly: false,
    reasonCode: 'STRAT_ENTRY',
  });
  workingOrderSvc.ingestDepthEvent({
    symbol: 'BTCUSDT',
    eventTimestampMs: 1_700_000_002_000,
    orderBook: baseBook,
    markPrice: 100.5,
  });
  workingOrderSvc.ingestDepthEvent({
    symbol: 'BTCUSDT',
    eventTimestampMs: 1_700_000_003_000,
    orderBook: baseBook,
    markPrice: 100.5,
  });

  const workingLogs = workingOrderSvc.getStatus().logTail.filter((l) => l.message.includes('Working limit order'));
  assert(workingLogs.length === 1, 'unchanged working limit order must not spam duplicate NEW logs');

  const adaptiveSpreadSvc = new DryRunSessionService();
  adaptiveSpreadSvc.start({
    symbols: ['ETHUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 500,
    leverage: 10,
    fundingRate: 0,
    heartbeatIntervalMs: 1000,
  });
  const adaptiveSession = (adaptiveSpreadSvc as any).sessions.get('ETHUSDT');
  adaptiveSession.startedAtMs = 1;
  adaptiveSession.latestMarkPrice = 2000;
  adaptiveSession.atr = 12;
  adaptiveSpreadSvc.updateRuntimeContext('ETHUSDT', {
    timestampMs: 16 * 60 * 1000,
    bootstrapDone: true,
    bootstrapBars1m: 500,
    htfReady: true,
    tradeStreamActive: true,
    trendConfidence: 0.8,
    spreadPct: 0.0012,
  });
  const adaptiveStatus = adaptiveSpreadSvc.getStatus();
  assert(adaptiveStatus.perSymbol.ETHUSDT?.warmup.tradeReady === true, 'adaptive spread gate should allow trend-trade spreads above the old hard cap');

  const fastEntrySvc = new DryRunSessionService();
  fastEntrySvc.start({
    symbols: ['BTCUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 500,
    leverage: 10,
    fundingRate: 0,
    heartbeatIntervalMs: 1000,
  });
  const fastEntrySession = (fastEntrySvc as any).sessions.get('BTCUSDT');
  const fastBook = {
    bids: [{ price: 100, qty: 10 }, { price: 99.99, qty: 10 }],
    asks: [{ price: 100.01, qty: 10 }, { price: 100.02, qty: 10 }],
  };
  fastEntrySession.lastOrderBook = fastBook;
  fastEntrySession.latestMarkPrice = 100.005;
  let fastEntryOrder = (fastEntrySvc as any).buildAiPostOnlyEntryOrder(fastEntrySession, 'SELL', 1, 'STRAT_ENTRY', true);
  assert(fastEntryOrder?.type === 'LIMIT', 'seed entry should default to fast IOC limit');
  assert(fastEntryOrder?.timeInForce === 'IOC', 'seed entry should not park as GTC when fast-fill is needed');
  assert(fastEntryOrder?.postOnly === false, 'seed entry should ignore strict post-only parking');

  fastEntrySession.aiEntryCancelStreak = 2;
  fastEntryOrder = (fastEntrySvc as any).buildAiPostOnlyEntryOrder(fastEntrySession, 'SELL', 1, 'STRAT_ENTRY', true);
  assert(fastEntryOrder?.type === 'MARKET', 'repeated unfilled seed entries should fall back to market');

  const autonomousPathSvc = new DryRunSessionService();
  autonomousPathSvc.start({
    runId: 'dryrun-plain',
    symbols: ['BTCUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 500,
    leverage: 10,
    fundingRate: 0,
    heartbeatIntervalMs: 1000,
  });
  const autonomousSession = (autonomousPathSvc as any).sessions.get('BTCUSDT');
  autonomousSession.lastOrderBook = fastBook;
  autonomousSession.latestMarkPrice = 100.005;
  autonomousSession.warmup = {
    ...autonomousSession.warmup,
    bootstrapDone: true,
    htfReady: true,
    orderflow1mReady: true,
    orderflow5mReady: true,
    orderflow15mReady: true,
    tradeReady: true,
    addonReady: true,
    vetoReason: null,
  };
  autonomousPathSvc.submitStrategyDecision('BTCUSDT', {
    symbol: 'BTCUSDT',
    timestampMs: 1_700_000_010_000,
    regime: 'TR',
    dfs: 0.8,
    dfsPercentile: 0.8,
    volLevel: 0.5,
    gatePassed: true,
    reasons: ['ENTRY_TR'],
    actions: [{
      type: 'ENTRY',
      side: 'SHORT',
      reason: 'ENTRY_TR',
      expectedPrice: 100,
    }],
    log: {
      timestampMs: 1_700_000_010_000,
      symbol: 'BTCUSDT',
      regime: 'TR',
      gate: { passed: true, reason: null, details: {} },
      dfs: 0.8,
      dfsPercentile: 0.8,
      volLevel: 0.5,
      thresholds: { longEntry: 0.8, longBreak: 0.6, shortEntry: 0.2, shortBreak: 0.4 },
      reasons: ['ENTRY_TR'],
      actions: [{
        type: 'ENTRY',
        side: 'SHORT',
        reason: 'ENTRY_TR',
        expectedPrice: 100,
      }],
      stats: {},
    },
  } as any, 1_700_000_010_000);
  const autonomousOrder = autonomousSession.manualOrders.find((o: any) => o.reasonCode === 'STRAT_ENTRY');
  assert(autonomousOrder?.timeInForce === 'IOC', 'plain dry-run runIds must still use fast autonomous seed entry routing');
  assert(autonomousOrder?.postOnly === false, 'plain dry-run runIds must not fall back to passive maker entry routing');

  const reduceCooldownSvc = new DryRunSessionService();
  reduceCooldownSvc.start({
    symbols: ['BTCUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 500,
    leverage: 10,
    fundingRate: 0,
    heartbeatIntervalMs: 1000,
  });
  const reduceSession = (reduceCooldownSvc as any).sessions.get('BTCUSDT');
  reduceSession.latestMarkPrice = 100;
  reduceSession.lastOrderBook = baseBook;
  reduceSession.lastEntryOrAddOnTs = 1_700_000_000_000 - 300_000;
  reduceSession.lastState = {
    ...reduceSession.lastState,
    walletBalance: 5000,
    position: {
      side: 'LONG',
      qty: 10,
      entryPrice: 100,
      entryTimestampMs: 1_700_000_000_000 - 300_000,
    },
    openLimitOrders: [],
    marginHealth: 1,
  };
  const reduceDecision = {
    symbol: 'BTCUSDT',
    timestampMs: 1_700_000_000_000,
    regime: 'TR' as const,
    dfs: 0.7,
    dfsPercentile: 0.7,
    volLevel: 0.5,
    gatePassed: true,
    reasons: ['REDUCE_SOFT' as const],
    actions: [{
      type: 'REDUCE' as const,
      side: 'LONG' as const,
      reason: 'REDUCE_SOFT' as const,
      reducePct: 0.3,
      expectedPrice: 100,
    }],
    log: {
      timestampMs: 1_700_000_000_000,
      symbol: 'BTCUSDT',
      regime: 'TR' as const,
      gate: { passed: true, reason: null, details: {} },
      dfs: 0.7,
      dfsPercentile: 0.7,
      volLevel: 0.5,
      thresholds: { longEntry: 0.8, longBreak: 0.6, shortEntry: 0.2, shortBreak: 0.4 },
      reasons: ['REDUCE_SOFT' as const],
      actions: [{
        type: 'REDUCE' as const,
        side: 'LONG' as const,
        reason: 'REDUCE_SOFT' as const,
        reducePct: 0.3,
        expectedPrice: 100,
      }],
      stats: {},
    },
  };
  const firstReduce = reduceCooldownSvc.submitStrategyDecision('BTCUSDT', reduceDecision, 1_700_000_000_000);
  const secondReduce = reduceCooldownSvc.submitStrategyDecision('BTCUSDT', reduceDecision, 1_700_000_001_000);
  assert(firstReduce.length === 1, 'first soft reduce should queue once');
  assert(secondReduce.length === 0, 'rapid repeated soft reduces must be blocked by cooldown');

  const peakTrackingSvc = new DryRunSessionService();
  peakTrackingSvc.start({
    symbols: ['BTCUSDT'],
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 500,
    leverage: 10,
    fundingRate: 0,
    heartbeatIntervalMs: 1000,
  });
  const peakSession = (peakTrackingSvc as any).sessions.get('BTCUSDT');
  peakSession.manualOrders.push({
    side: 'BUY',
    type: 'MARKET',
    qty: 1,
    timeInForce: 'IOC',
    reduceOnly: false,
    reasonCode: 'MANUAL_TEST',
  });
  peakTrackingSvc.ingestDepthEvent({
    symbol: 'BTCUSDT',
    eventTimestampMs: 1_700_000_004_000,
    orderBook: {
      bids: [{ price: 99.9, qty: 10 }],
      asks: [{ price: 100, qty: 10 }],
    },
    markPrice: 100,
  });
  peakTrackingSvc.ingestDepthEvent({
    symbol: 'BTCUSDT',
    eventTimestampMs: 1_700_000_005_000,
    orderBook: {
      bids: [{ price: 100.95, qty: 10 }],
      asks: [{ price: 101, qty: 10 }],
    },
    markPrice: 101,
  });
  const peakPosition = peakTrackingSvc.getStrategyPosition('BTCUSDT');
  assert((peakPosition?.peakPnlPct || 0) >= 0.009, 'strategy position should retain peak pnl after favorable move');
  peakTrackingSvc.ingestDepthEvent({
    symbol: 'BTCUSDT',
    eventTimestampMs: 1_700_000_006_000,
    orderBook: {
      bids: [{ price: 100.35, qty: 10 }],
      asks: [{ price: 100.4, qty: 10 }],
    },
    markPrice: 100.4,
  });
  const retainedPeakPosition = peakTrackingSvc.getStrategyPosition('BTCUSDT');
  assert(
    (retainedPeakPosition?.peakPnlPct || 0) >= (retainedPeakPosition?.unrealizedPnlPct || 0),
    'peak pnl should survive mild pullbacks so strategy trailing logic can use it'
  );

  partialEntrySvc.stop();
  workingOrderSvc.stop();
  adaptiveSpreadSvc.stop();
  fastEntrySvc.stop();
  autonomousPathSvc.stop();
  reduceCooldownSvc.stop();
  peakTrackingSvc.stop();
  const stopped = svc.stop();
  assert(stopped.running === false, 'session must stop cleanly');
}
