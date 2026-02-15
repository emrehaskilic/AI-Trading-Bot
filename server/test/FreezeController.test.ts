import { assessFreezeFromExecQuality, FreezeController } from '../orchestrator/FreezeController';
import { IMetricsCollector } from '../metrics/types';

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

const stubMetrics: IMetricsCollector = {
  recordExecution: () => undefined,
  recordPnL: () => undefined,
  getDailyPnL: () => -10,
  getInitialCapital: () => 100,
  getCurrentEquity: () => 90,
  getLiquidationRisk: () => 0.9,
  getExecutionQuality: () => 'GOOD',
  getWinRate: () => 0,
  getTotalTrades: () => 0,
  getAveragePnLPerTrade: () => 0,
  getMaxDrawdown: () => 0,
  resetDailyMetrics: () => undefined,
};

export function runTests() {
  {
    const result = assessFreezeFromExecQuality('UNKNOWN');
    assert(result.freezeActive, 'UNKNOWN exec quality should freeze');
  }

  {
    const controller = new FreezeController({ maxDailyDrawdownRatio: 0.05, liquidationRiskThreshold: 0.8 });
    const assessment = controller.assessFreeze('GOOD', stubMetrics);
    assert(assessment.freezeActive, 'metrics-based checks should freeze on high liquidation risk or drawdown');
  }
}
