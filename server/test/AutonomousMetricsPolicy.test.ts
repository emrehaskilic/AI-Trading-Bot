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
}
