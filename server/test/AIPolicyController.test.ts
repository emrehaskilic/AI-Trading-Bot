import { AIDryRunController } from '../ai/AIDryRunController';
import { buildAIMetricsSnapshot } from './helpers/aiSnapshot';
import { StrategyDecision } from '../types/strategy';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeSnapshot(symbol = 'BTCUSDT') {
  return buildAIMetricsSnapshot({
    symbol,
    timestampMs: Date.now(),
    market: {
      delta1s: 1_200,
      delta5s: 2_400,
      deltaZ: 2.4,
      cvdSlope: 70_000,
      obiDeep: 0.55,
      spreadPct: 0.0005,
    },
    openInterest: { oiChangePct: 0.5 },
    volatility: 105,
    liquidityMetrics: {
      expectedSlippageBuy: 0.1,
      expectedSlippageSell: 0.1,
      resiliencyMs: 300,
    },
    toxicityMetrics: {
      vpinApprox: 0.2,
      burstPersistenceScore: 0.3,
      priceImpactPerSignedNotional: 0.00001,
      signedVolumeRatio: 0.55,
      tradeToBookRatio: 0.02,
    },
  });
}

export async function runTests() {
  const prevTestLocalPolicy = process.env.AI_TEST_LOCAL_POLICY;
  process.env.AI_TEST_LOCAL_POLICY = 'false';

  try {
    {
      const decisions: StrategyDecision[] = [];
      const dryRunSession = {
        submitStrategyDecision: (_symbol: string, decision: StrategyDecision) => {
          decisions.push(decision);
          return [];
        },
      } as any;

      const controller = new AIDryRunController(dryRunSession);
      controller.start({
        symbols: ['BTCUSDT'],
        decisionIntervalMs: 100,
        temperature: 0,
        maxOutputTokens: 64,
      });

      await controller.onMetrics(makeSnapshot('BTCUSDT'));

      assert(decisions.length > 0, 'controller should emit a decision when llm config missing');
      const latest = decisions[decisions.length - 1];
      assert(latest.actions[0].type === 'NOOP', 'missing llm config must not place orders');
      const details = (latest.log.gate.details || {}) as Record<string, any>;
      assert(details.policySource === 'LLM', 'policySource should remain LLM on missing config');
      assert(details.policyError === 'LLM_NOT_CONFIGURED', 'missing config policyError should be LLM_NOT_CONFIGURED');
      controller.stop();
    }

    {
      const decisions: StrategyDecision[] = [];
      const dryRunSession = {
        submitStrategyDecision: (_symbol: string, decision: StrategyDecision) => {
          decisions.push(decision);
          return [];
        },
      } as any;

      const controller = new AIDryRunController(dryRunSession);
      controller.start({
        symbols: ['BTCUSDT'],
        apiKey: 'k',
        model: 'm',
        decisionIntervalMs: 100,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => ({ text: 'INVALID_JSON' }),
      });

      await controller.onMetrics(makeSnapshot('BTCUSDT'));

      assert(decisions.length > 0, 'controller should emit a decision on invalid llm response');
      const latest = decisions[decisions.length - 1];
      assert(latest.actions[0].type === 'NOOP', 'invalid llm json must not place orders');
      const details = (latest.log.gate.details || {}) as Record<string, any>;
      assert(details.policySource === 'LLM', 'invalid llm json should keep LLM source');
      assert(details.policyError === 'invalid_policy_json', 'invalid llm json should set policyError');
      controller.stop();
    }

    {
      const decisions: StrategyDecision[] = [];
      const dryRunSession = {
        submitStrategyDecision: (_symbol: string, decision: StrategyDecision) => {
          decisions.push(decision);
          return [];
        },
      } as any;

      const controller = new AIDryRunController(dryRunSession);
      controller.start({
        symbols: ['BTCUSDT'],
        apiKey: 'k',
        model: 'm',
        decisionIntervalMs: 100,
        temperature: 0,
        maxOutputTokens: 64,
        llmCaller: async () => ({
          text: '{"intent":"ENTER","side":"LONG","riskMultiplier":1,"confidence":0.91}',
        }),
      });

      await controller.onMetrics(makeSnapshot('BTCUSDT'));

      assert(decisions.length > 0, 'controller should emit a decision for valid llm policy');
      const latest = decisions[decisions.length - 1];
      assert(latest.actions[0].type === 'ENTRY', 'valid llm enter policy should create entry action');
      assert((latest.actions[0].metadata as any)?.postOnlyRequired === true, 'entry action should remain postOnly/limit-style');
      const details = (latest.log.gate.details || {}) as Record<string, any>;
      assert(details.policySource === 'LLM', 'entry policy source must be LLM');
      assert(details.llmUsed === true, 'llmUsed must be true for llm decision');
      controller.stop();
    }
  } finally {
    if (prevTestLocalPolicy == null) delete process.env.AI_TEST_LOCAL_POLICY;
    else process.env.AI_TEST_LOCAL_POLICY = prevTestLocalPolicy;
  }
}
