/**
 * Performance Metrics Calculator
 * 
 * Comprehensive performance metrics calculation for trading strategies.
 * Includes standard metrics, risk-adjusted returns, and advanced analytics.
 * 
 * Features:
 * - Standard performance metrics (PnL, win rate, etc.)
 * - Risk-adjusted metrics (Sharpe, Sortino, Calmar)
 * - Drawdown analysis
 * - Trade analytics
 * - Statistical significance tests
 * - Benchmark comparison
 */

import {
  TradeExecution,
  PerformanceMetrics,
  BacktestResult,
  MarketTick,
} from './strategy_research_harness';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Extended metrics with additional analytics
 */
export interface ExtendedMetrics extends PerformanceMetrics {
  // Additional return metrics
  annualizedReturn: number;
  annualizedVolatility: number;
  geometricMeanReturn: number;

  // Additional risk metrics
  valueAtRisk95: number;
  valueAtRisk99: number;
  conditionalVaR95: number;
  maxConsecutiveDrawdownDays: number;
  avgDrawdown: number;
  avgDrawdownDuration: number;

  // Trade quality metrics
  profitToLossRatio: number;
  winLossRatio: number;
  payoffRatio: number;

  // Efficiency metrics
  profitPerDay: number;
  tradesPerDay: number;
  avgBarsInTrade: number;

  // Skewness and kurtosis
  returnSkewness: number;
  returnKurtosis: number;

  // Benchmark metrics
  alpha: number;
  beta: number;
  informationRatio: number;
  trackingError: number;

  // Robustness metrics
  robustnessScore: number;
  consistencyScore: number;
  outlierImpact: number;
}

/**
 * Drawdown analysis result
 */
export interface DrawdownAnalysis {
  drawdowns: {
    startTimestamp: number;
    endTimestamp: number;
    durationMs: number;
    peakEquity: number;
    troughEquity: number;
    drawdownAmount: number;
    drawdownPct: number;
    recoveryTimestamp?: number;
    recoveryDurationMs?: number;
  }[];
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownDuration: number;
  avgDrawdown: number;
  avgDrawdownDuration: number;
  avgRecoveryTime: number;
  currentDrawdown: number;
  currentDrawdownPct: number;
  isInDrawdown: boolean;
}

/**
 * Trade analysis result
 */
export interface TradeAnalysis {
  // Trade distribution
  tradeDistribution: {
    bucket: string;
    count: number;
    totalPnl: number;
    avgPnl: number;
  }[];

  // Time-based analysis
  tradesByHour: { hour: number; count: number; winRate: number; avgPnl: number }[];
  tradesByDayOfWeek: { day: number; count: number; winRate: number; avgPnl: number }[];

  // Duration analysis
  durationDistribution: {
    bucket: string;
    count: number;
    winRate: number;
    avgPnl: number;
  }[];

  // Entry/exit analysis
  entryQuality: {
    avgMfe: number; // Maximum favorable excursion
    avgMae: number; // Maximum adverse excursion
    avgMfeRatio: number;
    avgMaeRatio: number;
  };

  // Consecutive analysis
  consecutiveWinsDistribution: { streak: number; count: number }[];
  consecutiveLossesDistribution: { streak: number; count: number }[];
}

/**
 * Rolling metrics
 */
export interface RollingMetrics {
  window: number;
  metrics: {
    timestamp: number;
    return: number;
    volatility: number;
    sharpe: number;
    drawdown: number;
    winRate: number;
  }[];
}

/**
 * Benchmark comparison
 */
export interface BenchmarkComparison {
  benchmarkName: string;
  strategyReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  alpha: number;
  beta: number;
  correlation: number;
  rSquared: number;
  informationRatio: number;
  trackingError: number;
  upCapture: number;
  downCapture: number;
  monthlyReturns: {
    month: string;
    strategy: number;
    benchmark: number;
    difference: number;
  }[];
}

/**
 * Statistical test result
 */
export interface StatisticalTest {
  name: string;
  statistic: number;
  pValue: number;
  isSignificant: boolean;
  interpretation: string;
}

/**
 * Monte Carlo simulation result
 */
export interface MonteCarloResult {
  iterations: number;
  confidenceLevel: number;
  worstCase: {
    return: number;
    maxDrawdown: number;
    winRate: number;
  };
  bestCase: {
    return: number;
    maxDrawdown: number;
    winRate: number;
  };
  medianCase: {
    return: number;
    maxDrawdown: number;
    winRate: number;
  };
  confidenceInterval: {
    lower: { return: number; maxDrawdown: number };
    upper: { return: number; maxDrawdown: number };
  };
  probabilityOfProfit: number;
  probabilityOfTargetReturn: number;
  valueAtRisk: number;
  expectedShortfall: number;
  equityCurves: { timestamp: number; equity: number }[][];
}

// ============================================================================
// METRICS CALCULATOR CLASS
// ============================================================================

/**
 * Performance Metrics Calculator
 * 
 * Main class for calculating comprehensive trading performance metrics.
 */
export class MetricsCalculator {
  private trades: TradeExecution[];
  private equityCurve: { timestampMs: number; equity: number; drawdown: number }[];
  private initialEquity: number;

