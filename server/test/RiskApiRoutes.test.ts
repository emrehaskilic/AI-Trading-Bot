import assert from 'node:assert/strict';
import { Router } from 'express';
import { createRiskRoutes } from '../api/risk';
import { RiskStateManager, RiskStateTrigger } from '../risk/RiskStateManager';

function callRoute(router: Router, path: string): { status: number; body: any } {
  const layer = (router as any).stack.find((item: any) => item?.route?.path === path);
  assert.ok(layer, `route not found: ${path}`);
  const handler = layer.route.stack[0].handle;

  let statusCode = 200;
  let payload: any;
  const req: any = {};
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: any) {
      payload = body;
      return this;
    },
  };

  handler(req, res);
  return { status: statusCode, body: payload };
}

export function runTests(): void {
  let riskStateManager = new RiskStateManager();
  riskStateManager.transition(RiskStateTrigger.DAILY_LOSS_LIMIT_REACHED, 'seed_halted_state');

  let dynamicDailyLossLimit = 500;
  const router = createRiskRoutes({
    getRiskStateManager: () => riskStateManager,
    killSwitchManager: {
      isActive: () => false,
      getLastTrigger: () => null,
    },
    getPositionExposure: () => ({
      totalPositionNotional: 0,
      totalMarginUsed: 0,
      availableMargin: dynamicDailyLossLimit * 10,
      marginUtilizationPercent: 0,
    }),
    getRiskLimits: () => ({
      maxPositionNotional: 10000,
      maxLeverage: 25,
      maxPositionQty: 5,
      dailyLossLimit: dynamicDailyLossLimit,
      reducedRiskPositionMultiplier: 0.5,
    }),
  });

  const haltedSnapshot = callRoute(router, '/snapshot');
  assert.equal(haltedSnapshot.status, 200);
  assert.equal(haltedSnapshot.body.state.current, 'HALTED');
  assert.equal(haltedSnapshot.body.limits.dailyLossLimit, 500);

  riskStateManager = new RiskStateManager();
  dynamicDailyLossLimit = 900;

  const resetSnapshot = callRoute(router, '/snapshot');
  assert.equal(resetSnapshot.status, 200);
  assert.equal(resetSnapshot.body.state.current, 'TRACKING', 'route must use latest risk state manager after reset');
  assert.equal(resetSnapshot.body.state.canTrade, true);
  assert.equal(resetSnapshot.body.limits.dailyLossLimit, 900, 'route must use latest dynamic risk limits');
}
