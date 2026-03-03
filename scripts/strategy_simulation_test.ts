import {
  RiskState,
  SignalAction,
  StrategyContext,
  StrategySignal,
  ConsensusConfig,
  ConsensusDecision,
  TestResult,
  TEST_TIMESTAMPS,
  TEST_SCENARIOS,
  createMockContext,
  createMockSignal,
  createMockConfig,
  assertEquals,
  assertTrue,
  assertFalse,
  assertGreaterThan,
  assertArrayLength,
  verifyDeterminism,
  deepClone,
} from './test_utils.ts';

export function calculateConsensus(
  signals: StrategySignal[],
  context: StrategyContext,
  config: ConsensusConfig
): ConsensusDecision {
  const currentTime = context.timestamp;

  if (context.riskState === RiskState.HALTED || context.riskState === RiskState.KILL_SWITCH) {
    return {
      action: SignalAction.NO_TRADE,
      confidence: 0,
      contributingStrategies: [],
      vetoApplied: false,
      timestamp: currentTime,
      reason: `Trading blocked by risk state: ${context.riskState}`,
    };
  }

  const nonExpired = signals.filter((s) => s.validUntil > currentTime);
  const qualified = nonExpired.filter((s) => s.confidence >= config.minConfidenceThreshold);

  if (qualified.length < config.minStrategyCount) {
    return {
      action: SignalAction.NO_TRADE,
      confidence: 0,
      contributingStrategies: [],
      vetoApplied: false,
      timestamp: currentTime,
      reason: `Insufficient qualified strategies: ${qualified.length} < ${config.minStrategyCount}`,
    };
  }

  const vetoSignals = qualified.filter((s) => s.veto === true);
  if (vetoSignals.length > 0 && config.requireUnanimousVeto) {
    const veto = vetoSignals[0];
    return {
      action: veto.action,
      confidence: veto.confidence,
      contributingStrategies: [veto.strategyId],
      vetoApplied: true,
      timestamp: currentTime,
      reason: `Veto applied by ${veto.strategyId}`,
    };
  }

  const tallies: Record<SignalAction, { weight: number; strategies: string[] }> = {
    [SignalAction.LONG]: { weight: 0, strategies: [] },
    [SignalAction.SHORT]: { weight: 0, strategies: [] },
    [SignalAction.FLAT]: { weight: 0, strategies: [] },
    [SignalAction.NO_TRADE]: { weight: 0, strategies: [] },
  };

  for (const signal of qualified) {
    const voteWeight = config.useWeightedVoting ? signal.confidence * signal.weight : signal.weight;
    tallies[signal.action].weight += voteWeight;
    tallies[signal.action].strategies.push(signal.strategyId);
  }

  const totalWeight = qualified.reduce(
    (sum, s) => sum + (config.useWeightedVoting ? s.confidence * s.weight : s.weight),
    0
  );

  let winningAction = config.defaultAction;
  let winningWeight = 0;
  let winningStrategies: string[] = [];

  for (const action of [SignalAction.LONG, SignalAction.SHORT, SignalAction.FLAT]) {
    const bucket = tallies[action];
    if (bucket.weight > winningWeight) {
      winningAction = action;
      winningWeight = bucket.weight;
      winningStrategies = bucket.strategies;
    }
  }

  const quorum = totalWeight > 0 ? (winningWeight / totalWeight) : 0;
  if (quorum < config.quorumThreshold) {
    return {
      action: SignalAction.NO_TRADE,
      confidence: quorum,
      contributingStrategies: winningStrategies,
      vetoApplied: false,
      timestamp: currentTime,
      reason: `Quorum not met: ${(quorum * 100).toFixed(1)}% < ${(config.quorumThreshold * 100).toFixed(1)}%`,
    };
  }

  return {
    action: winningAction,
    confidence: quorum,
    contributingStrategies: winningStrategies,
    vetoApplied: false,
    timestamp: currentTime,
    reason: `Consensus reached with ${winningStrategies.length} strategies`,
  };
}

