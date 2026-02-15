import { ExecutionDecision, ExecutionResult } from '../execution/types';
import { ExecQualityLevel } from '../orchestrator/types';

export interface IMetricsCollector {
  recordExecution(decision: ExecutionDecision, result: ExecutionResult): void;
  recordPnL(pnl: number): void;
  getDailyPnL(): number;
  getInitialCapital(): number;
  getCurrentEquity(): number;
  getLiquidationRisk(): number;
  getExecutionQuality(): ExecQualityLevel;
  getWinRate(): number;
  getTotalTrades(): number;
  getAveragePnLPerTrade(): number;
  getMaxDrawdown(): number;
  resetDailyMetrics(): void;
}