  constructor(
    trades: TradeExecution[],
    equityCurve: { timestampMs: number; equity: number; drawdown: number }[],
    initialEquity: number
  ) {
    this.trades = trades;
    this.equityCurve = equityCurve;
    this.initialEquity = initialEquity;
  }

  // ============================================================================
  // BASIC METRICS
  // ============================================================================

  /**
   * Calculate all basic performance metrics
   */
  calculateBasicMetrics(): PerformanceMetrics {
    const completedTrades = this.trades.filter(t => t.action === 'EXIT');
    const winningTrades = completedTrades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = completedTrades.filter(t => (t.pnl || 0) <= 0);

    const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
    const totalFees = this.trades.reduce((sum, t) => sum + t.fees, 0);
    const netProfit = grossProfit - grossLoss - totalFees;

    const totalReturn = netProfit;
    const totalReturnPct = (netProfit / this.initialEquity) * 100;

    const winRate = completedTrades.length > 0
      ? (winningTrades.length / completedTrades.length) * 100
      : 0;

    const avgTrade = completedTrades.length > 0
      ? completedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / completedTrades.length
      : 0;

    const avgWin = winningTrades.length > 0
      ? grossProfit / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? -grossLoss / losingTrades.length
      : 0;

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const expectancy = winRate / 100 * avgWin + (1 - winRate / 100) * avgLoss;

    // Calculate max drawdown
    const maxDrawdown = this.calculateMaxDrawdown();
    const maxDrawdownPct = (maxDrawdown / this.initialEquity) * 100;

    // Calculate Sharpe ratio
    const returns = this.calculateReturns();
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns);
    const calmarRatio = maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : 0;

    // Calculate trade durations
    const tradeDurations = this.calculateTradeDurations();
    const avgTradeDurationMs = tradeDurations.length > 0
      ? tradeDurations.reduce((a, b) => a + b, 0) / tradeDurations.length
      : 0;

    // Calculate latencies
    const entryLatencies = this.trades.filter(t => t.action === 'ENTRY').map(t => t.latencyMs);
    const exitLatencies = this.trades.filter(t => t.action === 'EXIT').map(t => t.latencyMs);

    // Calculate consecutive metrics
    const { maxConsecutiveWins, maxConsecutiveLosses } = this.calculateConsecutiveMetrics();

