/**
 * Strategy Research Test Harness - Usage Examples
 * 
 * This file demonstrates how to use the test harness components
 * for backtesting, parameter optimization, and scenario testing.
 */

import {
  // Test Harness
  StrategyResearchHarness,
  MarketTick,
  BacktestResult,
  loadMarketData,
  saveBacktestResult,
  formatMetrics,
  
  // Parameter Sweeper
  ParameterSweeper,
  SweepConfig,
  SweepResult,
  exportSweepResultsToCSV,
  formatSweepResult,
  
  // Metrics Calculator
  MetricsCalculator,
  ExtendedMetrics,
  calculateMetricsFromBacktest,
  
  // Scenario Loader
  ScenarioLoader,
  ScenarioDefinition,
  ScenarioTestResult,
  ALL_SCENARIOS,
  TREND_UP_SCENARIO,
  RANGE_BOUND_SCENARIO,
  FLASH_CRASH_SCENARIO,
  COMPREHENSIVE_SUITE,
  formatScenarioResults,
  createScenario,
} from './index';

// ============================================================================
// EXAMPLE 1: Basic Backtest
// ============================================================================

/**
 * Run a basic backtest with default parameters
 */
export async function example1_BasicBacktest(): Promise<void> {
  console.log('=== Example 1: Basic Backtest ===\n');

  // Load historical market data
  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');

  // Create test harness with default configuration
  const harness = new StrategyResearchHarness(
    {
      symbol: 'BTC-USD',
      initialEquity: 100000,
      positionSize: 0.1,
      leverage: 1,
      makerFee: 0.0002,
      takerFee: 0.0005,
      slippageModel: 'fixed',
      slippageBps: 5,
      recordSignals: true,
      recordMissedOpportunities: true,
      recordDecisionLogs: true,
    },
    {
      // Strategy configuration
      dfsEntryLongBase: 0.85,
      dfsEntryShortBase: 0.15,
      cooldownFlipS: 30,
      hardRevDfsP: 0.15,
    }
  );

  // Run backtest
  const result = await harness.runBacktest(ticks);

  // Display results
  console.log(formatMetrics(result.metrics));
  console.log(`\nTotal trades: ${result.trades.length}`);
  console.log(`Signals recorded: ${result.signals.length}`);
  console.log(`Missed opportunities: ${result.missedOpportunities.length}`);

  // Save results
  saveBacktestResult(result, './results/basic_backtest.json');
}

// ============================================================================
// EXAMPLE 2: Parameter Sweep
// ============================================================================

/**
 * Run a parameter optimization sweep
 */
export async function example2_ParameterSweep(): Promise<void> {
  console.log('=== Example 2: Parameter Sweep ===\n');

  // Load market data
  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');

  // Define sweep configuration
  const sweepConfig: SweepConfig = {
    method: 'random',
    maxIterations: 100,
    maxParallel: 4,
    objectiveMetric: 'composite',
    objectiveDirection: 'maximize',
    compositeWeights: {
      netProfit: 0.4,
      sharpeRatio: 0.3,
      winRate: 0.2,
      maxDrawdownPct: -0.1,
    },
    constraints: [
      { metric: 'maxDrawdownPct', operator: '<', value: 20 },
      { metric: 'totalTrades', operator: '>=', value: 20 },
      { metric: 'sharpeRatio', operator: '>', value: 0.5 },
    ],
    earlyStopping: {
      enabled: true,
      patience: 20,
      minImprovement: 0.01,
    },
    onProgress: (progress) => {
      console.log(
        `Progress: ${progress.currentIteration}/${progress.totalIterations} ` +
        `| Best: ${progress.bestScore.toFixed(4)} ` +
        `| ETA: ${(progress.estimatedRemainingMs / 1000).toFixed(0)}s`
      );
    },
  };

  // Create parameter space
  const parameterSpace = {
    parameters: [
      { name: 'dfsEntryLongBase', type: 'float' as const, min: 0.7, max: 0.95, step: 0.05 },
      { name: 'dfsEntryShortBase', type: 'float' as const, min: 0.05, max: 0.3, step: 0.05 },
      { name: 'cooldownFlipS', type: 'int' as const, min: 10, max: 60, step: 5 },
      { name: 'hardRevDfsP', type: 'float' as const, min: 0.05, max: 0.3, step: 0.05 },
      { name: 'hardRevTicks', type: 'int' as const, min: 3, max: 10, step: 1 },
    ],
  };

  // Create sweeper and run
  const sweeper = new ParameterSweeper(parameterSpace, sweepConfig, ticks);
  const result = await sweeper.runSweep();

  // Display results
  console.log(formatSweepResult(result));

  // Export to CSV
  exportSweepResultsToCSV(result, './results/parameter_sweep.csv');

  // Use best parameters
  if (result.bestResult) {
    console.log('\nBest parameters found:');
    console.log(JSON.stringify(result.bestResult.parameters, null, 2));
  }
}

