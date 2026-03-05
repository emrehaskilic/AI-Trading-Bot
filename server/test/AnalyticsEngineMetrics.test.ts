import assert from 'node:assert/strict';
import { AnalyticsEngine } from '../analytics/AnalyticsEngine';

function approx(actual: number, expected: number, tolerance: number = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

export function runTests(): void {
  const engine = new AnalyticsEngine({
    persistToDisk: false,
    snapshotIntervalMs: 60_000,
  });

  const t0 = Date.now();

  engine.recordExpectedFill('o1', 'BTCUSDT', 100, 'BUY', 1);
  engine.ingestFill({
    type: 'FILL',
    symbol: 'BTCUSDT',
    side: 'BUY',
    qty: 1,
    price: 101,
    fee: 0.1,
    feeType: 'taker',
    timestamp: t0,
    orderId: 'o1',
    tradeId: 't1',
    isReduceOnly: false,
  });
  engine.ingestPosition({
    type: 'POSITION_UPDATE',
    symbol: 'BTCUSDT',
    side: 'LONG',
    qty: 1,
    entryPrice: 101,
    markPrice: 110,
    unrealizedPnl: 9,
    timestamp: t0 + 200,
  });

  engine.recordExpectedFill('o2', 'BTCUSDT', 109, 'SELL', 1);
  engine.ingestFill({
    type: 'FILL',
    symbol: 'BTCUSDT',
    side: 'SELL',
    qty: 1,
    price: 108,
    fee: 0.1,
    feeType: 'taker',
    timestamp: t0 + 1_000,
    orderId: 'o2',
    tradeId: 't2',
    isReduceOnly: true,
  });
  engine.ingestPosition({
    type: 'POSITION_UPDATE',
    symbol: 'BTCUSDT',
    side: 'FLAT',
    qty: 0,
    entryPrice: 0,
    markPrice: 108,
    unrealizedPnl: 0,
    timestamp: t0 + 1_200,
  });

  engine.recordExpectedFill('o3', 'ETHUSDT', 200, 'BUY', 2);
  engine.ingestFill({
    type: 'FILL',
    symbol: 'ETHUSDT',
    side: 'BUY',
    qty: 2,
    price: 200,
    fee: 0.2,
    feeType: 'maker',
    timestamp: t0 + 2_000,
    orderId: 'o3',
    tradeId: 't3',
    isReduceOnly: false,
  });
  engine.ingestPosition({
    type: 'POSITION_UPDATE',
    symbol: 'ETHUSDT',
    side: 'LONG',
    qty: 2,
    entryPrice: 200,
    markPrice: 210,
    unrealizedPnl: 20,
    timestamp: t0 + 2_200,
  });
  engine.ingestPosition({
    type: 'POSITION_UPDATE',
    symbol: 'ETHUSDT',
    side: 'LONG',
    qty: 2,
    entryPrice: 200,
    markPrice: 205,
    unrealizedPnl: 10,
    timestamp: t0 + 3_200,
  });

  const snapshot = engine.getSnapshot();

  assert.equal(snapshot.summary.totalTrades, 1, 'closed trades should count correctly');
  assert.equal(snapshot.summary.openPositions, 1, 'open positions should be exposed');
  assert.equal(snapshot.summary.winningTrades, 1);
  assert.equal(snapshot.summary.losingTrades, 0);
  approx(snapshot.summary.totalRealizedPnl, 7);
  approx(snapshot.summary.unrealizedPnl, 10);
  approx(snapshot.summary.totalFees, 0.4);
  approx(snapshot.summary.netPnl, 16.6, 1e-9);
  approx(snapshot.summary.avgTradePnl, 6.8, 1e-9);

  assert.ok(snapshot.execution.slippageSamples >= 3, 'slippage samples should be recorded');
  assert.ok(snapshot.execution.slippageMaxBps >= snapshot.execution.avgSlippageBps);

  assert.ok(snapshot.drawdown.maxDrawdown > 0, 'drawdown should reflect equity pullback');
  assert.ok(snapshot.drawdown.maxDrawdownPercent >= 0);
  assert.ok(snapshot.drawdown.maxDrawdownPercent <= 100, 'drawdown percent must be clamped to 0..100');
  assert.ok(Number.isFinite(snapshot.drawdown.maxDrawdownPercent), 'drawdown percent must be finite');

  assert.ok(Number.isFinite(snapshot.performance.sharpeRatio));
  assert.ok(Number.isFinite(snapshot.performance.sortinoRatio));
  assert.ok(Number.isFinite(snapshot.performance.expectancy));

  assert.equal(snapshot.bySymbol.BTCUSDT.trades, 1);
  assert.equal(snapshot.bySymbol.BTCUSDT.openPosition, false);
  approx(snapshot.bySymbol.BTCUSDT.realizedPnl, 7);

  assert.equal(snapshot.bySymbol.ETHUSDT.openPosition, true);
  approx(snapshot.bySymbol.ETHUSDT.unrealizedPnl, 10);
  assert.equal(snapshot.positions.length, 1, 'open positions list should include active symbols');
  assert.equal(snapshot.positions[0].symbol, 'ETHUSDT');
}
