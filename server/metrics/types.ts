import { ExecutionDecision, ExecutionResult } from '../execution/types';
import { ExecQualityLevel } from '../orchestrator/types';

export interface IMetricsCollector {
  recordExecution(decision: ExecutionDecision, result: ExecutionResult): void;
  recordPnL(pnl: number): void;
  recordExecutionLatency(latencyMs: number): void;
  getDailyPnL(): number;
  getInitialCapital(): number;
  getCurrentEquity(): number;
  getLiquidationRisk(): number;
  getExecutionQuality(): ExecQualityLevel;
  getWinRate(): number;
  getTotalTrades(): number;
  getAveragePnLPerTrade(): number;
  getAverageExecutionLatency(): number;
  getTotalFeesPaid(): number;
  getMaxDrawdown(): number;
  getSharpeRatio?(riskFreeRate?: number): number;
  getSortinoRatio?(riskFreeRate?: number): number;
  getVaR?(confidenceLevel?: number): number;
  getCVaR?(confidenceLevel?: number): number;
  resetDailyMetrics(): void;
}