// ============================================================================
// EXAMPLE 3: Grid Search
// ============================================================================

/**
 * Run a comprehensive grid search
 */
export async function example3_GridSearch(): Promise<void> {
  console.log('=== Example 3: Grid Search ===\n');

  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');

  const sweepConfig: SweepConfig = {
    method: 'grid',
    maxIterations: 1000,
    maxParallel: 4,
    objectiveMetric: 'sharpeRatio',
    objectiveDirection: 'maximize',
    constraints: [
      { metric: 'maxDrawdownPct', operator: '<', value: 15 },
    ],
  };

  const parameterSpace = {
    parameters: [
      { name: 'dfsEntryLongBase', type: 'float' as const, min: 0.75, max: 0.9, step: 0.05 },
      { name: 'dfsEntryShortBase', type: 'float' as const, min: 0.1, max: 0.25, step: 0.05 },
      { name: 'cooldownFlipS', type: 'int' as const, min: 20, max: 40, step: 10 },
    ],
  };

  const sweeper = new ParameterSweeper(parameterSpace, sweepConfig, ticks);
  const result = await sweeper.runSweep();

  console.log(formatSweepResult(result));
}

// ============================================================================
// EXAMPLE 4: Genetic Algorithm Optimization
// ============================================================================

/**
 * Run genetic algorithm optimization
 */
export async function example4_GeneticOptimization(): Promise<void> {
  console.log('=== Example 4: Genetic Algorithm Optimization ===\n');

  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');

  const sweepConfig: SweepConfig = {
    method: 'genetic',
    maxIterations: 500,
    maxParallel: 4,
    populationSize: 30,
    mutationRate: 0.1,
    crossoverRate: 0.8,
    elitismCount: 5,
    objectiveMetric: 'netProfit',
    objectiveDirection: 'maximize',
    constraints: [
      { metric: 'maxDrawdownPct', operator: '<', value: 20 },
      { metric: 'totalTrades', operator: '>=', value: 30 },
    ],
  };

  const parameterSpace = {
    parameters: [
      { name: 'dfsEntryLongBase', type: 'float' as const, min: 0.7, max: 0.95, step: 0.01 },
      { name: 'dfsEntryShortBase', type: 'float' as const, min: 0.05, max: 0.3, step: 0.01 },
      { name: 'dfsBreakLongBase', type: 'float' as const, min: 0.15, max: 0.4, step: 0.01 },
      { name: 'dfsBreakShortBase', type: 'float' as const, min: 0.6, max: 0.85, step: 0.01 },
      { name: 'cooldownFlipS', type: 'int' as const, min: 10, max: 60, step: 1 },
      { name: 'cooldownSameS', type: 'int' as const, min: 5, max: 30, step: 1 },
      { name: 'hardRevDfsP', type: 'float' as const, min: 0.05, max: 0.3, step: 0.01 },
      { name: 'hardRevTicks', type: 'int' as const, min: 3, max: 10, step: 1 },
    ],
  };

  const sweeper = new ParameterSweeper(parameterSpace, sweepConfig, ticks);
  const result = await sweeper.runSweep();

  console.log(formatSweepResult(result));
}

// ============================================================================
// EXAMPLE 5: Scenario Testing
// ============================================================================

