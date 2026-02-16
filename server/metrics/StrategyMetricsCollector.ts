import { ExecutionDecision, ExecutionResult } from '../execution/types';
import { IPositionManager } from '../position/types';
import { ExecQualityLevel } from '../orchestrator/types';
import { IMetricsCollector } from './types';
import { calculateCVaR, calculateSharpeRatio, calculateSortinoRatio, calculateVaR } from './MetricsCalculator';

export class StrategyMetricsCollector implements IMetricsCollector {
  private readonly initialCapital: number;
  private currentEquity: number;
  private dailyPnL = 0;
  private totalPnL = 0;
  private totalTrades = 0;
  private winningTrades = 0;
  private maxDrawdown = 0;
  private peakEquity: number;
  private totalFeesPaid = 0;
  private latencySamples: number[] = [];
  private returnSamples: number[] = [];

  constructor(initialCapital: number, private readonly positionManager: IPositionManager) {
    this.initialCapital = initialCapital;
    this.currentEquity = initialCapital;
    this.peakEquity = initialCapital;
  }

  recordExecution(_decision: ExecutionDecision, result: ExecutionResult): void {
    if (result.ok) {
      this.totalTrades += 1;
      this.totalFeesPaid += Number(result.fee || 0);
      if (Number.isFinite(result.latencyMs as number)) {
        this.recordExecutionLatency(Number(result.latencyMs));
      }
    }
  }

  recordPnL(pnl: number): void {
    const equityBefore = this.currentEquity;
    this.totalPnL += pnl;
    this.dailyPnL += pnl;
    this.currentEquity = this.positionManager.getAccountBalance();
    if (equityBefore > 0 && Number.isFinite(equityBefore)) {
      this.returnSamples.push((this.currentEquity - equityBefore) / equityBefore);
      if (this.returnSamples.length > 5000) {
        this.returnSamples.shift();
      }
    }

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

  recordExecutionLatency(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 5000) {
      this.latencySamples.shift();
    }
  }

  getAverageExecutionLatency(): number {
    if (this.latencySamples.length === 0) return 0;
    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    return sum / this.latencySamples.length;
  }

  getTotalFeesPaid(): number {
    return this.totalFeesPaid;
  }

  getSharpeRatio(riskFreeRate = 0): number {
    return calculateSharpeRatio(this.returnSamples, riskFreeRate);
  }

  getSortinoRatio(riskFreeRate = 0): number {
    return calculateSortinoRatio(this.returnSamples, riskFreeRate);
  }

  getVaR(confidenceLevel = 0.95): number {
    return calculateVaR(this.returnSamples, confidenceLevel);
  }

  getCVaR(confidenceLevel = 0.95): number {
    return calculateCVaR(this.returnSamples, confidenceLevel);
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
