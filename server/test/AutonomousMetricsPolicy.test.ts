import { AIDryRunController } from '../ai/AIDryRunController';
import { AIDecisionPlan, AIMetricsSnapshot } from '../ai/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

type SnapshotOverrides = Partial<
  Omit<AIMetricsSnapshot, 'decision' | 'riskState' | 'executionState' | 'market' | 'trades' | 'openInterest' | 'absorption' | 'position'>
> & {
  decision?: Partial<AIMetricsSnapshot['decision']>;
  riskState?: Partial<AIMetricsSnapshot['riskState']>;
  executionState?: Partial<AIMetricsSnapshot['executionState']>;
  market?: Partial<AIMetricsSnapshot['market']>;
  trades?: Partial<AIMetricsSnapshot['trades']>;
  openInterest?: Partial<AIMetricsSnapshot['openInterest']>;
  absorption?: Partial<AIMetricsSnapshot['absorption']>;
  position?: AIMetricsSnapshot['position'];
};

function buildSnapshot(overrides?: SnapshotOverrides): AIMetricsSnapshot {
  const base: AIMetricsSnapshot = {
    symbol: 'BTCUSDT',
    timestampMs: Date.now(),
    decision: {
      regime: 'TR',
      dfs: 0.2,
      dfsPercentile: 0.6,
      volLevel: 0.5,
      gatePassed: true,
      thresholds: {
        longEntry: 0.85,
        longBreak: 0.55,
        shortEntry: 0.15,
        shortBreak: 0.45,
      },
    },
    blockedReasons: [],
    riskState: {
      equity: 10_000,
      leverage: 10,
      startingMarginUser: 250,
      marginInUse: 900,
      drawdownPct: -0.01,
      dailyLossLock: false,
      cooldownMsRemaining: 0,
    },
    executionState: {
      lastAction: 'NONE',
      holdStreak: 0,
      lastAddMsAgo: null,
      lastFlipMsAgo: null,
    },
    market: {
      price: 60_000,
      vwap: 59_950,
      spreadPct: 0.04,
      delta1s: 20,
      delta5s: 60,
      deltaZ: 1.8,
      cvdSlope: 25_000,
      obiWeighted: 0.5,
      obiDeep: 0.45,
      obiDivergence: 0.2,
    },
    trades: {
      printsPerSecond: 7,
      tradeCount: 25,
      aggressiveBuyVolume: 180,
      aggressiveSellVolume: 95,
      burstCount: 4,
      burstSide: 'buy',
    },
    liquidityMetrics: {
      microPrice: 60000,
      imbalanceCurve: {
        level1: 0.55,
        level5: 0.54,
        level10: 0.53,
        level20: 0.52,
        level50: 0.51,
      },
      bookSlopeBid: 1,
      bookSlopeAsk: 1,
      bookConvexity: 0.05,
      liquidityWallScore: 0.2,
      voidGapScore: 0.1,
      expectedSlippageBuy: 0.01,
      expectedSlippageSell: 0.01,
      resiliencyMs: 1200,
      effectiveSpread: 0.02,
      realizedSpreadShortWindow: 0.01,
    },
    passiveFlowMetrics: {
      bidAddRate: 10,
      askAddRate: 9,
      bidCancelRate: 7,
      askCancelRate: 7,
      depthDeltaDecomposition: {
        addVolume: 120,
        cancelVolume: 90,
        tradeRelatedVolume: 12,
        netDepthDelta: 18,
      },
      queueDeltaBestBid: 2,
      queueDeltaBestAsk: -1,
      spoofScore: 0.1,
      refreshRate: 0.2,
    },
    derivativesMetrics: {
      markLastDeviationPct: 0.01,
      indexLastDeviationPct: 0.02,
      perpBasis: 0.0004,
      perpBasisZScore: 0.3,
      liquidationProxyScore: 0,
    },
    toxicityMetrics: {
      vpinApprox: 0.2,
      signedVolumeRatio: 0.65,
      priceImpactPerSignedNotional: 0.000001,
      tradeToBookRatio: 0.03,
      burstPersistenceScore: 0.55,
    },
    regimeMetrics: {
      realizedVol1m: 0.2,
      realizedVol5m: 0.35,
      realizedVol15m: 0.5,
      volOfVol: 0.04,
      microATR: 0.12,
      chopScore: 0.35,
      trendinessScore: 0.65,
    },
    crossMarketMetrics: null,
    enableCrossMarketConfirmation: false,
    openInterest: {
      oiChangePct: 0.6,
    },
    absorption: {
      value: 1,
      side: 'buy',
    },
    volatility: 120,
    position: null,
  };

  return {
    ...base,
    ...overrides,
    decision: { ...base.decision, ...(overrides?.decision || {}) },
    riskState: { ...base.riskState, ...(overrides?.riskState || {}) },
    executionState: { ...base.executionState, ...(overrides?.executionState || {}) },
    market: { ...base.market, ...(overrides?.market || {}) },
    trades: { ...base.trades, ...(overrides?.trades || {}) },
    openInterest: { ...base.openInterest, ...(overrides?.openInterest || {}) },
    absorption: { ...base.absorption, ...(overrides?.absorption || {}) },
    position: overrides?.position === undefined ? base.position : overrides.position,
    blockedReasons: overrides?.blockedReasons ?? base.blockedReasons,
  };
}