/**
 * Run scenario-based testing
 */
export async function example5_ScenarioTesting(): Promise<void> {
  console.log('=== Example 5: Scenario Testing ===\n');

  // Create harness
  const harness = new StrategyResearchHarness(
    { initialEquity: 100000, positionSize: 0.1 },
    { dfsEntryLongBase: 0.85, dfsEntryShortBase: 0.15 }
  );

  // Create scenario loader
  const scenarioLoader = new ScenarioLoader(harness);

  // Run all predefined scenarios
  const results = await scenarioLoader.runAllScenarios();

  // Display results
  console.log(formatScenarioResults(results));

  // Analyze specific scenarios
  const flashCrashResult = results.find(r => r.scenario.type === 'flash_crash');
  if (flashCrashResult) {
    console.log('\n=== Flash Crash Analysis ===');
    console.log(`Trades during crash: ${flashCrashResult.backtestResult.metrics.totalTrades}`);
    console.log(`Max drawdown: ${flashCrashResult.backtestResult.metrics.maxDrawdownPct.toFixed(2)}%`);
    console.log(`Passed: ${flashCrashResult.passed}`);
  }
}

// ============================================================================
// EXAMPLE 6: Custom Scenario
// ============================================================================

/**
 * Create and test a custom scenario
 */
export async function example6_CustomScenario(): Promise<void> {
  console.log('=== Example 6: Custom Scenario ===\n');

  // Define custom scenario
  const customScenario: ScenarioDefinition = createScenario(
    'Bitcoin Halving Event',
    'news_event',
    {
      priceTrend: 0.5,
      priceVolatility: 0.7,
      volumeLevel: 0.9,
      volumeSpikes: true,
      burstFrequency: 0.5,
      burstSize: 15,
      burstDirection: 'buy',
      includeGaps: true,
      gapProbability: 0.2,
    },
    48 // 48 hours
  );

  // Create harness and loader
  const harness = new StrategyResearchHarness();
  const scenarioLoader = new ScenarioLoader(harness);

  // Register and run custom scenario
  scenarioLoader.registerScenario(customScenario);
  const result = await scenarioLoader.runScenarioTest(customScenario);

  console.log(`Scenario: ${result.scenario.name}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Score: ${result.score.toFixed(2)}`);
  console.log(`\nValidation Results:`);
  for (const validation of result.validationResults) {
    console.log(`  ${validation.check}: ${validation.passed ? '✓' : '✗'} ${validation.actual}`);
  }
}

// ============================================================================
// EXAMPLE 7: Advanced Metrics
// ============================================================================

/**
 * Calculate advanced metrics
 */
