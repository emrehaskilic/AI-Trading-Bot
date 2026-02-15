import { ExecutionDecision, ExecutionResult } from '../execution/types';
import { IPositionManager } from '../position/types';
import { ExecQualityLevel } from '../orchestrator/types';
import { IMetricsCollector } from './types';

export class StrategyMetricsCollector implements IMetricsCollector {
  private readonly initialCapital: number;
  private currentEquity: number;
  private dailyPnL = 0;
  private totalPnL = 0;
  private totalTrades = 0;
  private winningTrades = 0;
  private maxDrawdown = 0;
  private peakEquity: number;

  constructor(initialCapital: number, private readonly positionManager: IPositionManager) {
    this.initialCapital = initialCapital;
    this.currentEquity = initialCapital;
    this.peakEquity = initialCapital;
  }

  recordExecution(_decision: ExecutionDecision, result: ExecutionResult): void {
    if (result.ok) {
      this.totalTrades += 1;
    }
  }

  recordPnL(pnl: number): void {
    this.totalPnL += pnl;
    this.dailyPnL += pnl;
    this.currentEquity = this.positionManager.getAccountBalance();

    if (this.currentEquity > this.peakEquity) {
      this.peakEquity = this.currentEquity;
    } else if (this.peakEquity > 0) {
      const drawdown = (this.peakEquity - this.currentEquity) / this.peakEquity;
      if (drawdown > this.maxDrawdown) {
        this.maxDrawdown = drawdown;
      }
    }

    if (pnl > 0) {
      this.winningTrades += 1;
    }
  }

  getDailyPnL(): number {
    return this.dailyPnL;
  }

  getInitialCapital(): number {
    return this.initialCapital;
  }

  getCurrentEquity(): number {
    return this.currentEquity;
  }

  getTotalTrades(): number {
    return this.totalTrades;
  }

  getMaxDrawdown(): number {
    return this.maxDrawdown;
  }

  getWinRate(): number {
    return this.totalTrades > 0 ? this.winningTrades / this.totalTrades : 0;
  }

  getAveragePnLPerTrade(): number {
    return this.totalTrades > 0 ? this.totalPnL / this.totalTrades : 0;
  }

  getLiquidationRisk(): number {
    return 0;
  }

  getExecutionQuality(): ExecQualityLevel {
    return 'GOOD';
  }

  resetDailyMetrics(): void {
    this.dailyPnL = 0;
  }
}
