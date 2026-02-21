import * as path from 'path';
import { RiskGovernor } from '../ai/RiskGovernor';
import { buildAIMetricsSnapshot } from './helpers/aiSnapshot';
import { StateExtractor } from '../ai/StateExtractor';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function runTests() {
  {
    const storePath = path.join(process.cwd(), 'server', 'test', '.tmp', `risk-governor-${Date.now()}-1.json`);
    const governor = new RiskGovernor({ storePath });
    const snapshot = buildAIMetricsSnapshot({
      riskState: {
        equity: 5_000,
        leverage: 10,
        startingMarginUser: 200,
        marginInUse: 200,
        drawdownPct: 0,
        dailyLossLock: false,
        cooldownMsRemaining: 0,
      },
      position: null,
    });
    const deterministicState = new StateExtractor().extract(snapshot);
    const out = governor.apply({
      symbol: snapshot.symbol,
      timestampMs: snapshot.timestampMs,
      policy: { intent: 'ENTER', side: 'LONG', riskMultiplier: 1, confidence: 0.8 },
      deterministicState,
      snapshot,
    });

    assert(out.intent === 'ENTER', 'clean state should allow enter');
    assert(out.sizeMultiplier < 2, 'base sizing should not instantly hit max notional scaling');
  }

  {
    const storePath = path.join(process.cwd(), 'server', 'test', '.tmp', `risk-governor-${Date.now()}-2.json`);
    const governor = new RiskGovernor({ storePath });

    const first = buildAIMetricsSnapshot({
      timestampMs: Date.now(),
      riskState: {
        equity: 10_000,
        leverage: 10,
        startingMarginUser: 200,
        marginInUse: 300,
        drawdownPct: 0,
        dailyLossLock: false,
        cooldownMsRemaining: 0,
      },
    });
    const firstState = new StateExtractor().extract(first);
    governor.apply({
      symbol: first.symbol,
      timestampMs: first.timestampMs,
      policy: { intent: 'HOLD', side: null, riskMultiplier: 0.2, confidence: 0.2 },
      deterministicState: firstState,
      snapshot: first,
    });

    const second = buildAIMetricsSnapshot({
      timestampMs: first.timestampMs + 1000,
      riskState: {
        equity: 9_500,
        leverage: 10,
        startingMarginUser: 200,
        marginInUse: 300,
        drawdownPct: -0.05,
        dailyLossLock: false,
        cooldownMsRemaining: 0,
      },
      position: {
        side: 'LONG',
        qty: 0.2,
        entryPrice: 60_000,
        unrealizedPnlPct: -0.03,
        addsUsed: 1,
        timeInPositionMs: 30_000,
      },
    });
    const secondState = new StateExtractor().extract(second);
    const out = governor.apply({
      symbol: second.symbol,
      timestampMs: second.timestampMs,
      policy: { intent: 'ENTER', side: 'SHORT', riskMultiplier: 1, confidence: 0.9 },
      deterministicState: secondState,
      snapshot: second,
    });

    assert(out.intent === 'REDUCE' || out.intent === 'HOLD', 'daily loss breach must block new risk');
    assert(out.reasons.includes('DAILY_LOSS_CAP'), 'daily loss reason should be emitted');
  }

  {
    const storePath = path.join(process.cwd(), 'server', 'test', '.tmp', `risk-governor-${Date.now()}-3.json`);
    const governor = new RiskGovernor({ storePath });
    const snapshot = buildAIMetricsSnapshot({
      position: {
        side: 'SHORT',
        qty: 0.2,
        entryPrice: 60_000,
        unrealizedPnlPct: -0.01,
        addsUsed: 0,
        timeInPositionMs: 20_000,
      },
      toxicityMetrics: {
        vpinApprox: 0.9,
        signedVolumeRatio: 0.7,
        priceImpactPerSignedNotional: 0.00008,
        tradeToBookRatio: 0.1,
        burstPersistenceScore: 0.9,
      },
    });
    const deterministicState = new StateExtractor().extract(snapshot);
    const out = governor.apply({
      symbol: snapshot.symbol,
      timestampMs: snapshot.timestampMs,
      policy: { intent: 'ADD', side: 'SHORT', riskMultiplier: 1.1, confidence: 0.8 },
      deterministicState,
      snapshot,
    });

    assert(out.intent === 'REDUCE', 'toxic state should force reduce for open position');
    assert(out.reasons.includes('TOXICITY_LIMIT'), 'toxic reason should be emitted');
  }
}