export async function example7_AdvancedMetrics(): Promise<void> {
  console.log('=== Example 7: Advanced Metrics ===\n');

  // Run backtest
  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');
  const harness = new StrategyResearchHarness();
  const result = await harness.runBacktest(ticks);

  // Calculate extended metrics
  const calculator = new MetricsCalculator(
    result.trades,
    result.equityCurve,
    100000
  );

  const extendedMetrics = calculator.calculateExtendedMetrics();

  console.log('=== Extended Metrics ===');
  console.log(`Annualized Return: ${extendedMetrics.annualizedReturn.toFixed(2)}%`);
  console.log(`Annualized Volatility: ${extendedMetrics.annualizedVolatility.toFixed(2)}%`);
  console.log(`VaR (95%): ${extendedMetrics.valueAtRisk95.toFixed(2)}%`);
  console.log(`VaR (99%): ${extendedMetrics.valueAtRisk99.toFixed(2)}%`);
  console.log(`Return Skewness: ${extendedMetrics.returnSkewness.toFixed(2)}`);
  console.log(`Return Kurtosis: ${extendedMetrics.returnKurtosis.toFixed(2)}`);
  console.log(`Robustness Score: ${extendedMetrics.robustnessScore.toFixed(1)}`);
  console.log(`Consistency Score: ${extendedMetrics.consistencyScore.toFixed(1)}%`);

  // Drawdown analysis
  const drawdownAnalysis = calculator.analyzeDrawdowns();
  console.log('\n=== Drawdown Analysis ===');
  console.log(`Max Drawdown: $${drawdownAnalysis.maxDrawdown.toFixed(2)} (${drawdownAnalysis.maxDrawdownPct.toFixed(2)}%)`);
  console.log(`Avg Drawdown: $${drawdownAnalysis.avgDrawdown.toFixed(2)}`);
  console.log(`Avg Duration: ${(drawdownAnalysis.avgDrawdownDuration / 3600000).toFixed(1)} hours`);
  console.log(`Current Drawdown: $${drawdownAnalysis.currentDrawdown.toFixed(2)}`);
  console.log(`In Drawdown: ${drawdownAnalysis.isInDrawdown}`);

  // Trade analysis
  const tradeAnalysis = calculator.analyzeTrades();
  console.log('\n=== Trade Analysis ===');
  console.log('Trade Distribution:');
  for (const bucket of tradeAnalysis.tradeDistribution) {
    console.log(`  ${bucket.bucket}: ${bucket.count} trades, $${bucket.totalPnl.toFixed(2)}`);
  }

  // Rolling metrics
  const rollingMetrics = calculator.calculateRollingMetrics(30);
  console.log('\n=== Rolling Metrics (30-period) ===');
  const lastMetric = rollingMetrics.metrics[rollingMetrics.metrics.length - 1];
  console.log(`Latest Sharpe: ${lastMetric.sharpe.toFixed(2)}`);
  console.log(`Latest Win Rate: ${lastMetric.winRate.toFixed(2)}%`);
  console.log(`Latest Drawdown: $${lastMetric.drawdown.toFixed(2)}`);
}

// ============================================================================
// EXAMPLE 8: Monte Carlo Simulation
// ============================================================================

/**
 * Run Monte Carlo simulation
 */
export async function example8_MonteCarlo(): Promise<void> {
  console.log('=== Example 8: Monte Carlo Simulation ===\n');

  // Run backtest first
  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');
  const harness = new StrategyResearchHarness();
  const result = await harness.runBacktest(ticks);

  // Run Monte Carlo
  const calculator = new MetricsCalculator(
    result.trades,
    result.equityCurve,
    100000
  );

  const mcResult = calculator.runMonteCarlo(1000, 0.95, 0.1);

  console.log('=== Monte Carlo Results ===');
  console.log(`Iterations: ${mcResult.iterations}`);
  console.log(`Confidence Level: ${mcResult.confidenceLevel * 100}%`);
  console.log('\nWorst Case:');
  console.log(`  Return: ${(mcResult.worstCase.return * 100).toFixed(2)}%`);
  console.log(`  Max DD: $${mcResult.worstCase.maxDrawdown.toFixed(2)}`);
  console.log(`  Win Rate: ${mcResult.worstCase.winRate.toFixed(2)}%`);
  console.log('\nMedian Case:');
  console.log(`  Return: ${(mcResult.medianCase.return * 100).toFixed(2)}%`);
  console.log(`  Max DD: $${mcResult.medianCase.maxDrawdown.toFixed(2)}`);
  console.log(`  Win Rate: ${mcResult.medianCase.winRate.toFixed(2)}%`);
  console.log('\nBest Case:');
  console.log(`  Return: ${(mcResult.bestCase.return * 100).toFixed(2)}%`);
  console.log(`  Max DD: $${mcResult.bestCase.maxDrawdown.toFixed(2)}`);
  console.log(`  Win Rate: ${mcResult.bestCase.winRate.toFixed(2)}%`);
  console.log('\n95% Confidence Interval:');
  console.log(`  Lower Return: ${(mcResult.confidenceInterval.lower.return * 100).toFixed(2)}%`);
  console.log(`  Upper Return: ${(mcResult.confidenceInterval.upper.return * 100).toFixed(2)}%`);
  console.log(`\nProbability of Profit: ${mcResult.probabilityOfProfit.toFixed(2)}%`);
  console.log(`Probability of 10%+ Return: ${mcResult.probabilityOfTargetReturn.toFixed(2)}%`);
  console.log(`Value at Risk (95%): ${(mcResult.valueAtRisk * 100).toFixed(2)}%`);
  console.log(`Expected Shortfall: ${(mcResult.expectedShortfall * 100).toFixed(2)}%`);
}

