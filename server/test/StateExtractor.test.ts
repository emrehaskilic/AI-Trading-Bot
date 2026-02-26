import { StateExtractor } from '../ai/StateExtractor';
import { buildAIMetricsSnapshot } from './helpers/aiSnapshot';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function runTests() {
  {
    const extractor = new StateExtractor(10);
    const bid = 78.06;
    const ask = 78.07;
    const mid = (bid + ask) / 2;
    const spreadRatio = (ask - bid) / mid;
    const spreadPct = spreadRatio * 100;

    // Warm-up to pass state hysteresis in extractor.
    extractor.extract(buildAIMetricsSnapshot({
      symbol: 'SOLUSDT',
      market: { spreadPct },
    }));

    const state = extractor.extract(buildAIMetricsSnapshot({
      symbol: 'SOLUSDT',
      market: { spreadPct },
    }));

    const expectedSpreadBps = spreadRatio * 10_000;
    assert(Math.abs(spreadRatio - 0.000128098379555382) < 1e-12, 'spread ratio conversion should match expected baseline');
    assert(Math.abs(spreadPct - 0.0128098379555382) < 1e-12, 'spread percent conversion should match expected baseline');
    assert(Math.abs(state.spreadBps - expectedSpreadBps) < 1e-3, `spread bps should be ${expectedSpreadBps}, got ${state.spreadBps}`);
    assert(state.spreadBps < 10, 'spread bps should never show 100x inflation for this case');
    assert(state.executionState !== 'LOW_RESILIENCY', '1.28 bps spread must not force LOW_RESILIENCY by spread alone');
  }

  {
    const extractor = new StateExtractor(10);
    extractor.extract(buildAIMetricsSnapshot({
      market: { deltaZ: 2.3, cvdSlope: 60_000, obiDeep: 0.5 },
      openInterest: { oiChangePct: 0.45 },
      liquidityMetrics: { expectedSlippageBuy: 0.5, expectedSlippageSell: 0.5 },
      toxicityMetrics: { vpinApprox: 0.25, burstPersistenceScore: 0.35, priceImpactPerSignedNotional: 0.00001 },
    }));
    const state = extractor.extract(buildAIMetricsSnapshot({
      market: { deltaZ: 2.3, cvdSlope: 60_000, obiDeep: 0.5 },
      openInterest: { oiChangePct: 0.45 },
      liquidityMetrics: { expectedSlippageBuy: 0.5, expectedSlippageSell: 0.5 },
      toxicityMetrics: { vpinApprox: 0.25, burstPersistenceScore: 0.35, priceImpactPerSignedNotional: 0.00001 },
    }));
    assert(state.flowState === 'EXPANSION', 'flow should classify as EXPANSION');
    assert(state.regimeState === 'TREND' || state.regimeState === 'TRANSITION', 'regime should be trend-like on clean trending snapshot');
    assert(state.derivativesState === 'LONG_BUILD', 'derivatives should classify as LONG_BUILD');
    assert(state.executionState !== 'LOW_RESILIENCY', 'tight spread should not force LOW_RESILIENCY');
  }

  {
    const extractor = new StateExtractor(10);
    extractor.extract(buildAIMetricsSnapshot({
      symbol: 'ETHUSDT',
      market: { deltaZ: 2.1, cvdSlope: 50_000, obiDeep: 0.4 },
    }));
    const first = extractor.extract(buildAIMetricsSnapshot({
      symbol: 'ETHUSDT',
      market: { deltaZ: 2.1, cvdSlope: 50_000, obiDeep: 0.4 },
    }));
    assert(first.flowState === 'EXPANSION', 'initial state should be expansion');

    const second = extractor.extract(buildAIMetricsSnapshot({
      symbol: 'ETHUSDT',
      market: { deltaZ: 0.02, cvdSlope: 500, obiDeep: 0.01 },
      absorption: { value: 0, side: null },
    }));
    assert(second.flowState === 'EXPANSION', 'single opposite tick should not immediately flip because of hysteresis');

    const third = extractor.extract(buildAIMetricsSnapshot({
      symbol: 'ETHUSDT',
      market: { deltaZ: 0.01, cvdSlope: 300, obiDeep: 0.0 },
      absorption: { value: 0, side: null },
    }));
    assert(third.flowState !== 'EXPANSION', 'second confirmation should allow transition');
  }

  {
    const extractor = new StateExtractor(10);
    const toxic = extractor.extract(buildAIMetricsSnapshot({
      symbol: 'SOLUSDT',
      toxicityMetrics: {
        vpinApprox: 0.92,
        signedVolumeRatio: 0.9,
        priceImpactPerSignedNotional: 0.00008,
        tradeToBookRatio: 0.12,
        burstPersistenceScore: 0.92,
      },
    }));
    assert(toxic.toxicityState === 'TOXIC', 'critical toxic classification must apply immediately');
  }

  {
    const extractor = new StateExtractor(10);
    const state = extractor.extract(buildAIMetricsSnapshot({
      symbol: 'XRPUSDT',
      market: {
        spreadPct: 0.0001281,
      },
      liquidityMetrics: {
        expectedSlippageBuy: 0.2,
        expectedSlippageSell: 0.2,
      },
    }));

    assert(Math.abs(state.spreadBps - 1.281) < 0.05, 'spread bps conversion should stay near 1.281 bps');
    assert(state.spreadBps < 10, 'spread bps must not inflate by 100x');
  }
}
