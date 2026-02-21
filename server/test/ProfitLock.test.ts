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
      quality: 'GOOD',
      metricsPresent: true,
      freezeActive: false,
      lastLatencyMs: 20,
      lastSlippageBps: 2,
      lastSpreadPct: 0.01,
      recentLatencyMs: [],
      recentSlippageBps: [],
    },
  };
}

const engine = new DecisionEngine({
  expectedPrice: () => 100,
  getCurrentMarginBudgetUsdt: () => 100,
  getMaxLeverage: () => 25,
  hardStopLossPct: 1.0,
  liquidationEmergencyMarginRatio: 0.30,
  takerFeeBps: 4,
  profitLockBufferBps: 2,
});

export function runTests() {
  const state = baseState();
  state.position = {
    side: 'LONG',
    qty: 1,
    entryPrice: 100,
    unrealizedPnlPct: 0.35,
    addsUsed: 0,
    peakPnlPct: 0.35,
    profitLockActivated: false,
    hardStopPrice: null,
  };

  engine.evaluate({
    symbol: 'BTCUSDT',
    event_time_ms: 1,
    gate: gatePass,
    metrics: {
      symbol: 'BTCUSDT',
      prints_per_second: 3,
      spread_pct: 0.01,
      best_bid: 100.4,
      best_ask: 100.5,
      legacyMetrics: { obiDeep: 0.3, deltaZ: 0.5, cvdSlope: 0.1 },
    },
    state,
  });

  // Legacy profit-lock mutations were removed from DecisionEngine path.
  assert(state.position.profitLockActivated === false, 'legacy profit lock flag must remain untouched');
  assert(state.position.hardStopPrice == null, 'legacy hard-stop mutation must remain disabled');

  const syntheticStop = state.position.entryPrice;
  const actions = engine.evaluate({
    symbol: 'BTCUSDT',
    event_time_ms: 2,
    gate: gatePass,
    metrics: {
      symbol: 'BTCUSDT',
      prints_per_second: 3,
      spread_pct: 0.01,
      best_bid: syntheticStop - 0.01,
      best_ask: syntheticStop + 0.01,
      legacyMetrics: { obiDeep: 0.3, deltaZ: 0.5, cvdSlope: 0.1 },
    },
    state,
  });

  assert(!actions.some((a) => a.reason === 'profit_lock_exit'), 'deprecated profit-lock exit reason must not be emitted');
  assert(actions.some((a) => a.type === 'EXIT_MARKET' && a.reason === 'REDUCE_SOFT'), 'strategy path should still allow soft reduction');
}
