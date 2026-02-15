export interface MonteCarloConfig {
  runs: number;
  seed?: number;
  windowSize?: number;
}

export interface MonteCarloResult {
  runId: number;
  totalPnL: number;
  maxDrawdown: number;
  sharpeRatio: number;
  pValue?: number;
  confidenceInterval?: { lower: number; upper: number };
  riskOfRuin?: number;
  baselineSharpe?: number;
}

export interface WalkForwardConfig {
  windowSize: number; // number of return samples
  stepSize: number;
  thresholdRange: { min: number; max: number; step: number };
}

export interface WalkForwardReport {
  windowId: number;
  inSampleSharpe: number;
  outSampleSharpe: number;
  optimalThreshold: number;
  overfittingDetected: boolean;
}

export interface RegimePerformanceReport {
  regime: string;
  totalPnL: number;
  maxDrawdown: number;
  winRate: number;
  avgPnL: number;
  sharpeRatio: number;
}
