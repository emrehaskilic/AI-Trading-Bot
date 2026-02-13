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