function runTest(name: string, fn: () => void): TestResult {
  const start = Date.now();
  try {
    fn();
    return { testName: name, passed: true, duration: Date.now() - start };
  } catch (error) {
    return {
      testName: name,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function testQuorumLong(): TestResult {
  return runTest('testQuorumLong', () => {
    const decision = calculateConsensus(deepClone(TEST_SCENARIOS.STRONG_LONG), createMockContext(), createMockConfig());
    assertEquals(decision.action, SignalAction.LONG);
    assertArrayLength(decision.contributingStrategies, 3);
    assertGreaterThan(decision.confidence, 0);
    assertFalse(decision.vetoApplied);
  });
}

export function testConflictResolution(): TestResult {
  return runTest('testConflictResolution', () => {
    const signals: StrategySignal[] = [
      createMockSignal({ strategyId: 'trend-follower', action: SignalAction.LONG, confidence: 0.75 }),
      createMockSignal({ strategyId: 'momentum', action: SignalAction.SHORT, confidence: 0.65 }),
      createMockSignal({ strategyId: 'breakout', action: SignalAction.FLAT, confidence: 0.5 }),
    ];
    const decision = calculateConsensus(signals, createMockContext(), createMockConfig());
    assertEquals(decision.action, SignalAction.LONG);
    assertTrue(decision.contributingStrategies.includes('trend-follower'));
  });
}

export function testConfidenceThreshold(): TestResult {
  return runTest('testConfidenceThreshold', () => {
    const signals: StrategySignal[] = [
      createMockSignal({ strategyId: 's1', action: SignalAction.LONG, confidence: 0.5 }),
      createMockSignal({ strategyId: 's2', action: SignalAction.LONG, confidence: 0.6 }),
      createMockSignal({ strategyId: 's3', action: SignalAction.LONG, confidence: 0.65 }),
    ];
    const decision = calculateConsensus(signals, createMockContext(), createMockConfig({ minConfidenceThreshold: 0.7 }));
    assertEquals(decision.action, SignalAction.NO_TRADE);
    assertTrue(decision.reason.includes('Insufficient'));
  });
}

export function testRiskStateHalted(): TestResult {
  return runTest('testRiskStateHalted', () => {
    const context = createMockContext({ riskState: RiskState.HALTED });
    const decision = calculateConsensus(deepClone(TEST_SCENARIOS.STRONG_LONG), context, createMockConfig());
    assertEquals(decision.action, SignalAction.NO_TRADE);
    assertTrue(decision.reason.includes('HALTED'));
    assertArrayLength(decision.contributingStrategies, 0);
  });
}

export function testTTLExpiration(): TestResult {
  return runTest('testTTLExpiration', () => {
    const context = createMockContext({ timestamp: TEST_TIMESTAMPS.T0 });
    const signals: StrategySignal[] = [
      createMockSignal({ strategyId: 'valid-1', action: SignalAction.LONG, confidence: 0.8, validUntil: TEST_TIMESTAMPS.FAR_FUTURE }),
      createMockSignal({ strategyId: 'expired-1', action: SignalAction.LONG, confidence: 0.9, validUntil: TEST_TIMESTAMPS.EXPIRED }),
      createMockSignal({ strategyId: 'valid-2', action: SignalAction.LONG, confidence: 0.75, validUntil: TEST_TIMESTAMPS.FAR_FUTURE }),
    ];
    const decision = calculateConsensus(signals, context, createMockConfig());
    assertEquals(decision.action, SignalAction.LONG);
    assertFalse(decision.contributingStrategies.includes('expired-1'));
    assertArrayLength(decision.contributingStrategies, 2);
  });
}

export function testDeterminism(): TestResult {
  return runTest('testDeterminism', () => {
    const context = createMockContext();
    const config = createMockConfig();
    const signals = deepClone(TEST_SCENARIOS.MIXED);
    const { isDeterministic } = verifyDeterminism(() => calculateConsensus(deepClone(signals), context, config), 20);
    assertTrue(isDeterministic);
  });
}

export function testVetoRule(): TestResult {
  return runTest('testVetoRule', () => {
    const signals: StrategySignal[] = [
      createMockSignal({ strategyId: 'chop-filter', action: SignalAction.FLAT, confidence: 0.8, veto: true }),
      createMockSignal({ strategyId: 'trend-follower', action: SignalAction.LONG, confidence: 0.9 }),
      createMockSignal({ strategyId: 'momentum', action: SignalAction.LONG, confidence: 0.85 }),
    ];
    const decision = calculateConsensus(signals, createMockContext(), createMockConfig());
    assertEquals(decision.action, SignalAction.FLAT);
    assertTrue(decision.vetoApplied);
    assertArrayLength(decision.contributingStrategies, 1);
    assertEquals(decision.contributingStrategies[0], 'chop-filter');
  });
}

export function testMinStrategyCount(): TestResult {
  return runTest('testMinStrategyCount', () => {
    const signals: StrategySignal[] = [
      createMockSignal({ strategyId: 's1', action: SignalAction.LONG, confidence: 0.8 }),
      createMockSignal({ strategyId: 's2', action: SignalAction.LONG, confidence: 0.75 }),
    ];
    const decision = calculateConsensus(signals, createMockContext(), createMockConfig({ minStrategyCount: 3 }));
    assertEquals(decision.action, SignalAction.NO_TRADE);
    assertTrue(decision.reason.includes('Insufficient'));
  });
}

export function testWeightedVoting(): TestResult {
  return runTest('testWeightedVoting', () => {
    const context = createMockContext();
    const signals: StrategySignal[] = [
      createMockSignal({ strategyId: 'high-conf', action: SignalAction.LONG, confidence: 0.9, weight: 1 }),
      createMockSignal({ strategyId: 'low-conf', action: SignalAction.SHORT, confidence: 0.5, weight: 1 }),
    ];

    const weightedDecision = calculateConsensus(signals, context, createMockConfig({
      useWeightedVoting: true,
      minConfidenceThreshold: 0.5,
      minStrategyCount: 1,
      quorumThreshold: 0.5,
    }));
    assertEquals(weightedDecision.action, SignalAction.LONG);

    const unweightedDecision = calculateConsensus(signals, context, createMockConfig({
      useWeightedVoting: false,
      minConfidenceThreshold: 0.5,
      minStrategyCount: 1,
      quorumThreshold: 0.5,
    }));
    assertTrue(unweightedDecision.action === SignalAction.LONG || unweightedDecision.action === SignalAction.SHORT);
  });
}

export function testAllFlat(): TestResult {
  return runTest('testAllFlat', () => {
    const decision = calculateConsensus(
      deepClone(TEST_SCENARIOS.ALL_FLAT),
      createMockContext(),
      createMockConfig({
        minConfidenceThreshold: 0.5,
        minStrategyCount: 3,
      })
    );
    assertEquals(decision.action, SignalAction.FLAT);
    assertArrayLength(decision.contributingStrategies, 3);
    assertFalse(decision.vetoApplied);
  });
}

export function testRiskStateKillSwitch(): TestResult {
  return runTest('testRiskStateKillSwitch', () => {
    const context = createMockContext({ riskState: RiskState.KILL_SWITCH });
    const decision = calculateConsensus(deepClone(TEST_SCENARIOS.STRONG_LONG), context, createMockConfig());
    assertEquals(decision.action, SignalAction.NO_TRADE);
    assertTrue(decision.reason.includes('KILL_SWITCH'));
  });
}

export function testEmptySignals(): TestResult {
  return runTest('testEmptySignals', () => {
    const decision = calculateConsensus([], createMockContext(), createMockConfig());
    assertEquals(decision.action, SignalAction.NO_TRADE);
  });
}

export function testAllSignalsExpired(): TestResult {
  return runTest('testAllSignalsExpired', () => {
    const decision = calculateConsensus(deepClone(TEST_SCENARIOS.ALL_EXPIRED), createMockContext(), createMockConfig());
    assertEquals(decision.action, SignalAction.NO_TRADE);
  });
}

export const ALL_TESTS = [
  testQuorumLong,
  testConflictResolution,
  testConfidenceThreshold,
  testRiskStateHalted,
  testTTLExpiration,
  testDeterminism,
  testVetoRule,
  testMinStrategyCount,
  testWeightedVoting,
  testAllFlat,
  testRiskStateKillSwitch,
  testEmptySignals,
  testAllSignalsExpired,
];
