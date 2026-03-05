/**
 * Strategy Research Tools Index
 * 
 * Comprehensive testing and research tools for the AI Trading Bot.
 * 
 * Modules:
 * - StrategyResearchHarness: Main backtesting and replay framework
 * - ParameterSweeper: Parameter optimization engine
 * - MetricsCalculator: Performance metrics calculation
 * - ScenarioLoader: Market scenario testing
 */

// Main test harness
export {
  StrategyResearchHarness,
  MarketTick,
  OrderBookSnapshot,
  TradeExecution,
  SimulatedPosition,
  SignalEvent,
  MissedOpportunity,
  BacktestResult,
  PerformanceMetrics,
  StrategyConfig,
  StrategyDecisionLog,
  BacktestConfig,
  defaultStrategyConfig,
  defaultBacktestConfig,
  loadMarketData,
  saveBacktestResult,
  formatMetrics,
} from './strategy_research_harness';

// Parameter sweeper
export {
  ParameterSweeper,
  ParameterDefinition,
  ParameterSpace,
  SweepConfig,
  SweepConstraint,
  SweepProgress,
  SweepResult,
  ParameterSetResult,
  SweepStatistics,
  defaultParameterSpace,
  defaultSweepConfig,
  createParameterSpace,
  exportSweepResultsToCSV,
  formatSweepResult,
} from './ParameterSweeper';

// Metrics calculator
export {
  MetricsCalculator,
  ExtendedMetrics,
  DrawdownAnalysis,
  TradeAnalysis,
  RollingMetrics,
  BenchmarkComparison,
  StatisticalTest,
  MonteCarloResult,
  calculateMetricsFromBacktest,
} from './MetricsCalculator';

// Scenario loader
export {
  ScenarioLoader,
  ScenarioType,
  ScenarioDefinition,
  ScenarioParameters,
  ExpectedBehavior,
  ScenarioTestResult,
  ValidationResult,
  ScenarioSuite,
  StressTestConfig,
  ShockEvent,
  ALL_SCENARIOS,
  TREND_UP_SCENARIO,
  TREND_DOWN_SCENARIO,
  RANGE_BOUND_SCENARIO,
  HIGH_VOLATILITY_SCENARIO,
  LOW_VOLATILITY_SCENARIO,
  LOW_LIQUIDITY_SCENARIO,
  FLASH_CRASH_SCENARIO,
  FLASH_PUMP_SCENARIO,
  CHOPPY_SCENARIO,
  NORMAL_SCENARIO,
  COMPREHENSIVE_SUITE,
  TREND_FOLLOWING_SUITE,
  MEAN_REVERSION_SUITE,
  RISK_MANAGEMENT_SUITE,
  formatScenarioResults,
  createScenario,
  exportScenarioResults,
} from './ScenarioLoader';

// Re-export all types for convenience
export type {
  StrategyConfig,
  BacktestConfig,
  PerformanceMetrics,
  MarketTick,
  TradeExecution,
  SignalEvent,
  BacktestResult,
  ParameterDefinition,
  ParameterSpace,
  SweepConfig,
  SweepResult,
  ScenarioDefinition,
  ScenarioTestResult,
  ExtendedMetrics,
  DrawdownAnalysis,
  TradeAnalysis,
  MonteCarloResult,
};
