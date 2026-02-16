import { AutonomousMetricsPolicy } from '../ai/AutonomousMetricsPolicy';
import { AIMetricsSnapshot } from '../ai/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function buildSnapshot(overrides?: Partial<AIMetricsSnapshot>): AIMetricsSnapshot {
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
    market: { ...base.market, ...(overrides?.market || {}) },
    trades: { ...base.trades, ...(overrides?.trades || {}) },
    openInterest: { ...base.openInterest, ...(overrides?.openInterest || {}) },
    absorption: { ...base.absorption, ...(overrides?.absorption || {}) },
  };
}

export function runTests() {
  const policy = new AutonomousMetricsPolicy();

  {
    const decision = policy.decide(buildSnapshot());
    assert(decision.action.action === 'ENTRY', 'strong bullish flat snapshot should produce ENTRY');
    assert(decision.action.side === 'LONG', 'bullish entry should be LONG');
  }

  {
    const decision = policy.decide(buildSnapshot({
      market: {
        price: 60_000,
        vwap: 60_100,
        spreadPct: 0.03,
        delta1s: -40,
        delta5s: -120,
        deltaZ: -2.1,
        cvdSlope: -22_000,
        obiWeighted: -0.55,
        obiDeep: -0.5,
        obiDivergence: -0.3,
      },
      trades: {
        printsPerSecond: 8,
        tradeCount: 30,
        aggressiveBuyVolume: 80,
        aggressiveSellVolume: 210,
        burstCount: 6,
        burstSide: 'sell',
      },
      openInterest: { oiChangePct: -0.8 },
      absorption: { value: 1, side: 'sell' },
      position: {
        side: 'LONG',
        qty: 0.5,
        entryPrice: 60_100,
        unrealizedPnlPct: -0.009,
        addsUsed: 1,
      },
    }));
    assert(decision.action.action === 'EXIT', 'strong opposite signal on losing long should EXIT');
  }

  {
    const decision = policy.decide(buildSnapshot({
      market: {
        price: 60_000,
        vwap: 60_010,
        spreadPct: 0.02,
        delta1s: 8,
        delta5s: 18,
        deltaZ: 0.4,
        cvdSlope: 4_000,
        obiWeighted: 0.2,
        obiDeep: 0.18,
        obiDivergence: 0.05,
      },
      trades: {
        printsPerSecond: 2,
        tradeCount: 8,
        aggressiveBuyVolume: 90,
        aggressiveSellVolume: 88,
        burstCount: 1,
        burstSide: null,
      },
      absorption: { value: 0, side: null },
    }));
    assert(decision.action.action === 'HOLD', 'weak signal should HOLD');
  }
}