    return {
      totalReturn,
      totalReturnPct,
      grossProfit,
      grossLoss,
      netProfit,
      totalTrades: completedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgTrade,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      avgTradeDurationMs,
      avgWinDurationMs: 0,
      avgLossDurationMs: 0,
      avgEntryLatencyMs: entryLatencies.length > 0
        ? entryLatencies.reduce((a, b) => a + b, 0) / entryLatencies.length
        : 0,
      avgExitLatencyMs: exitLatencies.length > 0
        ? exitLatencies.reduce((a, b) => a + b, 0) / exitLatencies.length
        : 0,
      maxEntryLatencyMs: entryLatencies.length > 0 ? Math.max(...entryLatencies) : 0,
      maxExitLatencyMs: exitLatencies.length > 0 ? Math.max(...exitLatencies) : 0,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      returnPerDrawdown: maxDrawdown > 0 ? totalReturn / maxDrawdown : 0,
      returnPerTrade: completedTrades.length > 0 ? totalReturn / completedTrades.length : 0,
    };
  }

  // ============================================================================
  // EXTENDED METRICS
  // ============================================================================

  /**
   * Calculate extended metrics with additional analytics
   */
  calculateExtendedMetrics(benchmarkReturns?: number[]): ExtendedMetrics {
    const basic = this.calculateBasicMetrics();
    const returns = this.calculateReturns();

    // Annualized metrics
    const totalDays = this.getTradingDays();
    const annualizedReturn = totalDays > 0
      ? (Math.pow(1 + basic.totalReturnPct / 100, 365 / totalDays) - 1) * 100
      : 0;

    const annualizedVolatility = this.calculateAnnualizedVolatility(returns);
    const geometricMeanReturn = this.calculateGeometricMean(returns);

    // VaR and CVaR
    const valueAtRisk95 = this.calculateVaR(returns, 0.05);
    const valueAtRisk99 = this.calculateVaR(returns, 0.01);
    const conditionalVaR95 = this.calculateCVaR(returns, 0.05);

    // Drawdown analysis
    const drawdownAnalysis = this.analyzeDrawdowns();

    // Trade quality
    const profitToLossRatio = Math.abs(basic.avgWin / basic.avgLoss);
    const winLossRatio = basic.winningTrades / Math.max(1, basic.losingTrades);
    const payoffRatio = basic.avgWin / Math.abs(basic.avgLoss);

    // Efficiency
    const profitPerDay = basic.netProfit / Math.max(1, totalDays);
    const tradesPerDay = basic.totalTrades / Math.max(1, totalDays);

    // Skewness and kurtosis
    const returnSkewness = this.calculateSkewness(returns);
    const returnKurtosis = this.calculateKurtosis(returns);

    // Benchmark comparison
    let alpha = 0;
    let beta = 0;
    let informationRatio = 0;
    let trackingError = 0;

    if (benchmarkReturns && benchmarkReturns.length === returns.length) {
      const comparison = this.compareToBenchmark(returns, benchmarkReturns);
      alpha = comparison.alpha;
      beta = comparison.beta;
      informationRatio = comparison.informationRatio;
      trackingError = comparison.trackingError;
    }

    // Robustness
    const robustnessScore = this.calculateRobustnessScore(basic);
    const consistencyScore = this.calculateConsistencyScore(returns);
    const outlierImpact = this.calculateOutlierImpact(returns);

    return {
      ...basic,
      annualizedReturn,
      annualizedVolatility,
      geometricMeanReturn,
      valueAtRisk95,
      valueAtRisk99,
      conditionalVaR95,
      maxConsecutiveDrawdownDays: drawdownAnalysis.maxDrawdownDuration / (24 * 60 * 60 * 1000),
      avgDrawdown: drawdownAnalysis.avgDrawdown,
      avgDrawdownDuration: drawdownAnalysis.avgDrawdownDuration,
      profitToLossRatio,
      winLossRatio,
      payoffRatio,
      profitPerDay,
      tradesPerDay,
      avgBarsInTrade: 0, // Would need bar data
      returnSkewness,
      returnKurtosis,
      alpha,
      beta,
      informationRatio,
      trackingError,
      robustnessScore,
      consistencyScore,
      outlierImpact,
    };
  }

  // ============================================================================
  // DRAWDOWN ANALYSIS
  // ============================================================================

  /**
   * Analyze drawdowns in detail
   */
  analyzeDrawdowns(): DrawdownAnalysis {
    const drawdowns: DrawdownAnalysis['drawdowns'] = [];
    let peakEquity = this.initialEquity;
    let peakTimestamp = this.equityCurve[0]?.timestampMs || 0;
    let troughEquity = this.initialEquity;
    let troughTimestamp = peakTimestamp;
    let inDrawdown = false;

    for (const point of this.equityCurve) {
      if (point.equity > peakEquity) {
        // End of drawdown
        if (inDrawdown) {
          drawdowns.push({
            startTimestamp: peakTimestamp,
            endTimestamp: troughTimestamp,
            durationMs: troughTimestamp - peakTimestamp,
            peakEquity,
            troughEquity,
            drawdownAmount: peakEquity - troughEquity,
            drawdownPct: ((peakEquity - troughEquity) / peakEquity) * 100,
          });
        }

        peakEquity = point.equity;
        peakTimestamp = point.timestampMs;
        troughEquity = point.equity;
        troughTimestamp = point.timestampMs;
        inDrawdown = false;
      } else if (point.equity < troughEquity) {
        troughEquity = point.equity;
        troughTimestamp = point.timestampMs;
        inDrawdown = true;
      }
    }

    // Handle ongoing drawdown
    const currentDrawdown = peakEquity - (this.equityCurve[this.equityCurve.length - 1]?.equity || peakEquity);
    const currentDrawdownPct = (currentDrawdown / peakEquity) * 100;

    // Calculate statistics
    const maxDrawdown = Math.max(...drawdowns.map(d => d.drawdownAmount), 0);
    const maxDrawdownPct = Math.max(...drawdowns.map(d => d.drawdownPct), 0);
    const maxDrawdownDuration = Math.max(...drawdowns.map(d => d.durationMs), 0);
    const avgDrawdown = drawdowns.length > 0
      ? drawdowns.reduce((sum, d) => sum + d.drawdownAmount, 0) / drawdowns.length
      : 0;
    const avgDrawdownDuration = drawdowns.length > 0
      ? drawdowns.reduce((sum, d) => sum + d.durationMs, 0) / drawdowns.length
      : 0;

    return {
      drawdowns,
      maxDrawdown,
      maxDrawdownPct,
      maxDrawdownDuration,
      avgDrawdown,
      avgDrawdownDuration,
      avgRecoveryTime: 0, // Would need recovery tracking
      currentDrawdown,
      currentDrawdownPct,
      isInDrawdown: currentDrawdown > 0,
    };
  }

  // ============================================================================
  // TRADE ANALYSIS
  // ============================================================================

  /**
   * Analyze trades in detail
   */
  analyzeTrades(): TradeAnalysis {
    const completedTrades = this.trades.filter(t => t.action === 'EXIT');

    // Trade distribution
    const tradeDistribution = this.calculateTradeDistribution(completedTrades);

    // Time-based analysis
    const tradesByHour = this.analyzeTradesByHour(completedTrades);
    const tradesByDayOfWeek = this.analyzeTradesByDayOfWeek(completedTrades);

    // Duration analysis
    const durationDistribution = this.analyzeDurationDistribution();

    // Entry/exit quality
    const entryQuality = this.calculateEntryQuality();

    // Consecutive analysis
    const { consecutiveWinsDistribution, consecutiveLossesDistribution } =
      this.calculateConsecutiveDistributions();

    return {
      tradeDistribution,
      tradesByHour,
      tradesByDayOfWeek,
      durationDistribution,
      entryQuality,
      consecutiveWinsDistribution,
      consecutiveLossesDistribution,
    };
  }

  // ============================================================================
  // ROLLING METRICS
  // ============================================================================

  /**
   * Calculate rolling metrics over time
   */
  calculateRollingMetrics(window: number = 30): RollingMetrics {
    const metrics: RollingMetrics['metrics'] = [];

    for (let i = window; i < this.equityCurve.length; i++) {
      const windowData = this.equityCurve.slice(i - window, i);
      const returns = [];

      for (let j = 1; j < windowData.length; j++) {
        const ret = (windowData[j].equity - windowData[j - 1].equity) / windowData[j - 1].equity;
        returns.push(ret);
      }

      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const volatility = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
      const sharpe = volatility > 0 ? (avgReturn / volatility) * Math.sqrt(252) : 0;

      // Calculate win rate from trades in window
      const windowStart = windowData[0].timestampMs;
      const windowEnd = windowData[windowData.length - 1].timestampMs;
      const windowTrades = this.trades.filter(
        t => t.timestampMs >= windowStart && t.timestampMs <= windowEnd && t.action === 'EXIT'
      );
      const winningTrades = windowTrades.filter(t => (t.pnl || 0) > 0);
      const winRate = windowTrades.length > 0 ? (winningTrades.length / windowTrades.length) * 100 : 0;

      metrics.push({
        timestamp: windowData[windowData.length - 1].timestampMs,
        return: avgReturn * 100,
        volatility: volatility * 100,
        sharpe,
        drawdown: windowData[windowData.length - 1].drawdown,
        winRate,
      });
    }

    return { window, metrics };
  }

  // ============================================================================
  // BENCHMARK COMPARISON
  // ============================================================================

  /**
   * Compare strategy to benchmark
   */
  compareToBenchmark(
    strategyReturns: number[],
    benchmarkReturns: number[],
    benchmarkName: string = 'Benchmark'
  ): BenchmarkComparison {
    // Calculate returns
    const strategyReturn = strategyReturns.reduce((a, b) => a + b, 0);
    const benchmarkReturn = benchmarkReturns.reduce((a, b) => a + b, 0);
    const excessReturn = strategyReturn - benchmarkReturn;

    // Calculate beta and alpha
    const covariance = this.calculateCovariance(strategyReturns, benchmarkReturns);
    const benchmarkVariance = this.calculateVariance(benchmarkReturns);
    const beta = benchmarkVariance > 0 ? covariance / benchmarkVariance : 0;
    const alpha = strategyReturn - beta * benchmarkReturn;

    // Calculate correlation
    const correlation = this.calculateCorrelation(strategyReturns, benchmarkReturns);
    const rSquared = correlation * correlation;

    // Calculate tracking error and information ratio
    const trackingDifferences = strategyReturns.map((s, i) => s - benchmarkReturns[i]);
    const trackingError = Math.sqrt(this.calculateVariance(trackingDifferences));
    const informationRatio = trackingError > 0 ? excessReturn / trackingError : 0;

    // Calculate up/down capture
    const upMonths = benchmarkReturns.filter(r => r > 0);
    const downMonths = benchmarkReturns.filter(r => r < 0);
    const strategyUpReturns = strategyReturns.filter((_, i) => benchmarkReturns[i] > 0);
    const strategyDownReturns = strategyReturns.filter((_, i) => benchmarkReturns[i] < 0);

    const upCapture = upMonths.length > 0
      ? (strategyUpReturns.reduce((a, b) => a + b, 0) / upMonths.reduce((a, b) => a + b, 0)) * 100
      : 0;

    const downCapture = downMonths.length > 0
      ? (strategyDownReturns.reduce((a, b) => a + b, 0) / downMonths.reduce((a, b) => a + b, 0)) * 100
      : 0;

    return {
      benchmarkName,
      strategyReturn: strategyReturn * 100,
      benchmarkReturn: benchmarkReturn * 100,
      excessReturn: excessReturn * 100,
      alpha: alpha * 100,
      beta,
      correlation,
      rSquared,
      informationRatio,
      trackingError: trackingError * 100,
      upCapture,
      downCapture,
      monthlyReturns: [],
    };
  }

  // ============================================================================
  // STATISTICAL TESTS
  // ============================================================================

  /**
   * Run statistical significance tests
   */
  runStatisticalTests(): StatisticalTest[] {
    const tests: StatisticalTest[] = [];
    const returns = this.calculateReturns();

    // T-test for mean return
    const tTest = this.runTTest(returns);
    tests.push(tTest);

    // Jarque-Bera test for normality
    const jbTest = this.runJarqueBeraTest(returns);
    tests.push(jbTest);

    // Ljung-Box test for autocorrelation
    const lbTest = this.runLjungBoxTest(returns);
    tests.push(lbTest);

    return tests;
  }

  // ============================================================================
  // MONTE CARLO SIMULATION
  // ============================================================================

  /**
   * Run Monte Carlo simulation
   */
  runMonteCarlo(
    iterations: number = 1000,
    confidenceLevel: number = 0.95,
    targetReturn: number = 0
  ): MonteCarloResult {
    const returns = this.calculateReturns();
    const completedTrades = this.trades.filter(t => t.action === 'EXIT');
    const tradePnls = completedTrades.map(t => t.pnl || 0);

    const simulatedResults: { return: number; maxDrawdown: number; winRate: number }[] = [];
    const equityCurves: { timestamp: number; equity: number }[][] = [];

    for (let i = 0; i < iterations; i++) {
      // Shuffle trades with replacement
      const shuffledTrades = this.bootstrapTrades(tradePnls, completedTrades.length);

      // Simulate equity curve
      let equity = this.initialEquity;
      const curve: { timestamp: number; equity: number }[] = [{ timestamp: 0, equity }];
      let peakEquity = equity;
      let maxDrawdown = 0;
      let wins = 0;

      for (let j = 0; j < shuffledTrades.length; j++) {
        const pnl = shuffledTrades[j];
        equity += pnl;
        curve.push({ timestamp: j, equity });

        if (equity > peakEquity) {
          peakEquity = equity;
        }

        const drawdown = peakEquity - equity;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        if (pnl > 0) wins++;
      }

      const totalReturn = (equity - this.initialEquity) / this.initialEquity;
      const winRate = (wins / shuffledTrades.length) * 100;

      simulatedResults.push({
        return: totalReturn,
        maxDrawdown,
        winRate,
      });

      if (i < 100) {
        equityCurves.push(curve);
      }
    }

    // Sort results
    simulatedResults.sort((a, b) => a.return - b.return);

    const idxWorst = 0;
    const idxBest = simulatedResults.length - 1;
    const idxMedian = Math.floor(simulatedResults.length / 2);

    const lowerIdx = Math.floor(simulatedResults.length * (1 - confidenceLevel) / 2);
    const upperIdx = Math.floor(simulatedResults.length * (1 + confidenceLevel) / 2);

    // Calculate probabilities
    const profitableCount = simulatedResults.filter(r => r.return > 0).length;
    const targetCount = simulatedResults.filter(r => r.return >= targetReturn).length;

    return {
      iterations,
      confidenceLevel,
      worstCase: simulatedResults[idxWorst],
      bestCase: simulatedResults[idxBest],
      medianCase: simulatedResults[idxMedian],
      confidenceInterval: {
        lower: {
          return: simulatedResults[lowerIdx].return,
          maxDrawdown: simulatedResults[lowerIdx].maxDrawdown,
        },
        upper: {
          return: simulatedResults[upperIdx].return,
          maxDrawdown: simulatedResults[upperIdx].maxDrawdown,
        },
      },
      probabilityOfProfit: (profitableCount / iterations) * 100,
      probabilityOfTargetReturn: (targetCount / iterations) * 100,
      valueAtRisk: -simulatedResults[lowerIdx].return,
      expectedShortfall: -simulatedResults.slice(0, lowerIdx).reduce((a, b) => a + b.return, 0) / lowerIdx,
      equityCurves,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private calculateMaxDrawdown(): number {
    let peak = this.initialEquity;
    let maxDrawdown = 0;

    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = peak - point.equity;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }

  private calculateReturns(): number[] {
    const returns: number[] = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const ret = (this.equityCurve[i].equity - this.equityCurve[i - 1].equity) / this.equityCurve[i - 1].equity;
      returns.push(ret);
    }
    return returns;
  }

  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / returns.length);
    return std > 0 ? (avg / std) * Math.sqrt(252) : 0;
  }

  private calculateSortinoRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const downsideReturns = returns.filter(r => r < 0);
    const downsideStd = downsideReturns.length > 0
      ? Math.sqrt(downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length)
      : 0;
    return downsideStd > 0 ? (avg / downsideStd) * Math.sqrt(252) : 0;
  }

  private calculateTradeDurations(): number[] {
    const durations: number[] = [];
    let entryTime: number | null = null;

    for (const trade of this.trades) {
      if (trade.action === 'ENTRY') {
        entryTime = trade.timestampMs;
      } else if (trade.action === 'EXIT' && entryTime) {
        durations.push(trade.timestampMs - entryTime);
        entryTime = null;
      }
    }

    return durations;
  }

  private calculateConsecutiveMetrics(): { maxConsecutiveWins: number; maxConsecutiveLosses: number } {
    const completedTrades = this.trades.filter(t => t.action === 'EXIT');
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of completedTrades) {
      if ((trade.pnl || 0) > 0) {
        currentWins++;
        currentLosses = 0;
        maxWins = Math.max(maxWins, currentWins);
      } else {
        currentLosses++;
        currentWins = 0;
        maxLosses = Math.max(maxLosses, currentLosses);
      }
    }

    return { maxConsecutiveWins: maxWins, maxConsecutiveLosses: maxLosses };
  }

  private getTradingDays(): number {
    if (this.equityCurve.length < 2) return 0;
    const start = this.equityCurve[0].timestampMs;
    const end = this.equityCurve[this.equityCurve.length - 1].timestampMs;
    return (end - start) / (24 * 60 * 60 * 1000);
  }

  private calculateAnnualizedVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;
    const variance = returns.reduce((sum, r) => sum + r * r, 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  private calculateGeometricMean(returns: number[]): number {
    if (returns.length === 0) return 0;
    const product = returns.reduce((acc, r) => acc * (1 + r), 1);
    return (Math.pow(product, 1 / returns.length) - 1) * 100;
  }

  private calculateVaR(returns: number[], confidence: number): number {
    if (returns.length === 0) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * confidence);
    return -sorted[idx] * 100;
  }

  private calculateCVaR(returns: number[], confidence: number): number {
    if (returns.length === 0) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * confidence);
    const tail = sorted.slice(0, idx);
    return tail.length > 0 ? -tail.reduce((a, b) => a + b, 0) / tail.length * 100 : 0;
  }

  private calculateSkewness(returns: number[]): number {
    if (returns.length < 3) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    const skewness = returns.reduce((sum, r) => sum + Math.pow((r - mean) / std, 3), 0) / returns.length;
    return skewness;
  }

  private calculateKurtosis(returns: number[]): number {
    if (returns.length < 4) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    const kurtosis = returns.reduce((sum, r) => sum + Math.pow((r - mean) / std, 4), 0) / returns.length;
    return kurtosis - 3; // Excess kurtosis
  }

  private calculateCovariance(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    const meanA = a.reduce((x, y) => x + y, 0) / a.length;
    const meanB = b.reduce((x, y) => x + y, 0) / b.length;
    return a.reduce((sum, val, i) => sum + (val - meanA) * (b[i] - meanB), 0) / a.length;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }

  private calculateCorrelation(a: number[], b: number[]): number {
    const cov = this.calculateCovariance(a, b);
    const stdA = Math.sqrt(this.calculateVariance(a));
    const stdB = Math.sqrt(this.calculateVariance(b));
    return stdA > 0 && stdB > 0 ? cov / (stdA * stdB) : 0;
  }

  private calculateRobustnessScore(metrics: PerformanceMetrics): number {
    // Score based on multiple factors
    const winRateScore = Math.min(metrics.winRate / 50, 1);
    const profitFactorScore = Math.min(metrics.profitFactor / 2, 1);
    const sharpeScore = Math.min(Math.max(metrics.sharpeRatio, 0) / 2, 1);
    const drawdownScore = Math.max(0, 1 - metrics.maxDrawdownPct / 30);

    return (winRateScore + profitFactorScore + sharpeScore + drawdownScore) / 4 * 100;
  }

  private calculateConsistencyScore(returns: number[]): number {
    if (returns.length < 2) return 0;
    const positiveReturns = returns.filter(r => r > 0).length;
    const consistency = (positiveReturns / returns.length) * 100;
    return consistency;
  }

  private calculateOutlierImpact(returns: number[]): number {
    if (returns.length < 10) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const outliers = returns.filter(r => r < lowerBound || r > upperBound);
    const outlierPnl = outliers.reduce((a, b) => a + b, 0);
    const totalPnl = returns.reduce((a, b) => a + b, 0);

    return totalPnl !== 0 ? (outlierPnl / totalPnl) * 100 : 0;
  }

  private calculateTradeDistribution(completedTrades: TradeExecution[]) {
    const buckets = [
      { range: [-Infinity, -500], label: '< -$500' },
      { range: [-500, -200], label: '-$500 to -$200' },
      { range: [-200, -100], label: '-$200 to -$100' },
      { range: [-100, -50], label: '-$100 to -$50' },
      { range: [-50, -20], label: '-$50 to -$20' },
      { range: [-20, 0], label: '-$20 to $0' },
      { range: [0, 20], label: '$0 to $20' },
      { range: [20, 50], label: '$20 to $50' },
      { range: [50, 100], label: '$50 to $100' },
      { range: [100, 200], label: '$100 to $200' },
      { range: [200, 500], label: '$200 to $500' },
      { range: [500, Infinity], label: '> $500' },
    ];

    return buckets.map(bucket => {
      const trades = completedTrades.filter(
        t => (t.pnl || 0) >= bucket.range[0] && (t.pnl || 0) < bucket.range[1]
      );
      return {
        bucket: bucket.label,
        count: trades.length,
        totalPnl: trades.reduce((sum, t) => sum + (t.pnl || 0), 0),
        avgPnl: trades.length > 0 ? trades.reduce((sum, t) => sum + (t.pnl || 0), 0) / trades.length : 0,
      };
    });
  }

  private analyzeTradesByHour(completedTrades: TradeExecution[]) {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: 0,
      wins: 0,
      totalPnl: 0,
    }));

    for (const trade of completedTrades) {
      const hour = new Date(trade.timestampMs).getUTCHours();
      hours[hour].count++;
      hours[hour].totalPnl += trade.pnl || 0;
      if ((trade.pnl || 0) > 0) hours[hour].wins++;
    }

    return hours.map(h => ({
      hour: h.hour,
      count: h.count,
      winRate: h.count > 0 ? (h.wins / h.count) * 100 : 0,
      avgPnl: h.count > 0 ? h.totalPnl / h.count : 0,
    }));
  }

  private analyzeTradesByDayOfWeek(completedTrades: TradeExecution[]) {
    const days = Array.from({ length: 7 }, (_, i) => ({
      day: i,
      count: 0,
      wins: 0,
      totalPnl: 0,
    }));

    for (const trade of completedTrades) {
      const day = new Date(trade.timestampMs).getUTCDay();
      days[day].count++;
      days[day].totalPnl += trade.pnl || 0;
      if ((trade.pnl || 0) > 0) days[day].wins++;
    }

    return days.map(d => ({
      day: d.day,
      count: d.count,
      winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0,
      avgPnl: d.count > 0 ? d.totalPnl / d.count : 0,
    }));
  }

  private analyzeDurationDistribution() {
    const durations = this.calculateTradeDurations();
    const buckets = [
      { max: 60000, label: '< 1 min' },
      { max: 300000, label: '1-5 min' },
      { max: 600000, label: '5-10 min' },
      { max: 1800000, label: '10-30 min' },
      { max: 3600000, label: '30-60 min' },
      { max: 7200000, label: '1-2 hours' },
      { max: 14400000, label: '2-4 hours' },
      { max: Infinity, label: '> 4 hours' },
    ];

    let prevMax = 0;
    return buckets.map(bucket => {
      const count = durations.filter(d => d >= prevMax && d < bucket.max).length;
      prevMax = bucket.max;
      return {
        bucket: bucket.label,
        count,
        winRate: 0, // Would need to correlate with PnL
        avgPnl: 0,
      };
    });
  }

  private calculateEntryQuality() {
    // Simplified - would need MFE/MAE tracking
    return {
      avgMfe: 0,
      avgMae: 0,
      avgMfeRatio: 0,
      avgMaeRatio: 0,
    };
  }

  private calculateConsecutiveDistributions() {
    const completedTrades = this.trades.filter(t => t.action === 'EXIT');
    const winStreaks: number[] = [];
    const lossStreaks: number[] = [];

    let currentStreak = 0;
    let lastWasWin: boolean | null = null;

    for (const trade of completedTrades) {
      const isWin = (trade.pnl || 0) > 0;

      if (lastWasWin === null) {
        currentStreak = 1;
      } else if (isWin === lastWasWin) {
        currentStreak++;
      } else {
        if (lastWasWin) {
          winStreaks.push(currentStreak);
        } else {
          lossStreaks.push(currentStreak);
        }
        currentStreak = 1;
      }

      lastWasWin = isWin;
    }

    // Handle final streak
    if (lastWasWin !== null && currentStreak > 0) {
      if (lastWasWin) {
        winStreaks.push(currentStreak);
      } else {
        lossStreaks.push(currentStreak);
      }
    }

    const maxWinStreak = Math.max(...winStreaks, 0);
    const maxLossStreak = Math.max(...lossStreaks, 0);

    return {
      consecutiveWinsDistribution: Array.from({ length: maxWinStreak }, (_, i) => ({
        streak: i + 1,
        count: winStreaks.filter(s => s === i + 1).length,
      })),
      consecutiveLossesDistribution: Array.from({ length: maxLossStreak }, (_, i) => ({
        streak: i + 1,
        count: lossStreaks.filter(s => s === i + 1).length,
      })),
    };
  }

  private bootstrapTrades(tradePnls: number[], count: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * tradePnls.length);
      result.push(tradePnls[idx]);
    }
    return result;
  }

  private runTTest(returns: number[]): StatisticalTest {
    const n = returns.length;
    if (n < 2) {
      return {
        name: 'One-sample t-test',
        statistic: 0,
        pValue: 1,
        isSignificant: false,
        interpretation: 'Insufficient data for t-test',
      };
    }

    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (n - 1);
    const std = Math.sqrt(variance);
    const tStatistic = std > 0 ? mean / (std / Math.sqrt(n)) : 0;

    // Approximate p-value (simplified)
    const pValue = Math.min(1, 2 * (1 - this.normalCDF(Math.abs(tStatistic))));

    return {
      name: 'One-sample t-test (mean return)',
      statistic: tStatistic,
      pValue,
      isSignificant: pValue < 0.05,
      interpretation: pValue < 0.05
        ? 'Mean return is statistically significant'
        : 'Mean return is not statistically significant',
    };
  }

  private runJarqueBeraTest(returns: number[]): StatisticalTest {
    const n = returns.length;
    if (n < 4) {
      return {
        name: 'Jarque-Bera test',
        statistic: 0,
        pValue: 1,
        isSignificant: false,
        interpretation: 'Insufficient data for Jarque-Bera test',
      };
    }

    const skewness = this.calculateSkewness(returns);
    const kurtosis = this.calculateKurtosis(returns);
    const jbStatistic = (n / 6) * (Math.pow(skewness, 2) + Math.pow(kurtosis, 2) / 4);

    // Approximate p-value (chi-squared with 2 degrees of freedom)
    const pValue = Math.exp(-jbStatistic / 2);

    return {
      name: 'Jarque-Bera test (normality)',
      statistic: jbStatistic,
      pValue,
      isSignificant: pValue < 0.05,
      interpretation: pValue < 0.05
        ? 'Returns are not normally distributed'
        : 'Returns appear normally distributed',
    };
  }

  private runLjungBoxTest(returns: number[]): StatisticalTest {
    const n = returns.length;
    const lag = Math.min(10, Math.floor(n / 5));

    if (n < lag + 1) {
      return {
        name: 'Ljung-Box test',
        statistic: 0,
        pValue: 1,
        isSignificant: false,
        interpretation: 'Insufficient data for Ljung-Box test',
      };
    }

    let lbStatistic = 0;
    for (let k = 1; k <= lag; k++) {
      const autocorr = this.calculateAutocorrelation(returns, k);
      lbStatistic += (autocorr * autocorr) / (n - k);
    }
    lbStatistic *= n * (n + 2);

    // Approximate p-value (chi-squared with lag degrees of freedom)
    const pValue = Math.exp(-lbStatistic / 2);

    return {
      name: 'Ljung-Box test (autocorrelation)',
      statistic: lbStatistic,
      pValue,
      isSignificant: pValue < 0.05,
      interpretation: pValue < 0.05
        ? 'Returns show significant autocorrelation'
        : 'No significant autocorrelation detected',
    };
  }

  private calculateAutocorrelation(returns: number[], lag: number): number {
    const n = returns.length;
    const mean = returns.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = lag; i < n; i++) {
      numerator += (returns[i] - mean) * (returns[i - lag] - mean);
    }

    for (let i = 0; i < n; i++) {
      denominator += Math.pow(returns[i] - mean, 2);
    }

    return denominator > 0 ? numerator / denominator : 0;
  }

  private normalCDF(x: number): number {
    // Approximation of standard normal CDF
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1 + sign * y);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate metrics from a backtest result
 */
