import { PolicyEngine } from '../ai/PolicyEngine';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function input(overrides?: Partial<any>): any {
  return {
    symbol: 'BTCUSDT',
    timestampMs: Date.now(),
    startedAtMs: Date.now() - 1_000,
    directionLockBlocked: false,
    lockReason: null,
    position: null,
    state: {
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
      volatilityPercentile: 40,
      expectedSlippageBps: 1,
      spreadBps: 1,
    },
    ...(overrides || {}),
  };
}

export async function runTests() {
  const previousPolicyTimeout = process.env.AI_POLICY_TIMEOUT_MS;
  try {
    {
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => ({ text: 'not-json' }),
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'HOLD', 'invalid json must resolve HOLD');
      assert(res.source === 'LLM', 'invalid json should still report LLM source');
      assert(res.error === 'invalid_policy_json', 'invalid json error should be surfaced');
    }

    {
      const engine = new PolicyEngine({
        apiKey: '',
        model: '',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'HOLD', 'missing config must resolve HOLD');
      assert(res.source === 'LLM', 'missing config should keep LLM policy source');
      assert(res.error === 'LLM_NOT_CONFIGURED', 'missing config error must be LLM_NOT_CONFIGURED');
    }

    {
      const engine = new PolicyEngine({
        apiKey: '',
        model: '',
        localOnly: true,
        temperature: 0,
        maxOutputTokens: 64,
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'HOLD', 'local policy must be unreachable without test flag');
      assert(res.source === 'LLM', 'source must remain LLM when local policy is disabled');
    }

    {
      const engine = new PolicyEngine({
        apiKey: '',
        model: '',
        localOnly: true,
        temperature: 0,
        maxOutputTokens: 64,
        testLocalPolicyEnabled: true,
      });

      const res = await engine.evaluate(input());
      assert(res.source === 'LOCAL_POLICY', 'local policy should be reachable only with test flag');
    }

    {
      const engine = new PolicyEngine({
        apiKey: 'x',
        model: 'y',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        testLocalPolicyEnabled: false,
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

    {
      delete process.env.AI_POLICY_TIMEOUT_MS;
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => {
          await sleep(900);
          return { text: '{"intent":"ENTER","side":"LONG","riskMultiplier":1,"confidence":0.9}' };
        },
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'ENTER', 'default timeout should allow valid delayed responses');
      assert(res.error === null, 'default delayed response should not produce timeout');
    }

    {
      process.env.AI_POLICY_TIMEOUT_MS = '800';
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => {
          await sleep(1200);
          return { text: '{"intent":"ENTER","side":"LONG","riskMultiplier":1,"confidence":0.9}' };
        },
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'HOLD', 'timeout must force HOLD');
      assert(res.error === 'policy_timeout', 'timeout must surface policy_timeout');
    }

    {
      delete process.env.AI_POLICY_TIMEOUT_MS;
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => ({
          text: 'Here is the JSON requested:\n```json\n{"intent":"ENTER","side":"LONG","riskMultiplier":1,"confidence":0.91}\n```',
        }),
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'ENTER', 'markdown-wrapped policy json should be parsed');
      assert(res.error === null, 'markdown-wrapped policy json should not set policy error');
    }

    {
      delete process.env.AI_POLICY_TIMEOUT_MS;
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => ({
          text: 'Here is the JSON requested:\n```json\n{"intent":"ENTER","side":"LONG","riskMultiplier":1,"confidence":0.91}',
        }),
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'ENTER', 'open markdown fence policy json should be repair-parsed');
      assert(res.error === null, 'open markdown fence policy json should not set policy error');
    }

    {
      delete process.env.AI_POLICY_TIMEOUT_MS;
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => ({
          text: '{"intent":"ENTER","side":"LONG","riskMultiplier":1,"confidence":0.91,}',
        }),
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'ENTER', 'json with trailing comma should be parsed');
      assert(res.error === null, 'json with trailing comma should not set policy error');
    }

    {
      delete process.env.AI_POLICY_TIMEOUT_MS;
      let callCount = 0;
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => {
          callCount += 1;
          if (callCount === 1) {
            return { text: 'Here is the JSON requested:\n```json' };
          }
          return { text: '{"intent":"ENTER","side":"LONG","riskMultiplier":1,"confidence":0.92}' };
        },
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(callCount === 2, 'invalid first response should trigger a second strict retry');
      assert(res.decision.intent === 'ENTER', 'second strict retry should recover to valid decision');
      assert(res.error === null, 'recovered retry should not surface policy error');
    }

    {
      delete process.env.AI_POLICY_TIMEOUT_MS;
      const engine = new PolicyEngine({
        apiKey: 'k',
        model: 'm',
        localOnly: false,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => ({
          text: 'intent=ENTER side=LONG riskMultiplier=1 confidence=0.88',
        }),
        testLocalPolicyEnabled: false,
      });

      const res = await engine.evaluate(input());
      assert(res.decision.intent === 'ENTER', 'loose key/value response should be parsed');
      assert(res.decision.side === 'LONG', 'loose key/value response should preserve side');
      assert(res.error === null, 'loose key/value response should not set policy error');
    }

  } finally {
    if (previousPolicyTimeout == null) delete process.env.AI_POLICY_TIMEOUT_MS;
    else process.env.AI_POLICY_TIMEOUT_MS = previousPolicyTimeout;
  }
}
