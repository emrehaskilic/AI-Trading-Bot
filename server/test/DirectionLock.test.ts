import { DirectionLock } from '../ai/DirectionLock';
import { DeterministicStateSnapshot } from '../ai/StateExtractor';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function state(overrides?: Partial<DeterministicStateSnapshot>): DeterministicStateSnapshot {
  return {
    symbol: 'BTCUSDT',
    timestampMs: Date.now(),
    flowState: 'EXPANSION',
    regimeState: 'TREND',
    derivativesState: 'LONG_BUILD',
    toxicityState: 'CLEAN',
    executionState: 'HEALTHY',
    stateConfidence: 0.8,
    directionalBias: 'LONG',
    cvdSlopeSign: 'UP',
    oiDirection: 'UP',
    volatilityPercentile: 45,
    expectedSlippageBps: 3,
    spreadBps: 7,
    ...(overrides || {}),
  };
}

export function runTests() {
  {
    const lock = new DirectionLock({ minFlipCooldownMs: 100, confirmationTtlMs: 10_000 });
    const t0 = Date.now();

    lock.observe('BTCUSDT', {
      side: 'LONG',
      qty: 0.1,
      entryPrice: 60_000,
      unrealizedPnlPct: 0,
      addsUsed: 0,
      timeInPositionMs: 1_000,
    }, state({ timestampMs: t0 }));

    lock.observe('BTCUSDT', null, state({ timestampMs: t0 + 1 }));

    const blockedCooldown = lock.evaluate(
      'BTCUSDT',
      'ENTER',
      'SHORT',
      null,
      state({ timestampMs: t0 + 50, flowState: 'EXHAUSTION', regimeState: 'TREND', cvdSlopeSign: 'UP', oiDirection: 'UP' })
    );
    assert(blockedCooldown.blocked === true, 'reversal must be blocked during cooldown');

    const blockedConfirm = lock.evaluate(
      'BTCUSDT',
      'ENTER',
      'SHORT',
      null,
      state({ timestampMs: t0 + 200, flowState: 'EXHAUSTION', regimeState: 'TRANSITION', cvdSlopeSign: 'UP', oiDirection: 'UP' })
    );
    assert(blockedConfirm.blocked === true, 'insufficient confirmations should block reversal');

    const allowed = lock.evaluate(
      'BTCUSDT',
      'ENTER',
      'SHORT',
      null,
      state({ timestampMs: t0 + 300, flowState: 'EXHAUSTION', regimeState: 'TRANSITION', cvdSlopeSign: 'DOWN', oiDirection: 'DOWN' })
    );
    assert(allowed.blocked === false, '3/4 confirmations after cooldown should allow reversal');
  }

  {
    const lock = new DirectionLock({ minFlipCooldownMs: 100, confirmationTtlMs: 10_000 });
    const evalNoAutoClose = lock.evaluate(
      'ETHUSDT',
      'ENTER',
      'SHORT',
      {
        side: 'LONG',
        qty: 0.2,
        entryPrice: 2_000,
        unrealizedPnlPct: -0.01,
        addsUsed: 0,
        timeInPositionMs: 12_000,
      },
      state({ symbol: 'ETHUSDT' })
    );
    assert(evalNoAutoClose.blocked === true, 'enter opposite while position open must be blocked');
    assert(evalNoAutoClose.reason === 'NO_AUTO_CLOSE_REVERSE', 'must return no-auto-close reason');
  }
}
