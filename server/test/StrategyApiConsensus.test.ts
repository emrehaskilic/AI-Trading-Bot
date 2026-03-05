import assert from 'node:assert/strict';
import { Router } from 'express';
import { createStrategyRoutes } from '../api/strategy';
import { RiskState } from '../risk/RiskStateManager';
import { SignalSide, StrategySignal } from '../strategies/StrategyInterface';

function callRoute(router: Router, path: string, query: Record<string, unknown> = {}): { status: number; body: any } {
  const layer = (router as any).stack.find((item: any) => item?.route?.path === path);
  assert.ok(layer, `route not found: ${path}`);
  const handler = layer.route.stack[0].handle;

  let statusCode = 200;
  let payload: any;
  const req: any = { query };
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
  const now = Date.now();
  const signals: StrategySignal[] = [
    {
      strategyId: 'trend-follow-v1',
      strategyName: 'Trend Follow',
      side: SignalSide.LONG,
      confidence: 0.72,
      timestamp: now - 200,
      validityDurationMs: 5_000,
      metadata: { symbol: 'BTCUSDT' },
    },
    {
      strategyId: 'trend-follow-v1',
      strategyName: 'Trend Follow',
      side: SignalSide.SHORT,
      confidence: 0.34,
      timestamp: now - 50,
      validityDurationMs: 5_000,
      metadata: { symbol: 'BTCUSDT' },
    },
    {
      strategyId: 'mean-revert-v1',
      strategyName: 'Mean Revert',
      side: SignalSide.FLAT,
      confidence: 0.21,
      timestamp: now - 100,
      validityDurationMs: 5_000,
      metadata: { symbol: 'BTCUSDT' },
    },
  ];

  let evaluateCallCount = 0;
  const fallbackConsensus = {
    side: 'LONG' as const,
    confidence: 0.51,
    quorumMet: true,
    vetoApplied: false,
    riskGatePassed: true,
    contributingStrategies: 2,
    totalStrategies: 3,
    breakdown: {
      long: { count: 1, avgConfidence: 0.72 },
      short: { count: 1, avgConfidence: 0.34 },
      flat: { count: 1, avgConfidence: 0.21 },
    },
    strategyIds: ['trend-follow-v1', 'mean-revert-v1'],
  };

  const runtimeConsensus = {
    timestampMs: now,
    side: 'SHORT' as const,
    confidence: 0.66,
    quorumMet: true,
    riskGatePassed: true,
    contributingStrategies: 2,
    totalStrategies: 3,
    vetoApplied: false,
    breakdown: {
      long: { count: 1, avgConfidence: 0.72 },
      short: { count: 1, avgConfidence: 0.34 },
      flat: { count: 1, avgConfidence: 0.21 },
    },
    strategyIds: ['trend-follow-v1', 'mean-revert-v1'],
    shouldTrade: true,
  };

  const routerWithRuntime = createStrategyRoutes({
    consensusEngine: {
      evaluate: () => {
        evaluateCallCount += 1;
        return fallbackConsensus;
      },
      getConfig: () => ({
        minQuorumSize: 2,
        minConfidenceThreshold: 0.3,
        maxSignalAgeMs: 5_000,
        minActionConfidence: 0.5,
        longWeight: 1,
        shortWeight: 1,
      }),
    } as any,
    getCurrentSignals: () => signals,
    getCurrentConsensus: () => runtimeConsensus,
    getCurrentRiskState: () => RiskState.TRACKING,
  });

  const snapshotWithRuntime = callRoute(routerWithRuntime, '/snapshot');
  assert.equal(snapshotWithRuntime.status, 200);
  assert.equal(snapshotWithRuntime.body.consensus.side, 'SHORT', 'runtime consensus should be used when available');
  assert.equal(evaluateCallCount, 0, 'consensusEngine.evaluate should not run when runtime consensus exists');
  assert.equal(snapshotWithRuntime.body.strategyConfidence['trend-follow-v1'].side, 'SHORT');
  assert.equal(snapshotWithRuntime.body.strategyConfidence['trend-follow-v1'].confidence, 0.34);

  let evaluateTimestamp = 0;
  const routerWithoutRuntime = createStrategyRoutes({
    consensusEngine: {
      evaluate: (_signals: StrategySignal[], _riskState: RiskState, timestamp: number) => {
        evaluateTimestamp = timestamp;
        return fallbackConsensus;
      },
      getConfig: () => ({
        minQuorumSize: 2,
        minConfidenceThreshold: 0.3,
        maxSignalAgeMs: 5_000,
        minActionConfidence: 0.5,
        longWeight: 1,
        shortWeight: 1,
      }),
    } as any,
    getCurrentSignals: () => signals,
    getCurrentRiskState: () => RiskState.TRACKING,
  });

  const snapshotWithoutRuntime = callRoute(routerWithoutRuntime, '/snapshot');
  assert.equal(snapshotWithoutRuntime.status, 200);
  const latestSignalTimestamp = Math.max(...signals.map((signal) => signal.timestamp));
  assert.equal(
    evaluateTimestamp,
    latestSignalTimestamp,
    'fallback consensus should evaluate at latest signal timestamp to avoid stale decisions',
  );
}