export function calculateMetricsFromBacktest(result: BacktestResult): ExtendedMetrics {
  const calculator = new MetricsCalculator(
    result.trades,
    result.equityCurve,
    result.config.initialEquity || 100000
  );
  return calculator.calculateExtendedMetrics();
}

/**
 * Format metrics for display
 */
export function formatMetrics(metrics: ExtendedMetrics | PerformanceMetrics): string {
  const lines = [
    '=== Performance Metrics ===',
    '',
    'Returns:',
    `  Total Return:        ${metrics.totalReturnPct.toFixed(2)}% ($${metrics.totalReturn.toFixed(2)})`,
    `  Net Profit:          $${metrics.netProfit.toFixed(2)}`,
    `  Gross Profit:        $${metrics.grossProfit.toFixed(2)}`,
    `  Gross Loss:          $${metrics.grossLoss.toFixed(2)}`,
    '',
    'Trade Statistics:',
    `  Total Trades:        ${metrics.totalTrades}`,
    `  Win Rate:            ${metrics.winRate.toFixed(2)}%`,
    `  Win/Loss:            ${metrics.winningTrades}/${metrics.losingTrades}`,
    `  Avg Trade:           $${metrics.avgTrade.toFixed(2)}`,
    `  Avg Win:             $${metrics.avgWin.toFixed(2)}`,
    `  Avg Loss:            $${metrics.avgLoss.toFixed(2)}`,
    `  Profit Factor:       ${metrics.profitFactor.toFixed(2)}`,
    `  Expectancy:          $${metrics.expectancy.toFixed(2)}`,
    '',
    'Risk Metrics:',
    `  Max Drawdown:        ${metrics.maxDrawdownPct.toFixed(2)}% ($${metrics.maxDrawdown.toFixed(2)})`,
    `  Sharpe Ratio:        ${metrics.sharpeRatio.toFixed(2)}`,
    `  Sortino Ratio:       ${metrics.sortinoRatio.toFixed(2)}`,
    `  Calmar Ratio:        ${metrics.calmarRatio.toFixed(2)}`,
    '',
    'Latency Metrics:',
    `  Avg Entry Latency:   ${metrics.avgEntryLatencyMs.toFixed(1)}ms`,
    `  Avg Exit Latency:    ${metrics.avgExitLatencyMs.toFixed(1)}ms`,
    `  Max Entry Latency:   ${metrics.maxEntryLatencyMs.toFixed(1)}ms`,
    `  Max Exit Latency:    ${metrics.maxExitLatencyMs.toFixed(1)}ms`,
    '',
    'Consecutive Metrics:',
    `  Max Consecutive Wins:   ${metrics.maxConsecutiveWins}`,
    `  Max Consecutive Losses: ${metrics.maxConsecutiveLosses}`,
  ];

  // Add extended metrics if available
  const extended = metrics as ExtendedMetrics;
  if (extended.annualizedReturn !== undefined) {
    lines.push(
      '',
      'Extended Metrics:',
      `  Annualized Return:   ${extended.annualizedReturn.toFixed(2)}%`,
      `  Annualized Vol:      ${extended.annualizedVolatility.toFixed(2)}%`,
      `  VaR (95%):           ${extended.valueAtRisk95.toFixed(2)}%`,
      `  VaR (99%):           ${extended.valueAtRisk99.toFixed(2)}%`,
      `  Return Skewness:     ${extended.returnSkewness.toFixed(2)}`,
      `  Return Kurtosis:     ${extended.returnKurtosis.toFixed(2)}`,
      `  Robustness Score:    ${extended.robustnessScore.toFixed(1)}`,
      `  Consistency Score:   ${extended.consistencyScore.toFixed(1)}%`
    );
  }

  return lines.join('\n');
}

// Export all types
export {
  TradeExecution,
  PerformanceMetrics,
  BacktestResult,
  MarketTick,
} from './strategy_research_harness';
