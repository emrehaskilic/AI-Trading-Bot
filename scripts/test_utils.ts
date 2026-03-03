export enum RiskState {
  TRACKING = 'TRACKING',
  REDUCED_RISK = 'REDUCED_RISK',
  HALTED = 'HALTED',
  KILL_SWITCH = 'KILL_SWITCH',
}

export enum SignalAction {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT',
  NO_TRADE = 'NO_TRADE',
}

export interface StrategyContext {
  symbol: string;
  timeframe: string;
  timestamp: number;
  riskState: RiskState;
  marketRegime?: string;
  volatility?: number;
}

export interface StrategySignal {
  strategyId: string;
  action: SignalAction;
  confidence: number;
  weight: number;
  validUntil: number;
  veto?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ConsensusConfig {
  minConfidenceThreshold: number;
  minStrategyCount: number;
  quorumThreshold: number;
  useWeightedVoting: boolean;
  defaultAction: SignalAction;
  requireUnanimousVeto: boolean;
}

export interface ConsensusDecision {
  action: SignalAction;
  confidence: number;
  contributingStrategies: string[];
  vetoApplied: boolean;
  timestamp: number;
  reason: string;
}

export interface TestResult {
  testName: string;
  passed: boolean;
  error?: string;
  duration: number;
  details?: Record<string, unknown>;
}

export const TEST_TIMESTAMPS = {
  T0: 1_000_000_000_000,
  T1: 1_000_000_001_000,
  T2: 1_000_000_002_000,
  T3: 1_000_000_003_000,
  EXPIRED: 999_999_999_999,
  FAR_FUTURE: 2_000_000_000_000,
} as const;

export function createMockContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    symbol: 'BTC-USD',
    timeframe: '1m',
    timestamp: TEST_TIMESTAMPS.T0,
    riskState: RiskState.TRACKING,
    marketRegime: 'TRENDING',
    volatility: 0.25,
    ...overrides,
  };
}

export function createMockSignal(overrides: Partial<StrategySignal> = {}): StrategySignal {
  return {
    strategyId: 'strategy-1',
    action: SignalAction.LONG,
    confidence: 0.8,
    weight: 1,
    validUntil: TEST_TIMESTAMPS.FAR_FUTURE,
    veto: false,
    metadata: {},
    ...overrides,
  };
}

export function createMockConfig(overrides: Partial<ConsensusConfig> = {}): ConsensusConfig {
  return {
    minConfidenceThreshold: 0.6,
    minStrategyCount: 2,
    quorumThreshold: 0.51,
    useWeightedVoting: true,
    defaultAction: SignalAction.NO_TRADE,
    requireUnanimousVeto: true,
    ...overrides,
  };
}

export const TEST_SCENARIOS = {
  STRONG_LONG: [
    createMockSignal({ strategyId: 'trend-follower', action: SignalAction.LONG, confidence: 0.85 }),
    createMockSignal({ strategyId: 'momentum', action: SignalAction.LONG, confidence: 0.8 }),
    createMockSignal({ strategyId: 'breakout', action: SignalAction.LONG, confidence: 0.75 }),
  ],
  STRONG_SHORT: [
    createMockSignal({ strategyId: 'trend-follower', action: SignalAction.SHORT, confidence: 0.85 }),
    createMockSignal({ strategyId: 'momentum', action: SignalAction.SHORT, confidence: 0.8 }),
    createMockSignal({ strategyId: 'breakout', action: SignalAction.SHORT, confidence: 0.75 }),
  ],
  MIXED: [
    createMockSignal({ strategyId: 'trend-follower', action: SignalAction.LONG, confidence: 0.7 }),
    createMockSignal({ strategyId: 'momentum', action: SignalAction.SHORT, confidence: 0.65 }),
    createMockSignal({ strategyId: 'breakout', action: SignalAction.FLAT, confidence: 0.5 }),
  ],
  ALL_FLAT: [
    createMockSignal({ strategyId: 'trend-follower', action: SignalAction.FLAT, confidence: 0.6 }),
    createMockSignal({ strategyId: 'momentum', action: SignalAction.FLAT, confidence: 0.55 }),
    createMockSignal({ strategyId: 'breakout', action: SignalAction.FLAT, confidence: 0.5 }),
  ],
  ALL_EXPIRED: [
    createMockSignal({ strategyId: 'trend-follower', action: SignalAction.LONG, confidence: 0.8, validUntil: TEST_TIMESTAMPS.EXPIRED }),
    createMockSignal({ strategyId: 'momentum', action: SignalAction.LONG, confidence: 0.75, validUntil: TEST_TIMESTAMPS.EXPIRED }),
    createMockSignal({ strategyId: 'breakout', action: SignalAction.LONG, confidence: 0.7, validUntil: TEST_TIMESTAMPS.EXPIRED }),
  ],
} as const;

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

export function assertTrue(value: boolean, message?: string): void {
  if (!value) {
    throw new Error(message || 'expected true');
  }
}

export function assertFalse(value: boolean, message?: string): void {
  if (value) {
    throw new Error(message || 'expected false');
  }
}

export function assertGreaterThan(actual: number, expected: number, message?: string): void {
  if (!(actual > expected)) {
    throw new Error(message || `expected ${actual} > ${expected}`);
  }
}

export function assertArrayLength(array: unknown[], expectedLength: number, message?: string): void {
  if (array.length !== expectedLength) {
    throw new Error(message || `expected length ${expectedLength}, actual ${array.length}`);
  }
}

export function verifyDeterminism<T>(fn: () => T, iterations = 10): { isDeterministic: boolean; results: T[] } {
  const results: T[] = [];
  for (let i = 0; i < iterations; i += 1) {
    results.push(fn());
  }
  const head = JSON.stringify(results[0]);
  const isDeterministic = results.every((r) => JSON.stringify(r) === head);
  return { isDeterministic, results };
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function measureTime<T>(fn: () => T): { result: T; duration: number } {
  const start = Date.now();
  const result = fn();
  return { result, duration: Date.now() - start };
}
