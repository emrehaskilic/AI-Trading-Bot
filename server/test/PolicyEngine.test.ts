import { PolicyEngine } from '../ai/PolicyEngine';
import { buildAIMetricsSnapshot } from './helpers/aiSnapshot';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export async function runTests() {
  const snapshot = buildAIMetricsSnapshot({
    symbol: 'BTCUSDT',
    timestampMs: 1700000000000,
  });

  const input: any = {
    symbol: 'BTCUSDT',
    timestampMs: snapshot.timestampMs,
    state: {
      symbol: 'BTCUSDT',
      timestampMs: snapshot.timestampMs,
      flowState: 'NEUTRAL',
      regimeState: 'TRANSITION',
      derivativesState: 'DELEVERAGING',
      toxicityState: 'CLEAN',
      executionState: 'HEALTHY',
      stateConfidence: 0.6,
      directionalBias: 'NEUTRAL',
      cvdSlopeSign: 'FLAT',
      oiDirection: 'FLAT',
      volatilityPercentile: 50,
      expectedSlippageBps: 2,
      spreadBps: 2,
    },
    snapshot,
    position: null,
    directionLockBlocked: false,
    lockReason: null,
    startedAtMs: snapshot.timestampMs - 1000,
  };

  {
    const engine = new PolicyEngine({
      apiKey: '',
      model: '',
      localOnly: false,
      temperature: 0,
      maxOutputTokens: 64,
    });

    const out = await engine.evaluate(input);
    assert(out.decision.intent === 'HOLD', 'missing llm config must hold');
    assert(out.source === 'HOLD_FALLBACK', 'missing llm config source must be HOLD_FALLBACK');
    assert(out.error === 'LLM_NOT_CONFIGURED', 'missing llm config error must be LLM_NOT_CONFIGURED');
  }

  {
    const prev = process.env.AI_TEST_LOCAL_POLICY;
    process.env.AI_TEST_LOCAL_POLICY = 'false';
    const engine = new PolicyEngine({
      apiKey: '',
      model: '',
      localOnly: true,
      temperature: 0,
      maxOutputTokens: 64,
    });

    const out = await engine.evaluate(input);
    assert(out.decision.intent === 'HOLD', 'localOnly must be blocked when test flag disabled');
    assert(out.error === 'LOCAL_POLICY_DISABLED', 'disabled local policy should report LOCAL_POLICY_DISABLED');
    process.env.AI_TEST_LOCAL_POLICY = prev;
  }

  {
    const prev = process.env.AI_TEST_LOCAL_POLICY;
    process.env.AI_TEST_LOCAL_POLICY = 'true';
    const engine = new PolicyEngine({
      apiKey: '',
      model: '',
      localOnly: true,
      temperature: 0,
      maxOutputTokens: 64,
    });

    const out = await engine.evaluate(input);
    assert(out.source === 'LOCAL_POLICY', 'local policy should be reachable only in test mode');
    process.env.AI_TEST_LOCAL_POLICY = prev;
  }

  {
    const engine = new PolicyEngine({
      apiKey: 'x',
      model: 'y',
      localOnly: false,
      temperature: 0,
      maxOutputTokens: 64,
    }) as any;

    const valid = engine.validatePolicy(
      {
        intent: 'ADD',
        side: 'LONG',
        riskMultiplier: 0.9,
        confidence: 0.7,
      },
      {
        side: 'LONG',
        qty: 0.1,
        entryPrice: 10,
        unrealizedPnlPct: 0,
        addsUsed: 0,
        timeInPositionMs: 10,
      }
    );
    assert(valid.valid === true, 'valid add policy should pass validation');

    const invalid = engine.validatePolicy(
      {
        intent: 'ENTER',
        side: 'SHORT',
        riskMultiplier: 0.9,
        confidence: 0.7,
      },
      {
        side: 'LONG',
        qty: 0.1,
        entryPrice: 10,
        unrealizedPnlPct: 0,
        addsUsed: 0,
        timeInPositionMs: 10,
      }
    );
    assert(invalid.valid === false, 'enter while in position must be invalid');
  }
}