function buildPlan(overrides?: Partial<AIDecisionPlan>): AIDecisionPlan {
  return {
    version: 1,
    nonce: 'nonce-1',
    intent: 'HOLD',
    side: null,
    urgency: 'MED',
    entryStyle: 'HYBRID',
    sizeMultiplier: 1,
    maxAdds: 3,
    addRule: 'WINNER_ONLY',
    addTrigger: {
      minUnrealizedPnlPct: 0.0015,
      trendIntact: true,
      obiSupportMin: 0.1,
      deltaConfirm: true,
    },
    reducePct: null,
    invalidationHint: 'NONE',
    explanationTags: ['TREND_INTACT'],
    confidence: 0.7,
    ...(overrides || {}),
  };
}

function getController(): AIDryRunController {
  const mockSession = {
    submitStrategyDecision: () => [],
    getStrategyPosition: () => null,
  };
  return new AIDryRunController(mockSession as any);
}

export function runTests() {
  {
    const controller = getController();
    const parsePlan = (controller as any).parsePlan.bind(controller);
    const buildSafeHoldPlan = (controller as any).buildSafeHoldPlan.bind(controller);
    const parsed = parsePlan(JSON.stringify(buildPlan({ nonce: 'nonce-mismatch' })), 'nonce-1');
    assert(parsed === null, 'nonce mismatch should invalidate plan');
    const fallback = buildSafeHoldPlan('nonce-1', 'INVALID_AI_RESPONSE');
    assert(fallback.intent === 'HOLD', 'nonce mismatch fallback should hold');
  }

  {
    const controller = getController();
    const applyGuardrails = (controller as any).applyGuardrails.bind(controller);
    const blocked = applyGuardrails(
      buildSnapshot(),
      buildPlan({ intent: 'ENTER', side: 'LONG' }),
      {
        blockedReasons: ['SPREAD_TOO_WIDE'],
        blockEntry: true,
        blockAdd: false,
        blockFlip: false,
        forcedAction: null,
      }
    );
    assert(blocked.intent === 'HOLD', 'blocked entry should downgrade to HOLD');
  }

  {
    const controller = getController();
    const applyGuardrails = (controller as any).applyGuardrails.bind(controller);
    const forced = applyGuardrails(
      buildSnapshot({
        position: {
          side: 'LONG',
          qty: 0.3,
          entryPrice: 60_000,
          unrealizedPnlPct: -0.02,
          addsUsed: 1,
          timeInPositionMs: 15_000,
        },
      }),
      buildPlan({ intent: 'HOLD' }),
      {
        blockedReasons: ['RISK_LOCK'],
        blockEntry: false,
        blockAdd: false,
        blockFlip: false,
        forcedAction: { intent: 'EXIT', reason: 'RISK_LOCK' },
      }
    );
    assert(forced.intent === 'EXIT', 'forced action should enforce EXIT');
  }

  {
    const controller = getController();
    const shouldAllowAdd = (controller as any).shouldAllowAdd.bind(controller);
    const positive = shouldAllowAdd(
      buildSnapshot({
        decision: { gatePassed: true },
        position: {
          side: 'LONG',
          qty: 0.4,
          entryPrice: 60_000,
          unrealizedPnlPct: 0.004,
          addsUsed: 1,
          timeInPositionMs: 30_000,
        },
        market: { obiDeep: 0.4, delta1s: 15, delta5s: 45 },
      }),
      buildPlan({
        intent: 'MANAGE',
        addRule: 'WINNER_ONLY',
        maxAdds: 4,
        addTrigger: {
          minUnrealizedPnlPct: 0.0015,
          trendIntact: true,
          obiSupportMin: 0.1,
          deltaConfirm: true,
        },
      })
    );
    assert(positive === true, 'winner scaling should allow add with pnl+trend+gate');

    const negative = shouldAllowAdd(
      buildSnapshot({
        decision: { gatePassed: true },
        position: {
          side: 'LONG',
          qty: 0.4,
          entryPrice: 60_000,
          unrealizedPnlPct: 0.0003,
          addsUsed: 1,
          timeInPositionMs: 30_000,
        },
        market: { obiDeep: 0.4, delta1s: 15, delta5s: 45 },
      }),
      buildPlan({
        intent: 'MANAGE',
        addRule: 'WINNER_ONLY',
        addTrigger: {
          minUnrealizedPnlPct: 0.0015,
          trendIntact: true,
          obiSupportMin: 0.1,
          deltaConfirm: true,
        },
      })
    );
    assert(negative === false, 'winner scaling should not add if pnl threshold not met');
  }

  {
    const controller = getController();
    const shouldAllowAdd = (controller as any).shouldAllowAdd.bind(controller);
    const pullbackAllowed = shouldAllowAdd(
      buildSnapshot({
        decision: { gatePassed: true },
        executionState: { trendIntact: true },
        position: {
          side: 'LONG',
          qty: 0.5,
          entryPrice: 60_000,
          unrealizedPnlPct: -0.0035,
          addsUsed: 1,
          timeInPositionMs: 40_000,
        },
        market: { obiDeep: 0.42, delta1s: 18, delta5s: 55 },
      }),
      buildPlan({
        intent: 'MANAGE',
        addRule: 'TREND_INTACT',
        addTrigger: {
          minUnrealizedPnlPct: -0.006,
          trendIntact: true,
          obiSupportMin: 0.1,
          deltaConfirm: true,
        },
      })
    );
    assert(pullbackAllowed === true, 'trend-intact pullback should allow add in controlled adverse range');

    const pullbackTooDeep = shouldAllowAdd(
      buildSnapshot({
        decision: { gatePassed: true },
        executionState: { trendIntact: true },
        position: {
          side: 'LONG',
          qty: 0.5,
          entryPrice: 60_000,
          unrealizedPnlPct: -0.02,
          addsUsed: 1,
          timeInPositionMs: 40_000,
        },
        market: { obiDeep: 0.42, delta1s: 18, delta5s: 55 },
      }),
      buildPlan({
        intent: 'MANAGE',
        addRule: 'TREND_INTACT',
        addTrigger: {
          minUnrealizedPnlPct: -0.02,
          trendIntact: true,
          obiSupportMin: 0.1,
          deltaConfirm: true,
        },
      })
    );
    assert(pullbackTooDeep === false, 'pullback add should be blocked when drawdown is too deep');
  }

  {
    const controller = getController();
    const applyGuardrails = (controller as any).applyGuardrails.bind(controller);
    const out = applyGuardrails(
      buildSnapshot({
        position: {
          side: 'LONG',
          qty: 0.25,
          entryPrice: 60_000,
          unrealizedPnlPct: 0.001,
          addsUsed: 0,
          timeInPositionMs: 5_000,
        },
      }),
      buildPlan({ intent: 'ENTER', side: 'SHORT' }),
      {
        blockedReasons: ['FLIP_COOLDOWN_ACTIVE'],
        blockEntry: false,
        blockAdd: false,
        blockFlip: true,
        forcedAction: null,
      }
    );
    assert(out.intent === 'HOLD', 'flip cooldown should prevent reversal entry');
  }

  {
    const controller = getController();
    const computeMicroAlphaContext = (controller as any).computeMicroAlphaContext.bind(controller);
    const getRuntimeState = (controller as any).getRuntimeState.bind(controller);
    const updateTrendState = (controller as any).updateTrendState.bind(controller);
    const orchestratePlan = (controller as any).orchestratePlan.bind(controller);
    const snapshot = buildSnapshot({
      executionState: { holdStreak: 5 },
      blockedReasons: [],
      position: null,
    });
    const microAlpha = computeMicroAlphaContext(snapshot);
    const runtime = getRuntimeState(snapshot.symbol);
    const trend = updateTrendState(runtime, snapshot, microAlpha, snapshot.timestampMs);
    const out = orchestratePlan(snapshot, buildPlan({ intent: 'HOLD', side: null }), microAlpha, trend);
    assert(out.intent === 'ENTER', 'hold streak with tradable positive edge should trigger probe ENTER');
    assert(out.side === 'LONG' || out.side === 'SHORT', 'probe entry should select a side');
  }

  {
    const controller = getController();
    const computeMicroAlphaContext = (controller as any).computeMicroAlphaContext.bind(controller);
    const getRuntimeState = (controller as any).getRuntimeState.bind(controller);
    const updateTrendState = (controller as any).updateTrendState.bind(controller);
    const orchestratePlan = (controller as any).orchestratePlan.bind(controller);
    const snapshot = buildSnapshot({
      executionState: { holdStreak: 1 },
      blockedReasons: [],
      position: null,
      market: { delta1s: -120, delta5s: -800, cvdSlope: -240_000, obiDeep: -0.65, spreadPct: 0.03 },
      absorption: { side: 'sell', value: 1 },
      trades: { printsPerSecond: 6, tradeCount: 22, burstCount: 3, burstSide: 'sell' },
    });
    const runtime = getRuntimeState(snapshot.symbol);
    runtime.bootstrapWarmupUntilTs = snapshot.timestampMs - 1;
    runtime.trendBias = 'SHORT';
    runtime.trendIntact = true;
    runtime.trendBiasSinceTs = snapshot.timestampMs - 180_000;
    const microAlpha = computeMicroAlphaContext(snapshot);
    const trend = updateTrendState(runtime, snapshot, microAlpha, snapshot.timestampMs);
    const out = orchestratePlan(snapshot, buildPlan({ intent: 'HOLD', side: null }), microAlpha, trend, runtime);
    assert(out.intent === 'ENTER', 'first-entry hold override should force trend-aligned enter on valid short bias');
    assert(out.side === 'SHORT', 'first-entry hold override should align with short trend');
  }

  {
    const controller = getController();
    const computeMicroAlphaContext = (controller as any).computeMicroAlphaContext.bind(controller);
    const getRuntimeState = (controller as any).getRuntimeState.bind(controller);
    const updateTrendState = (controller as any).updateTrendState.bind(controller);
    const orchestratePlan = (controller as any).orchestratePlan.bind(controller);
    const snapshot = buildSnapshot({
      market: { spreadPct: 1.2 },
      trades: { printsPerSecond: 9, tradeCount: 40 },
    });
    const microAlpha = computeMicroAlphaContext(snapshot);
    const runtime = getRuntimeState(snapshot.symbol);
    const trend = updateTrendState(runtime, snapshot, microAlpha, snapshot.timestampMs);
    const out = orchestratePlan(snapshot, buildPlan({ intent: 'ENTER', side: 'LONG' }), microAlpha, trend);
    assert(out.intent === 'HOLD', 'entry should be filtered when edge is not tradable');
  }

  {
    const controller = getController();
    const computeMicroAlphaContext = (controller as any).computeMicroAlphaContext.bind(controller);
    const getRuntimeState = (controller as any).getRuntimeState.bind(controller);
    const updateTrendState = (controller as any).updateTrendState.bind(controller);
    const orchestratePlan = (controller as any).orchestratePlan.bind(controller);
    const runtime = getRuntimeState('BTCUSDT');
    runtime.trendBias = 'LONG';
    runtime.trendIntact = true;
    runtime.trendBiasSinceTs = Date.now() - 120_000;

    const snapshot = buildSnapshot({
      executionState: { holdStreak: 0, trendBias: 'LONG', trendIntact: true, trendAgeMs: 120_000 },
      position: null,
    });
    const microAlpha = computeMicroAlphaContext(snapshot);
    const trend = updateTrendState(runtime, snapshot, microAlpha, snapshot.timestampMs);
    const out = orchestratePlan(snapshot, buildPlan({ intent: 'ENTER', side: 'SHORT' }), microAlpha, trend);
    assert(out.intent === 'ENTER' && out.side === 'LONG', 'trend bias should lock opposite entry to trend side');
  }

  {
    const controller = getController();
    const computeMicroAlphaContext = (controller as any).computeMicroAlphaContext.bind(controller);
    const getRuntimeState = (controller as any).getRuntimeState.bind(controller);
    const updateTrendState = (controller as any).updateTrendState.bind(controller);
    const orchestratePlan = (controller as any).orchestratePlan.bind(controller);
    const runtime = getRuntimeState('BTCUSDT');
    runtime.trendBias = 'LONG';
    runtime.trendIntact = true;
    runtime.trendBiasSinceTs = Date.now() - 240_000;

    const snapshot = buildSnapshot({
      executionState: {
        holdStreak: 0,
        trendBias: 'LONG',
        trendIntact: true,
        trendAgeMs: 240_000,
        lastTrendTakeProfitMsAgo: 120_000,
      },
      position: {
        side: 'LONG',
        qty: 0.4,
        entryPrice: 60_000,
        unrealizedPnlPct: 0.004,
        addsUsed: 0,
        timeInPositionMs: 120_000,
      },
    });
    const microAlpha = computeMicroAlphaContext(snapshot);
    const trend = updateTrendState(runtime, snapshot, microAlpha, snapshot.timestampMs);
    const out = orchestratePlan(snapshot, buildPlan({ intent: 'HOLD', side: null }), microAlpha, trend);
    assert(out.intent === 'MANAGE' && Number(out.reducePct) > 0, 'intact trend with pnl should convert HOLD to partial reduce');
  }
}
