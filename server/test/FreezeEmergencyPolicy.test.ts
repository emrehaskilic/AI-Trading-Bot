function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { DecisionEngine } from '../orchestrator/Decision';
import { GateMode, GateResult, SymbolState } from '../orchestrator/types';

const gatePass: GateResult = {
  mode: GateMode.V1_NO_LATENCY,
  passed: true,
  reason: null,
  network_latency_ms: null,
  checks: {
    hasRequiredMetrics: true,
    spreadOk: true,
    obiDeepOk: true,
    networkLatencyOk: null,
  },
};

function baseState(): SymbolState {
  return {
    symbol: 'BTCUSDT',
    halted: false,
    availableBalance: 1000,
    walletBalance: 1000,
    position: null,
    openOrders: new Map(),
    hasOpenEntryOrder: false,
    pendingEntry: false,
    cooldown_until_ms: 0,
    last_exit_event_time_ms: 0,
    marginRatio: 1,
    execQuality: {
      quality: 'UNKNOWN',
      metricsPresent: false,
      freezeActive: false,
      lastLatencyMs: null,
      lastSlippageBps: null,
      lastSpreadPct: null,
      recentLatencyMs: [],
      recentSlippageBps: [],
    },
  };
}

const engine = new DecisionEngine({
  expectedPrice: () => 100,
  getCurrentMarginBudgetUsdt: () => 100,
  getMaxLeverage: () => 20,
  hardStopLossPct: 1.0,
  liquidationEmergencyMarginRatio: 0.30,
  takerFeeBps: 4,
  profitLockBufferBps: 2,
});

export function runTests() {
  // Legacy freeze/emergency branches were removed; decisions are strategy-driven.
  {
    const state = baseState();
    state.position = {
      side: 'LONG',
      qty: 1,
      entryPrice: 100,
      unrealizedPnlPct: -0.1,
      addsUsed: 0,
      peakPnlPct: 0,
      profitLockActivated: false,
      hardStopPrice: null,
    };
    state.execQuality.quality = 'UNKNOWN';
    state.execQuality.freezeActive = true;

    const actions = engine.evaluate({
      symbol: 'BTCUSDT',
      event_time_ms: 1,
      gate: gatePass,
      metrics: {
        symbol: 'BTCUSDT',
        prints_per_second: 5,
        spread_pct: 0.01,
        legacyMetrics: { obiDeep: 0.3, deltaZ: 1.0, cvdSlope: 0.2 },
      },
      state,
    });

    assert(actions.every((a) => !String(a.reason || '').startsWith('emergency_exit_')), 'legacy emergency-exit reasons must not be emitted');
    assert(actions.some((a) => a.type === 'EXIT_MARKET' && a.reason === 'REDUCE_SOFT'), 'position management should remain strategy-driven');
  }

  // 2) Bad exec metadata does not force legacy freeze outcomes.
  {
    const state = baseState();
    state.position = {
      side: 'SHORT',
      qty: 1,
      entryPrice: 100,
      unrealizedPnlPct: -0.2,
      addsUsed: 0,
      peakPnlPct: 0,
      profitLockActivated: false,
      hardStopPrice: null,
    };
    state.execQuality.quality = 'BAD';
    state.execQuality.freezeActive = true;
    state.execQuality.metricsPresent = true;

    const actions = engine.evaluate({
      symbol: 'BTCUSDT',
      event_time_ms: 2,
      gate: gatePass,
      metrics: {
        symbol: 'BTCUSDT',
        prints_per_second: 3,
        spread_pct: 0.02,
        legacyMetrics: { obiDeep: 0.4, deltaZ: -1.0, cvdSlope: -0.2 },
      },
      state,
    });

    assert(actions.every((a) => !String(a.reason || '').startsWith('emergency_exit_')), 'legacy emergency-exit reasons must remain disabled');
    assert(actions.some((a) => a.type === 'NOOP' && a.reason === 'no_action'), 'engine should return no_action when strategy has no signal');
  }

  // 3) Margin ratio does not trigger deprecated liquidation emergency path here.
  {
    const state = baseState();
    state.position = {
      side: 'LONG',
      qty: 1,
      entryPrice: 100,
      unrealizedPnlPct: -0.1,
      addsUsed: 0,
      peakPnlPct: 0,
      profitLockActivated: false,
      hardStopPrice: null,
    };
    state.execQuality.quality = 'UNKNOWN';
    state.execQuality.freezeActive = true;
    state.marginRatio = 0.2;

    const actions = engine.evaluate({
      symbol: 'BTCUSDT',
      event_time_ms: 3,
      gate: gatePass,
      metrics: {
        symbol: 'BTCUSDT',
        prints_per_second: 2,
        spread_pct: 0.03,
        legacyMetrics: { obiDeep: 0.5, deltaZ: 0.2, cvdSlope: 0.1 },
      },
      state,
    });

    assert(actions.every((a) => !String(a.reason || '').startsWith('emergency_exit_')), 'deprecated liquidation emergency exit must not be emitted');
    assert(actions.some((a) => a.type === 'NOOP' && a.reason === 'no_action'), 'engine should remain on no_action in absence of strategy trigger');
  }

  // 4) Large drawdown does not use deprecated hard-stop emergency reason.
  {
    const state = baseState();
    state.position = {
      side: 'SHORT',
      qty: 1,
      entryPrice: 100,
      unrealizedPnlPct: -2.5,
      addsUsed: 0,
      peakPnlPct: 0,
      profitLockActivated: false,
      hardStopPrice: null,
    };
    state.execQuality.quality = 'BAD';
    state.execQuality.freezeActive = true;
    state.marginRatio = 0.9;

    const actions = engine.evaluate({
      symbol: 'BTCUSDT',
      event_time_ms: 4,
      gate: gatePass,
      metrics: {
        symbol: 'BTCUSDT',
        prints_per_second: 2,
        spread_pct: 0.02,
        legacyMetrics: { obiDeep: 0.5, deltaZ: -0.5, cvdSlope: -0.1 },
      },
      state,
    });

    assert(actions.every((a) => !String(a.reason || '').startsWith('emergency_exit_')), 'deprecated hard-stop emergency exit must not be emitted');
    assert(actions.some((a) => a.type === 'EXIT_MARKET' && a.reason === 'REDUCE_SOFT'), 'drawdown should still allow strategy reduction');
  }
}
