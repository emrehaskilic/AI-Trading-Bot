import { PerformanceMetrics } from '../metrics/PerformanceCalculator';

export interface ABTestStrategyProfile {
  name: string;
  signalScoreMultiplier?: number;
  signalMinScore?: number;
  leverage?: number;
  initialMarginUsdt?: number;
}

export interface ABTestStartInput {
  symbols: string[];
  walletBalanceStartUsdt: number;
  initialMarginUsdt: number;
  leverage: number;
  heartbeatIntervalMs?: number;
  runId?: string;
  sessionA: ABTestStrategyProfile;
  sessionB: ABTestStrategyProfile;
}

export interface ABTestSessionSnapshot {
  sessionId: string;
  status: 'RUNNING' | 'STOPPED';
  startedAt: number;
  symbols: string[];
  sessionA: ABTestStrategyProfile;
  sessionB: ABTestStrategyProfile;
  performanceA?: PerformanceMetrics;
  performanceB?: PerformanceMetrics;
}

export interface ABTestComparison {
  sessionId: string;
  strategyA: string;
  strategyB: string;
  pnlA: number;
  pnlB: number;
  winRateA: number;
  winRateB: number;
  sharpeA: number;
  sharpeB: number;
  winner: string;
}
