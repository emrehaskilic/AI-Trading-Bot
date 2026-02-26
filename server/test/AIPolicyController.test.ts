import { AIDryRunController } from '../ai/AIDryRunController';
import { StateExtractor } from '../ai/StateExtractor';
import { buildAIMetricsSnapshot } from './helpers/aiSnapshot';
import { StrategyDecision } from '../types/strategy';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export async function runTests() {
  const decisions: StrategyDecision[] = [];
  const dryRunSession = {
    submitStrategyDecision: (_symbol: string, decision: StrategyDecision) => {
      decisions.push(decision);
      return [];
    },
    getSymbolRealizedPnl: () => 0,
  } as any;

  const controller = new AIDryRunController(dryRunSession);
  controller.start({
    symbols: ['BTCUSDT'],
    localOnly: false,
    decisionIntervalMs: 100,
    temperature: 0,
    maxOutputTokens: 64,
  });

  const snapshot = buildAIMetricsSnapshot({
    symbol: 'BTCUSDT',
    timestampMs: Date.now(),
    market: { deltaZ: 2.4, cvdSlope: 70_000, obiDeep: 0.55, spreadPct: 0.0005 },
    openInterest: { oiChangePct: 0.5 },
    volatility: 105,
  });

  await controller.onMetrics(snapshot);

  assert(decisions.length > 0, 'controller should emit a decision');
  const latest = decisions[decisions.length - 1];
  assert(latest.actions.length > 0, 'decision should contain actions');
  assert(latest.actions[0].type === 'NOOP', 'llm unavailable must resolve to HOLD/NOOP');
  controller.stop();

  {
    const controllerAny = new AIDryRunController(dryRunSession) as any;
    const extractor = new StateExtractor(10);
    const crashSnapshot = buildAIMetricsSnapshot({
      symbol: 'ETHUSDT',
      market: { cvdSlope: 5_000, deltaZ: 0.2 },
      openInterest: { oiChangePct: 0.3 },
      volatility: 110,
    });
    const baseState = extractor.extract(crashSnapshot);
    const crashState = {
      ...baseState,
      directionalBias: 'LONG',
      oiDirection: 'UP',
      flowState: 'EXHAUSTION',
      executionState: 'HEALTHY',
      toxicityState: 'AGGRESSIVE',
      volatilityPercentile: 40,
    };

    const softSignal = controllerAny.isCrashExitSignal(
      'SHORT',
      crashState,
      crashSnapshot,
      { lastCvdSlope: 1_000 },
      80
    );
    assert(softSignal === false, 'soft crash exit should be disabled by default');

    const hardSignal = controllerAny.isCrashExitSignal(
      'SHORT',
      { ...crashState, executionState: 'LOW_RESILIENCY' },
      crashSnapshot,
      { lastCvdSlope: 1_000 },
      80
    );
    assert(hardSignal === true, 'hard crash risk should still trigger exit signal');
  }

  {
    const controllerAny = new AIDryRunController(dryRunSession) as any;
    const extractor = new StateExtractor(10);
    const dcaSnapshot = buildAIMetricsSnapshot({
      symbol: 'XRPUSDT',
      decision: { dfsPercentile: 0.2 },
      market: {
        delta1s: -6_500,
        delta5s: -8_500,
        deltaZ: -2.1,
        cvdSlope: -55_000,
        obiDeep: -0.22,
      },
      openInterest: { oiChangePct: -0.25 },
      regimeMetrics: { trendinessScore: 0.9, chopScore: 0.08 },
      position: {
        side: 'SHORT',
        qty: 0.2,
        entryPrice: 60_000,
        unrealizedPnlPct: -0.01,
        addsUsed: 0,
        timeInPositionMs: 180_000,
      },
    });
    extractor.extract(dcaSnapshot);
    const dcaState = extractor.extract(dcaSnapshot);
    const dcaAllowed = controllerAny.shouldForceLoserDca(
      'SHORT',
      dcaState,
      dcaSnapshot,
      { dcaCount: 0, lastDcaBarId: -1, lastCvdSlope: -45_000 },
      { intent: 'HOLD', reasons: [], maxExposureNotional: 20_000 },
      100,
      20
    );
    assert(dcaAllowed === true, 'losing position should force DCA when trend remains aligned');

    const reversalSnapshot = buildAIMetricsSnapshot({
      symbol: 'ETHUSDT',
      decision: { dfsPercentile: 0.9 },
      market: {
        delta1s: 8_000,
        delta5s: 10_000,
        deltaZ: 2.3,
        cvdSlope: 65_000,
        obiDeep: 0.25,
      },
      openInterest: { oiChangePct: 0.3 },
      regimeMetrics: { trendinessScore: 0.92, chopScore: 0.05 },
      position: {
        side: 'SHORT',
        qty: 0.2,
        entryPrice: 2_000,
        unrealizedPnlPct: -0.02,
        addsUsed: 1,
        timeInPositionMs: 240_000,
      },
    });
    extractor.extract(reversalSnapshot);
    const reversalState = extractor.extract(reversalSnapshot);
    const reversalConfirmed = controllerAny.isTrendReversalConfirmed(
      'SHORT',
      reversalState,
      reversalSnapshot,
      { lastCvdSlope: 30_000, trendSide: 'LONG', trendStartBarId: 95, lastBarId: 100 },
      90
    );
    assert(reversalConfirmed === true, 'confirmed opposite trend should force reversal exit');

    const weakFlowReversal = controllerAny.isTrendReversalConfirmed(
      'SHORT',
      { ...reversalState, flowState: 'EXHAUSTION' },
      reversalSnapshot,
      { lastCvdSlope: 30_000, trendSide: 'LONG', trendStartBarId: 95, lastBarId: 100 },
      90
    );
    assert(weakFlowReversal === false, 'exhaustion-only opposite bias should not force reversal exit');
  }
}
