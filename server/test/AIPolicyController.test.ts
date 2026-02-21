import { AIDryRunController } from '../ai/AIDryRunController';
import { buildAIMetricsSnapshot } from './helpers/aiSnapshot';
import { StrategyDecision } from '../types/strategy';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export async function runTests() {
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
    localOnly: true,
    decisionIntervalMs: 100,
    temperature: 0,
    maxOutputTokens: 64,
  });

  const snapshot = buildAIMetricsSnapshot({
    symbol: 'BTCUSDT',
    timestampMs: Date.now(),
    market: { deltaZ: 2.4, cvdSlope: 70_000, obiDeep: 0.55, spreadPct: 0.0005 },
    openInterest: { oiChangePct: 0.5 },
    volatility: 105,
  });

  await controller.onMetrics(snapshot);

  assert(decisions.length > 0, 'controller should emit a decision');
  const latest = decisions[decisions.length - 1];
  assert(latest.actions.length > 0, 'decision should contain actions');
  assert(latest.actions[0].type === 'NOOP', 'llm unavailable must resolve to HOLD/NOOP');
  controller.stop();
}