// ============================================================================
// EXAMPLE 9: Statistical Tests
// ============================================================================

/**
 * Run statistical significance tests
 */
export async function example9_StatisticalTests(): Promise<void> {
  console.log('=== Example 9: Statistical Tests ===\n');

  // Run backtest
  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');
  const harness = new StrategyResearchHarness();
  const result = await harness.runBacktest(ticks);

  // Run tests
  const calculator = new MetricsCalculator(
    result.trades,
    result.equityCurve,
    100000
  );

  const tests = calculator.runStatisticalTests();

  console.log('=== Statistical Tests ===');
  for (const test of tests) {
    console.log(`\n${test.name}:`);
    console.log(`  Statistic: ${test.statistic.toFixed(4)}`);
    console.log(`  P-value: ${test.pValue.toFixed(4)}`);
    console.log(`  Significant: ${test.isSignificant ? 'Yes' : 'No'}`);
    console.log(`  Interpretation: ${test.interpretation}`);
  }
}

// ============================================================================
// EXAMPLE 10: Stress Testing
// ============================================================================

/**
 * Run stress tests with random shocks
 */
export async function example10_StressTesting(): Promise<void> {
  console.log('=== Example 10: Stress Testing ===\n');

  const harness = new StrategyResearchHarness();
  const scenarioLoader = new ScenarioLoader(harness);

  const stressConfig = {
    iterations: 50,
    parameterVariations: 10,
    shockEvents: [
      { type: 'price_shock' as const, magnitude: 0.5, durationMs: 60000, probability: 0.1 },
      { type: 'liquidity_shock' as const, magnitude: 1.0, durationMs: 300000, probability: 0.05 },
      { type: 'volatility_shock' as const, magnitude: 0.8, durationMs: 120000, probability: 0.08 },
      { type: 'orderflow_shock' as const, magnitude: 0.6, durationMs: 60000, probability: 0.1 },
    ],
    concurrentScenarios: false,
  };

  const results = await scenarioLoader.runStressTest(stressConfig);

  // Analyze stress test results
  const passedCount = results.filter(r => r.passed).length;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const avgDrawdown = results.reduce((sum, r) => sum + r.backtestResult.metrics.maxDrawdownPct, 0) / results.length;

  console.log('=== Stress Test Results ===');
  console.log(`Iterations: ${results.length}`);
  console.log(`Passed: ${passedCount} (${((passedCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`Average Score: ${avgScore.toFixed(2)}`);
  console.log(`Average Max Drawdown: ${avgDrawdown.toFixed(2)}%`);

  // Find worst case
  const worstCase = results.reduce((worst, r) =>
    r.backtestResult.metrics.maxDrawdownPct > worst.backtestResult.metrics.maxDrawdownPct ? r : worst
  );

  console.log('\nWorst Case Scenario:');
  console.log(`  Max Drawdown: ${worstCase.backtestResult.metrics.maxDrawdownPct.toFixed(2)}%`);
  console.log(`  Net Profit: $${worstCase.backtestResult.metrics.netProfit.toFixed(2)}`);
  console.log(`  Score: ${worstCase.score.toFixed(2)}`);
}

// ============================================================================
// EXAMPLE 11: Walk-Forward Analysis
// ============================================================================

/**
 * Run walk-forward analysis
 */
export async function example11_WalkForwardAnalysis(): Promise<void> {
  console.log('=== Example 11: Walk-Forward Analysis ===\n');

  const ticks: MarketTick[] = loadMarketData('./data/btc_usd_1s.json');

  // Define walk-forward parameters
  const trainSize = 7 * 24 * 60 * 60 * 1000; // 7 days
  const testSize = 2 * 24 * 60 * 60 * 1000; // 2 days
  const stepSize = testSize;

  const results: {
    trainStart: number;
    trainEnd: number;
    testStart: number;
    testEnd: number;
    bestParams: Record<string, number>;
    trainMetrics: BacktestResult['metrics'];
    testMetrics: BacktestResult['metrics'];
  }[] = [];

  const startTime = ticks[0].timestampMs;
  const endTime = ticks[ticks.length - 1].timestampMs;

  for (let trainStart = startTime; trainStart + trainSize + testSize <= endTime; trainStart += stepSize) {
    const trainEnd = trainStart + trainSize;
    const testStart = trainEnd;
    const testEnd = testStart + testSize;

    console.log(`\nWindow: ${new Date(trainStart).toISOString()} - ${new Date(testEnd).toISOString()}`);

    // Split data
    const trainTicks = ticks.filter(t => t.timestampMs >= trainStart && t.timestampMs < trainEnd);
    const testTicks = ticks.filter(t => t.timestampMs >= testStart && t.timestampMs < testEnd);

    // Optimize on training data
    const sweepConfig: SweepConfig = {
      method: 'random',
      maxIterations: 50,
      maxParallel: 4,
      objectiveMetric: 'sharpeRatio',
      objectiveDirection: 'maximize',
    };

    const parameterSpace = {
      parameters: [
        { name: 'dfsEntryLongBase', type: 'float' as const, min: 0.75, max: 0.9, step: 0.05 },
        { name: 'dfsEntryShortBase', type: 'float' as const, min: 0.1, max: 0.25, step: 0.05 },
        { name: 'cooldownFlipS', type: 'int' as const, min: 20, max: 40, step: 5 },
      ],
    };

    const sweeper = new ParameterSweeper(parameterSpace, sweepConfig, trainTicks);
    const sweepResult = await sweeper.runSweep();

    if (!sweepResult.bestResult) {
      console.log('  No valid parameters found');
      continue;
    }

    const bestParams = sweepResult.bestResult.parameters;
    console.log(`  Best params: ${JSON.stringify(bestParams)}`);

    // Test on out-of-sample data
    const testHarness = new StrategyResearchHarness({}, bestParams);
    const testResult = await testHarness.runBacktest(testTicks);

    console.log(`  Train Sharpe: ${sweepResult.bestResult.metrics.sharpeRatio.toFixed(2)}`);
    console.log(`  Test Sharpe: ${testResult.metrics.sharpeRatio.toFixed(2)}`);
    console.log(`  Test PnL: $${testResult.metrics.netProfit.toFixed(2)}`);

    results.push({
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      bestParams,
      trainMetrics: sweepResult.bestResult.metrics,
      testMetrics: testResult.metrics,
    });
  }

  // Aggregate results
  const avgTestSharpe = results.reduce((sum, r) => sum + r.testMetrics.sharpeRatio, 0) / results.length;
  const avgTestPnL = results.reduce((sum, r) => sum + r.testMetrics.netProfit, 0) / results.length;
  const consistency = results.filter(r => r.testMetrics.netProfit > 0).length / results.length;

  console.log('\n=== Walk-Forward Summary ===');
  console.log(`Windows: ${results.length}`);
  console.log(`Avg Test Sharpe: ${avgTestSharpe.toFixed(2)}`);
  console.log(`Avg Test PnL: $${avgTestPnL.toFixed(2)}`);
  console.log(`Consistency: ${(consistency * 100).toFixed(1)}%`);
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

/**
 * Run all examples
 */
export async function runAllExamples(): Promise<void> {
  console.log('Strategy Research Test Harness - Examples\n');
  console.log('=========================================\n');

  try {
    // Uncomment the examples you want to run
    // await example1_BasicBacktest();
    // await example2_ParameterSweep();
    // await example3_GridSearch();
    // await example4_GeneticOptimization();
    // await example5_ScenarioTesting();
    // await example6_CustomScenario();
    // await example7_AdvancedMetrics();
    // await example8_MonteCarlo();
    // await example9_StatisticalTests();
    // await example10_StressTesting();
    // await example11_WalkForwardAnalysis();

    console.log('\nExamples completed!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllExamples();
}
