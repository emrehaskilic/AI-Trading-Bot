import { describe, expect, it } from 'vitest';
import { BiasConfidenceTracker } from './server/orchestrator_v1/BiasConfidenceTracker';

describe('BiasConfidenceTracker', () => {
  it('carries forward confidence on missing tick instead of hard resetting to 0/100', () => {
    const tracker = new BiasConfidenceTracker();

    const seeded = tracker.resolve({
      symbol: 'BTCUSDT',
      side: 'SHORT',
      hasOpenPosition: false,
      allGatesPassed: true,
      readinessReady: true,
      rawConfidence: 0.83,
    });
    const missingTick = tracker.resolve({
      symbol: 'BTCUSDT',
      side: 'SHORT',
      hasOpenPosition: false,
      allGatesPassed: false,
      readinessReady: false,
      rawConfidence: null,
    });

    expect(seeded).toBeCloseTo(0.83, 4);
    expect(missingTick).toBeCloseTo(seeded, 4);
    expect(Math.round(missingTick * 100)).not.toBe(0);
    expect(Math.round(missingTick * 100)).not.toBe(100);
  });

  it('tracks raw confidence updates and does not stick to directional base', () => {
    const tracker = new BiasConfidenceTracker();

    const first = tracker.resolve({
      symbol: 'ETHUSDT',
      side: 'LONG',
      hasOpenPosition: false,
      allGatesPassed: false,
      readinessReady: true,
      rawConfidence: 0.41,
    });
    const second = tracker.resolve({
      symbol: 'ETHUSDT',
      side: 'LONG',
      hasOpenPosition: false,
      allGatesPassed: false,
      readinessReady: true,
      rawConfidence: 0.77,
    });

    expect(first).toBeCloseTo(0.41, 4);
    expect(second).toBeCloseTo(0.77, 4);
    expect(second).not.toBeCloseTo(0.72, 2);
  });
});
