import assert from 'node:assert/strict';
import { Router } from 'express';
import { createAnalyticsRoutes } from '../api/analytics';
import { AnalyticsEngine } from '../analytics/AnalyticsEngine';

function callRoute(router: Router, path: string): { status: number; body: any } {
  const layer = (router as any).stack.find((item: any) => item?.route?.path === path);
  assert.ok(layer, `route not found: ${path}`);
  const handler = layer.route.stack[0].handle;

  let statusCode = 200;
  let payload: any;
  const req: any = { query: {} };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: any) {
      payload = body;
      return this;
    },
    setHeader: () => undefined,
  };

  handler(req, res);
  return { status: statusCode, body: payload };
}

export function runTests(): void {
  const analyticsEngine = new AnalyticsEngine({ persistToDisk: false });

  const dryRunStatus = {
    config: {
      walletBalanceStartUsdt: 5000,
    },
    summary: {
      realizedPnl: 12.5,
      feePaid: 1.5,
      unrealizedPnl: 3.25,
      performance: {
        totalTrades: 4,
        winCount: 3,
        lossCount: 1,
        winRate: 75,
        maxDrawdown: 8,
        sharpeRatio: 1.4,
      },
    },
    perSymbol: {
      BTCUSDT: {
        metrics: {
          markPrice: 72000,
          realizedPnl: 12.5,
          feePaid: 1.5,
          unrealizedPnl: 3.25,
        },
        performance: {
          totalTrades: 4,
        },
        position: {
          side: 'LONG',
          qty: 0.01,
          entryPrice: 71900,
        },
      },
    },
  };

  const router = createAnalyticsRoutes({
    analyticsEngine,
    getDryRunStatus: () => dryRunStatus,
  });

  const response = callRoute(router, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.trades.totalTrades, 4, 'should use dry-run fallback when analytics engine has no trades yet');
  assert.equal(response.body.trades.openPositions, 1);
  assert.equal(response.body.pnl.totalRealizedPnl, 12.5);
  assert.equal(response.body.pnl.totalFees, 1.5);
  assert.equal(response.body.pnl.unrealizedPnl, 3.25);
  assert.equal(response.body.positions.length, 1);
  assert.equal(response.body.bySymbol.BTCUSDT.openPosition, true);
}
