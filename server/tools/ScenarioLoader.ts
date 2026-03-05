/**
 * Scenario Loader and Test Case Generator
 * 
 * Comprehensive scenario-based testing for trading strategies.
 * Supports predefined market scenarios and custom scenario definitions.
 * 
 * Features:
 * - Predefined market scenarios (trend, range, volatile, etc.)
 * - Custom scenario definition
 * - Scenario composition and chaining
 * - Stress testing scenarios
 * - Flash crash simulation
 */

import {
  MarketTick,
  BacktestResult,
  StrategyResearchHarness,
  BacktestConfig,
  StrategyConfig,
} from './strategy_research_harness';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Market scenario type
 */
export type ScenarioType =
  | 'trend_up'
  | 'trend_down'
  | 'range_bound'
  | 'high_volatility'
  | 'low_volatility'
  | 'low_liquidity'
  | 'flash_crash'
  | 'flash_pump'
  | 'choppy'
  | 'gap_up'
  | 'gap_down'
  | 'news_event'
  | 'whale_manipulation'
  | 'normal';

/**
 * Scenario definition
 */
export interface ScenarioDefinition {
  name: string;
  type: ScenarioType;
  description: string;
  durationMs: number;
  parameters: ScenarioParameters;
  expectedBehavior: ExpectedBehavior;
}

/**
 * Scenario parameters
 */
export interface ScenarioParameters {
  // Price behavior
  priceTrend: number; // -1 to 1, negative = down, positive = up
  priceVolatility: number; // 0 to 1, higher = more volatile
  priceNoise: number; // 0 to 1, random price movements

  // Volume behavior
  volumeLevel: number; // 0 to 1, relative volume
  volumeSpikes: boolean; // Include volume spikes
  volumeTrend: number; // -1 to 1

  // Order book behavior
  spreadBase: number; // Base spread in bps
  spreadVolatility: number; // Spread variation
  depthImbalance: number; // -1 to 1, order book imbalance

  // Orderflow behavior
  deltaBias: number; // -1 to 1, buy vs sell pressure
  deltaVolatility: number; // Delta variation
  cvdTrend: number; // -1 to 1, CVD slope direction

  // Burst behavior
  burstFrequency: number; // 0 to 1, how often bursts occur
  burstSize: number; // Average burst size
  burstDirection: 'buy' | 'sell' | 'mixed';

  // Special events
  includeGaps: boolean;
  gapProbability: number;
  includeAbsorption: boolean;
  absorptionFrequency: number;
}

/**
 * Expected behavior for validation
 */
export interface ExpectedBehavior {
  minTrades: number;
  maxTrades: number;
  minWinRate: number;
  maxWinRate: number;
  maxDrawdownPct: number;
  expectedRegime: string[];
  shouldTrade: boolean;
}

/**
 * Scenario test result
 */
export interface ScenarioTestResult {
  scenario: ScenarioDefinition;
  passed: boolean;
  backtestResult: BacktestResult;
  validationResults: ValidationResult[];
  score: number;
  executionTimeMs: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  check: string;
  passed: boolean;
  expected: string;
  actual: string;
  severity: 'info' | 'warning' | 'error';
}

/**
 * Scenario suite
 */
export interface ScenarioSuite {
  name: string;
  description: string;
  scenarios: ScenarioDefinition[];
  config: {
    backtest: Partial<BacktestConfig>;
    strategy: Partial<StrategyConfig>;
  };
}

/**
 * Stress test configuration
 */
export interface StressTestConfig {
  iterations: number;
  parameterVariations: number;
  shockEvents: ShockEvent[];
  concurrentScenarios: boolean;
}

/**
 * Shock event for stress testing
 */
export interface ShockEvent {
  type: 'price_shock' | 'liquidity_shock' | 'volatility_shock' | 'orderflow_shock';
  magnitude: number;
  durationMs: number;
  probability: number;
}

// ============================================================================
// PREDEFINED SCENARIOS
// ============================================================================

/**
 * Strong uptrend scenario
 */
export const TREND_UP_SCENARIO: ScenarioDefinition = {
  name: 'Strong Uptrend',
  type: 'trend_up',
  description: 'Sustained upward price movement with positive orderflow',
  durationMs: 24 * 60 * 60 * 1000, // 24 hours
  parameters: {
    priceTrend: 0.8,
    priceVolatility: 0.3,
    priceNoise: 0.2,
    volumeLevel: 0.7,
    volumeSpikes: true,
    volumeTrend: 0.3,
    spreadBase: 5,
    spreadVolatility: 0.2,
    depthImbalance: 0.4,
    deltaBias: 0.6,
    deltaVolatility: 0.4,
    cvdTrend: 0.7,
    burstFrequency: 0.3,
    burstSize: 5,
    burstDirection: 'buy',
    includeGaps: false,
    gapProbability: 0,
    includeAbsorption: true,
    absorptionFrequency: 0.1,
  },
  expectedBehavior: {
    minTrades: 5,
    maxTrades: 50,
    minWinRate: 40,
    maxWinRate: 100,
    maxDrawdownPct: 15,
    expectedRegime: ['TR', 'EV'],
    shouldTrade: true,
  },
};

/**
 * Strong downtrend scenario
 */
export const TREND_DOWN_SCENARIO: ScenarioDefinition = {
  name: 'Strong Downtrend',
  type: 'trend_down',
  description: 'Sustained downward price movement with negative orderflow',
  durationMs: 24 * 60 * 60 * 1000,
  parameters: {
    priceTrend: -0.8,
    priceVolatility: 0.3,
    priceNoise: 0.2,
    volumeLevel: 0.7,
    volumeSpikes: true,
    volumeTrend: 0.3,
    spreadBase: 5,
    spreadVolatility: 0.2,
    depthImbalance: -0.4,
    deltaBias: -0.6,
    deltaVolatility: 0.4,
    cvdTrend: -0.7,
    burstFrequency: 0.3,
    burstSize: 5,
    burstDirection: 'sell',
    includeGaps: false,
    gapProbability: 0,
    includeAbsorption: true,
    absorptionFrequency: 0.1,
  },
  expectedBehavior: {
    minTrades: 5,
    maxTrades: 50,
    minWinRate: 40,
    maxWinRate: 100,
    maxDrawdownPct: 15,
    expectedRegime: ['TR', 'EV'],
    shouldTrade: true,
  },
};

/**
 * Range-bound market scenario
 */
export const RANGE_BOUND_SCENARIO: ScenarioDefinition = {
  name: 'Range-Bound Market',
  type: 'range_bound',
  description: 'Price oscillating within a defined range, mean-reverting behavior',
  durationMs: 24 * 60 * 60 * 1000,
  parameters: {
    priceTrend: 0,
    priceVolatility: 0.4,
    priceNoise: 0.5,
    volumeLevel: 0.5,
    volumeSpikes: false,
    volumeTrend: 0,
    spreadBase: 3,
    spreadVolatility: 0.3,
    depthImbalance: 0,
    deltaBias: 0,
    deltaVolatility: 0.5,
    cvdTrend: 0,
    burstFrequency: 0.1,
    burstSize: 3,
    burstDirection: 'mixed',
    includeGaps: false,
    gapProbability: 0,
    includeAbsorption: true,
    absorptionFrequency: 0.3,
  },
  expectedBehavior: {
    minTrades: 10,
    maxTrades: 100,
    minWinRate: 45,
    maxWinRate: 100,
    maxDrawdownPct: 10,
    expectedRegime: ['MR'],
    shouldTrade: true,
  },
};

/**
 * High volatility scenario
 */
export const HIGH_VOLATILITY_SCENARIO: ScenarioDefinition = {
  name: 'High Volatility',
  type: 'high_volatility',
  description: 'Extreme price swings with high volume and wide spreads',
  durationMs: 12 * 60 * 60 * 1000, // 12 hours
  parameters: {
    priceTrend: 0,
    priceVolatility: 0.9,
    priceNoise: 0.7,
    volumeLevel: 0.9,
    volumeSpikes: true,
    volumeTrend: 0.5,
    spreadBase: 20,
    spreadVolatility: 0.8,
    depthImbalance: 0.3,
    deltaBias: 0,
    deltaVolatility: 0.9,
    cvdTrend: 0,
    burstFrequency: 0.6,
    burstSize: 10,
    burstDirection: 'mixed',
    includeGaps: true,
    gapProbability: 0.1,
    includeAbsorption: true,
    absorptionFrequency: 0.2,
  },
  expectedBehavior: {
    minTrades: 0,
    maxTrades: 30,
    minWinRate: 0,
    maxWinRate: 100,
    maxDrawdownPct: 25,
    expectedRegime: ['EV'],
    shouldTrade: false, // May reduce position size or pause
  },
};

/**
 * Low volatility scenario
 */
export const LOW_VOLATILITY_SCENARIO: ScenarioDefinition = {
  name: 'Low Volatility',
  type: 'low_volatility',
  description: 'Quiet market with minimal price movement and low volume',
  durationMs: 24 * 60 * 60 * 1000,
  parameters: {
    priceTrend: 0,
    priceVolatility: 0.1,
    priceNoise: 0.1,
    volumeLevel: 0.2,
    volumeSpikes: false,
    volumeTrend: 0,
    spreadBase: 2,
    spreadVolatility: 0.1,
    depthImbalance: 0,
    deltaBias: 0,
    deltaVolatility: 0.2,
    cvdTrend: 0,
    burstFrequency: 0.05,
    burstSize: 2,
    burstDirection: 'mixed',
    includeGaps: false,
    gapProbability: 0,
    includeAbsorption: false,
    absorptionFrequency: 0,
  },
  expectedBehavior: {
    minTrades: 0,
    maxTrades: 10,
    minWinRate: 0,
    maxWinRate: 100,
    maxDrawdownPct: 5,
    expectedRegime: ['MR'],
    shouldTrade: false, // Should wait for better conditions
  },
};

/**
 * Low liquidity scenario
 */
export const LOW_LIQUIDITY_SCENARIO: ScenarioDefinition = {
  name: 'Low Liquidity',
  type: 'low_liquidity',
  description: 'Thin order book with wide spreads and slippage',
  durationMs: 12 * 60 * 60 * 1000,
  parameters: {
    priceTrend: 0.1,
    priceVolatility: 0.5,
    priceNoise: 0.4,
    volumeLevel: 0.2,
    volumeSpikes: false,
    volumeTrend: 0,
    spreadBase: 50,
    spreadVolatility: 0.6,
    depthImbalance: 0.5,
    deltaBias: 0.2,
    deltaVolatility: 0.5,
    cvdTrend: 0.1,
    burstFrequency: 0.1,
    burstSize: 3,
    burstDirection: 'mixed',
    includeGaps: true,
    gapProbability: 0.05,
    includeAbsorption: false,
    absorptionFrequency: 0,
  },
  expectedBehavior: {
    minTrades: 0,
    maxTrades: 5,
    minWinRate: 0,
    maxWinRate: 100,
    maxDrawdownPct: 10,
    expectedRegime: ['TR'],
    shouldTrade: false, // Should avoid due to slippage
  },
};

/**
 * Flash crash scenario
 */
export const FLASH_CRASH_SCENARIO: ScenarioDefinition = {
  name: 'Flash Crash',
  type: 'flash_crash',
  description: 'Sudden severe price drop with panic selling',
  durationMs: 2 * 60 * 60 * 1000, // 2 hours
  parameters: {
    priceTrend: -0.95,
    priceVolatility: 1.0,
    priceNoise: 0.5,
    volumeLevel: 1.0,
    volumeSpikes: true,
    volumeTrend: 0.8,
    spreadBase: 100,
    spreadVolatility: 1.0,
    depthImbalance: -0.8,
    deltaBias: -0.9,
    deltaVolatility: 1.0,
    cvdTrend: -0.9,
    burstFrequency: 0.9,
    burstSize: 20,
    burstDirection: 'sell',
    includeGaps: true,
    gapProbability: 0.3,
    includeAbsorption: true,
    absorptionFrequency: 0.4,
  },
  expectedBehavior: {
    minTrades: 0,
    maxTrades: 5,
    minWinRate: 0,
    maxWinRate: 100,
    maxDrawdownPct: 30,
    expectedRegime: ['EV'],
    shouldTrade: false, // Should pause trading
  },
};

/**
 * Flash pump scenario
 */
export const FLASH_PUMP_SCENARIO: ScenarioDefinition = {
  name: 'Flash Pump',
  type: 'flash_pump',
  description: 'Sudden severe price spike with FOMO buying',
  durationMs: 2 * 60 * 60 * 1000,
  parameters: {
    priceTrend: 0.95,
    priceVolatility: 1.0,
    priceNoise: 0.5,
    volumeLevel: 1.0,
    volumeSpikes: true,
    volumeTrend: 0.8,
    spreadBase: 100,
    spreadVolatility: 1.0,
    depthImbalance: 0.8,
    deltaBias: 0.9,
    deltaVolatility: 1.0,
    cvdTrend: 0.9,
    burstFrequency: 0.9,
    burstSize: 20,
    burstDirection: 'buy',
    includeGaps: true,
    gapProbability: 0.3,
    includeAbsorption: true,
    absorptionFrequency: 0.4,
  },
  expectedBehavior: {
    minTrades: 0,
    maxTrades: 5,
    minWinRate: 0,
    maxWinRate: 100,
    maxDrawdownPct: 30,
    expectedRegime: ['EV'],
    shouldTrade: false,
  },
};

/**
 * Choppy market scenario
 */
export const CHOPPY_SCENARIO: ScenarioDefinition = {
  name: 'Choppy Market',
  type: 'choppy',
  description: 'Rapid direction changes with no clear trend',
  durationMs: 12 * 60 * 60 * 1000,
  parameters: {
    priceTrend: 0,
    priceVolatility: 0.6,
    priceNoise: 0.8,
    volumeLevel: 0.6,
    volumeSpikes: true,
    volumeTrend: 0,
    spreadBase: 8,
    spreadVolatility: 0.5,
    depthImbalance: 0,
    deltaBias: 0,
    deltaVolatility: 0.7,
    cvdTrend: 0,
    burstFrequency: 0.4,
    burstSize: 5,
    burstDirection: 'mixed',
    includeGaps: false,
    gapProbability: 0,
    includeAbsorption: true,
    absorptionFrequency: 0.3,
  },
  expectedBehavior: {
    minTrades: 0,
    maxTrades: 20,
    minWinRate: 30,
    maxWinRate: 100,
    maxDrawdownPct: 15,
    expectedRegime: ['TR', 'MR'],
    shouldTrade: false, // Should reduce size or pause
  },
};

/**
 * Normal market scenario
 */
export const NORMAL_SCENARIO: ScenarioDefinition = {
  name: 'Normal Market',
  type: 'normal',
  description: 'Typical market conditions with moderate volatility',
  durationMs: 24 * 60 * 60 * 1000,
  parameters: {
    priceTrend: 0.1,
    priceVolatility: 0.4,
    priceNoise: 0.3,
    volumeLevel: 0.5,
    volumeSpikes: true,
    volumeTrend: 0.1,
    spreadBase: 5,
    spreadVolatility: 0.3,
    depthImbalance: 0.1,
    deltaBias: 0.1,
    deltaVolatility: 0.4,
    cvdTrend: 0.1,
    burstFrequency: 0.2,
    burstSize: 4,
    burstDirection: 'mixed',
    includeGaps: false,
    gapProbability: 0.01,
    includeAbsorption: true,
    absorptionFrequency: 0.15,
  },
  expectedBehavior: {
    minTrades: 10,
    maxTrades: 80,
    minWinRate: 45,
    maxWinRate: 100,
    maxDrawdownPct: 12,
    expectedRegime: ['TR', 'MR'],
    shouldTrade: true,
  },
};

/**
 * All predefined scenarios
 */
export const ALL_SCENARIOS: ScenarioDefinition[] = [
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
];

// ============================================================================
// SCENARIO LOADER CLASS
// ============================================================================

/**
 * Scenario Loader
 * 
 * Main class for loading and executing market scenarios.
 */
export class ScenarioLoader {
  private scenarios: Map<string, ScenarioDefinition> = new Map();
  private harness: StrategyResearchHarness;

  constructor(harness: StrategyResearchHarness) {
    this.harness = harness;
    this.registerDefaultScenarios();
  }

  /**
   * Register default scenarios
   */
  private registerDefaultScenarios(): void {
    for (const scenario of ALL_SCENARIOS) {
      this.scenarios.set(scenario.name, scenario);
    }
  }

  /**
   * Register a custom scenario
   */
  registerScenario(scenario: ScenarioDefinition): void {
    this.scenarios.set(scenario.name, scenario);
  }

  /**
   * Get a scenario by name
   */
  getScenario(name: string): ScenarioDefinition | undefined {
    return this.scenarios.get(name);
  }

  /**
   * Get all scenarios
   */
  getAllScenarios(): ScenarioDefinition[] {
    return Array.from(this.scenarios.values());
  }

  /**
   * Get scenarios by type
   */
  getScenariosByType(type: ScenarioType): ScenarioDefinition[] {
    return Array.from(this.scenarios.values()).filter(s => s.type === type);
  }

  /**
   * Generate synthetic market data for a scenario
   */
  generateScenarioData(
    scenario: ScenarioDefinition,
    basePrice: number = 50000,
    startTime: number = Date.now()
  ): MarketTick[] {
    const ticks: MarketTick[] = [];
    const params = scenario.parameters;
    const tickIntervalMs = 1000; // 1 second per tick
    const numTicks = Math.floor(scenario.durationMs / tickIntervalMs);

    let currentPrice = basePrice;
    let vwap = basePrice;
    let cvd = 0;
    let lastPrice = basePrice;

    for (let i = 0; i < numTicks; i++) {
      const timestampMs = startTime + i * tickIntervalMs;

      // Generate price movement
      const trendComponent = params.priceTrend * 0.001;
      const volatilityComponent = (Math.random() - 0.5) * params.priceVolatility * 0.01;
      const noiseComponent = (Math.random() - 0.5) * params.priceNoise * 0.005;

      // Apply gap if enabled
      if (params.includeGaps && Math.random() < params.gapProbability) {
        const gapSize = (Math.random() - 0.5) * params.priceVolatility * 0.05;
        currentPrice *= (1 + gapSize);
      }

      const priceChange = trendComponent + volatilityComponent + noiseComponent;
      currentPrice *= (1 + priceChange);

      // Generate VWAP (smoothed price)
      vwap = vwap * 0.99 + currentPrice * 0.01;

      // Generate delta based on bias and volatility
      const deltaZ = params.deltaBias * 2 + (Math.random() - 0.5) * params.deltaVolatility * 4;

      // Generate CVD slope
      const cvdSlope = params.cvdTrend * 0.5 + (Math.random() - 0.5) * 0.3;
      cvd += cvdSlope;

      // Generate OBI
      const obiDeep = params.depthImbalance * 0.5 + (Math.random() - 0.5) * 0.3;
      const obiWeighted = obiDeep * 0.8 + (Math.random() - 0.5) * 0.2;
      const obiDivergence = (currentPrice - lastPrice) * obiDeep * 100;

      // Generate volume
      const baseVolume = 100 * params.volumeLevel;
      const volumeSpike = params.volumeSpikes && Math.random() < 0.1 ? 3 : 1;
      const aggressiveBuyVolume = baseVolume * (0.5 + params.deltaBias * 0.3) * volumeSpike;
      const aggressiveSellVolume = baseVolume * (0.5 - params.deltaBias * 0.3) * volumeSpike;

      // Generate bursts
      let burstCount = 0;
      let burstSide: 'buy' | 'sell' | null = null;
      if (Math.random() < params.burstFrequency) {
        burstCount = Math.floor(Math.random() * params.burstSize) + 1;
        burstSide = params.burstDirection === 'mixed'
          ? (Math.random() > 0.5 ? 'buy' : 'sell')
          : params.burstDirection;
      }

      // Generate spread
      const spreadBps = params.spreadBase * (1 + Math.random() * params.spreadVolatility);
      const spreadPct = spreadBps / 100;

      // Generate volatility
      const volatility = params.priceVolatility * (0.8 + Math.random() * 0.4);

      // Generate absorption
      let absorption: { value: number; side: 'buy' | 'sell' } | null = null;
      if (params.includeAbsorption && Math.random() < params.absorptionFrequency) {
        absorption = {
          value: Math.random() * 10,
          side: Math.random() > 0.5 ? 'buy' : 'sell',
        };
      }

      ticks.push({
        timestampMs,
        symbol: 'BTC-USD',
        price: currentPrice,
        vwap,
        deltaZ,
        cvdSlope,
        obiDeep,
        obiWeighted,
        obiDivergence,
        delta1s: deltaZ * (0.5 + Math.random() * 0.5),
        delta5s: deltaZ * (0.3 + Math.random() * 0.3),
        spreadPct,
        volatility,
        aggressiveBuyVolume,
        aggressiveSellVolume,
        printsPerSecond: params.volumeLevel * 10 * (0.5 + Math.random()),
        tradeCount: Math.floor(params.volumeLevel * 100),
        consecutiveBurst: {
          count: burstCount,
          side: burstSide,
        },
        absorption,
        openInterest: {
          oiChangePct: (Math.random() - 0.5) * 2,
          source: 'real',
        },
      });

      lastPrice = currentPrice;
    }

    return ticks;
  }

  /**
   * Run a single scenario test
   */
  async runScenarioTest(scenario: ScenarioDefinition): Promise<ScenarioTestResult> {
    const startTime = Date.now();

    // Generate scenario data
    const ticks = this.generateScenarioData(scenario);

    // Reset harness
    this.harness.reset();

    // Run backtest
    const backtestResult = await this.harness.runBacktest(ticks);

    // Validate results
    const validationResults = this.validateScenario(scenario, backtestResult);

    // Calculate score
    const score = this.calculateScenarioScore(scenario, backtestResult, validationResults);

    // Determine if passed
    const passed = validationResults.every(v => v.severity !== 'error' && v.passed);

    return {
      scenario,
      passed,
      backtestResult,
      validationResults,
      score,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Run multiple scenarios
   */
  async runScenarioSuite(scenarios: ScenarioDefinition[]): Promise<ScenarioTestResult[]> {
    const results: ScenarioTestResult[] = [];

    for (const scenario of scenarios) {
      console.log(`[ScenarioLoader] Running scenario: ${scenario.name}`);
      const result = await this.runScenarioTest(scenario);
      results.push(result);

      console.log(`[ScenarioLoader] ${scenario.name}: ${result.passed ? 'PASSED' : 'FAILED'} (score: ${result.score.toFixed(2)})`);
    }

    return results;
  }

  /**
   * Run all registered scenarios
   */
  async runAllScenarios(): Promise<ScenarioTestResult[]> {
    return this.runScenarioSuite(this.getAllScenarios());
  }

  /**
   * Validate scenario results against expected behavior
   */
  private validateScenario(
    scenario: ScenarioDefinition,
    result: BacktestResult
  ): ValidationResult[] {
    const validations: ValidationResult[] = [];
    const expected = scenario.expectedBehavior;
    const metrics = result.metrics;

    // Check trade count
    validations.push({
      check: 'Trade Count',
      passed: metrics.totalTrades >= expected.minTrades && metrics.totalTrades <= expected.maxTrades,
      expected: `${expected.minTrades} - ${expected.maxTrades}`,
      actual: `${metrics.totalTrades}`,
      severity: metrics.totalTrades < expected.minTrades && expected.shouldTrade ? 'error' : 'info',
    });

    // Check win rate
    if (metrics.totalTrades > 0) {
      validations.push({
        check: 'Win Rate',
        passed: metrics.winRate >= expected.minWinRate && metrics.winRate <= expected.maxWinRate,
        expected: `${expected.minWinRate}% - ${expected.maxWinRate}%`,
        actual: `${metrics.winRate.toFixed(2)}%`,
        severity: metrics.winRate < expected.minWinRate ? 'warning' : 'info',
      });
    }

    // Check max drawdown
    validations.push({
      check: 'Max Drawdown',
      passed: metrics.maxDrawdownPct <= expected.maxDrawdownPct,
      expected: `< ${expected.maxDrawdownPct}%`,
      actual: `${metrics.maxDrawdownPct.toFixed(2)}%`,
      severity: metrics.maxDrawdownPct > expected.maxDrawdownPct ? 'error' : 'info',
    });

    // Check regime detection
    const regimes = new Set(result.decisionLogs.map(d => d.regime));
    const expectedRegimes = new Set(expected.expectedRegime);
    const detectedExpected = Array.from(regimes).some(r => expectedRegimes.has(r));

    validations.push({
      check: 'Regime Detection',
      passed: detectedExpected,
      expected: expected.expectedRegime.join(', '),
      actual: Array.from(regimes).join(', '),
      severity: detectedExpected ? 'info' : 'warning',
    });

    // Check Sharpe ratio
    validations.push({
      check: 'Sharpe Ratio',
      passed: metrics.sharpeRatio > 0,
      expected: '> 0',
      actual: metrics.sharpeRatio.toFixed(2),
      severity: metrics.sharpeRatio < 0 ? 'warning' : 'info',
    });

    // Check profit factor
    validations.push({
      check: 'Profit Factor',
      passed: metrics.profitFactor > 1 || metrics.totalTrades === 0,
      expected: '> 1',
      actual: metrics.profitFactor.toFixed(2),
      severity: metrics.profitFactor < 1 && metrics.totalTrades > 0 ? 'warning' : 'info',
    });

    return validations;
  }

  /**
   * Calculate scenario score
   */
  private calculateScenarioScore(
    scenario: ScenarioDefinition,
    result: BacktestResult,
    validations: ValidationResult[]
  ): number {
    let score = 0;
    const metrics = result.metrics;

    // Base score from metrics
    score += Math.min(metrics.winRate / 50, 1) * 20;
    score += Math.min(metrics.profitFactor / 2, 1) * 20;
    score += Math.min(Math.max(metrics.sharpeRatio, 0) / 2, 1) * 20;
    score += Math.max(0, 1 - metrics.maxDrawdownPct / 20) * 20;

    // Validation bonus/penalty
    const passedValidations = validations.filter(v => v.passed).length;
    score += (passedValidations / validations.length) * 20;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Create a composite scenario
   */
  createCompositeScenario(
    name: string,
    scenarios: { scenario: ScenarioDefinition; durationPct: number }[]
  ): ScenarioDefinition {
    const totalDuration = scenarios.reduce((sum, s) => sum + s.scenario.durationMs * s.durationPct, 0);

    // Average parameters weighted by duration
    const avgParams: ScenarioParameters = {
      priceTrend: 0,
      priceVolatility: 0,
      priceNoise: 0,
      volumeLevel: 0,
      volumeSpikes: false,
      volumeTrend: 0,
      spreadBase: 0,
      spreadVolatility: 0,
      depthImbalance: 0,
      deltaBias: 0,
      deltaVolatility: 0,
      cvdTrend: 0,
      burstFrequency: 0,
      burstSize: 0,
      burstDirection: 'mixed',
      includeGaps: false,
      gapProbability: 0,
      includeAbsorption: false,
      absorptionFrequency: 0,
    };

    for (const { scenario, durationPct } of scenarios) {
      const weight = (scenario.durationMs * durationPct) / totalDuration;
      avgParams.priceTrend += scenario.parameters.priceTrend * weight;
      avgParams.priceVolatility += scenario.parameters.priceVolatility * weight;
      avgParams.priceNoise += scenario.parameters.priceNoise * weight;
      avgParams.volumeLevel += scenario.parameters.volumeLevel * weight;
      avgParams.volumeTrend += scenario.parameters.volumeTrend * weight;
      avgParams.spreadBase += scenario.parameters.spreadBase * weight;
      avgParams.spreadVolatility += scenario.parameters.spreadVolatility * weight;
      avgParams.depthImbalance += scenario.parameters.depthImbalance * weight;
      avgParams.deltaBias += scenario.parameters.deltaBias * weight;
      avgParams.deltaVolatility += scenario.parameters.deltaVolatility * weight;
      avgParams.cvdTrend += scenario.parameters.cvdTrend * weight;
      avgParams.burstFrequency += scenario.parameters.burstFrequency * weight;
      avgParams.burstSize += scenario.parameters.burstSize * weight;
      avgParams.gapProbability += scenario.parameters.gapProbability * weight;
      avgParams.absorptionFrequency += scenario.parameters.absorptionFrequency * weight;
    }

    return {
      name,
      type: 'normal',
      description: `Composite scenario: ${scenarios.map(s => s.scenario.name).join(' + ')}`,
      durationMs: totalDuration,
      parameters: avgParams,
      expectedBehavior: {
        minTrades: 10,
        maxTrades: 100,
        minWinRate: 40,
        maxWinRate: 100,
        maxDrawdownPct: 15,
        expectedRegime: ['TR', 'MR', 'EV'],
        shouldTrade: true,
      },
    };
  }

  /**
   * Run stress test with random shocks
   */
  async runStressTest(config: StressTestConfig): Promise<ScenarioTestResult[]> {
    const results: ScenarioTestResult[] = [];

    for (let i = 0; i < config.iterations; i++) {
      // Create random scenario with shocks
      const baseScenario = ALL_SCENARIOS[Math.floor(Math.random() * ALL_SCENARIOS.length)];
      const stressedScenario = this.applyRandomShocks(baseScenario, config.shockEvents);

      console.log(`[ScenarioLoader] Stress test iteration ${i + 1}/${config.iterations}`);
      const result = await this.runScenarioTest(stressedScenario);
      results.push(result);
    }

    return results;
  }

  /**
   * Apply random shocks to a scenario
   */
  private applyRandomShocks(
    scenario: ScenarioDefinition,
    shocks: ShockEvent[]
  ): ScenarioDefinition {
    const modified = { ...scenario, parameters: { ...scenario.parameters } };

    for (const shock of shocks) {
      if (Math.random() < shock.probability) {
        switch (shock.type) {
          case 'price_shock':
            modified.parameters.priceVolatility *= (1 + shock.magnitude);
            modified.parameters.priceTrend *= (1 + shock.magnitude * (Math.random() > 0.5 ? 1 : -1));
            break;
          case 'liquidity_shock':
            modified.parameters.spreadBase *= (1 + shock.magnitude);
            modified.parameters.volumeLevel *= (1 - shock.magnitude * 0.5);
            break;
          case 'volatility_shock':
            modified.parameters.priceVolatility *= (1 + shock.magnitude);
            modified.parameters.deltaVolatility *= (1 + shock.magnitude);
            break;
          case 'orderflow_shock':
            modified.parameters.deltaBias *= (1 + shock.magnitude);
            modified.parameters.burstFrequency *= (1 + shock.magnitude);
            break;
        }
      }
    }

    return modified;
  }
}

// ============================================================================
// SCENARIO SUITE DEFINITIONS
// ============================================================================

/**
 * Comprehensive test suite
 */
export const COMPREHENSIVE_SUITE: ScenarioSuite = {
  name: 'Comprehensive Test Suite',
  description: 'Full test coverage across all market conditions',
  scenarios: ALL_SCENARIOS,
  config: {
    backtest: {
      initialEquity: 100000,
      positionSize: 0.1,
      leverage: 1,
    },
    strategy: {},
  },
};

/**
 * Trend-following test suite
 */
export const TREND_FOLLOWING_SUITE: ScenarioSuite = {
  name: 'Trend Following Suite',
  description: 'Tests strategy performance in trending markets',
  scenarios: [TREND_UP_SCENARIO, TREND_DOWN_SCENARIO, CHOPPY_SCENARIO],
  config: {
    backtest: {
      initialEquity: 100000,
      positionSize: 0.15,
      leverage: 1,
    },
    strategy: {
      dfsEntryLongBase: 0.8,
      dfsEntryShortBase: 0.2,
    },
  },
};

/**
 * Mean reversion test suite
 */
export const MEAN_REVERSION_SUITE: ScenarioSuite = {
  name: 'Mean Reversion Suite',
  description: 'Tests strategy performance in range-bound markets',
  scenarios: [RANGE_BOUND_SCENARIO, NORMAL_SCENARIO, LOW_VOLATILITY_SCENARIO],
  config: {
    backtest: {
      initialEquity: 100000,
      positionSize: 0.08,
      leverage: 1,
    },
    strategy: {
      dfsEntryLongBase: 0.9,
      dfsEntryShortBase: 0.1,
    },
  },
};

/**
 * Risk management test suite
 */
export const RISK_MANAGEMENT_SUITE: ScenarioSuite = {
  name: 'Risk Management Suite',
  description: 'Tests risk controls under extreme conditions',
  scenarios: [FLASH_CRASH_SCENARIO, FLASH_PUMP_SCENARIO, HIGH_VOLATILITY_SCENARIO, LOW_LIQUIDITY_SCENARIO],
  config: {
    backtest: {
      initialEquity: 100000,
      positionSize: 0.05,
      leverage: 1,
      stopLossPct: 0.01,
    },
    strategy: {
      hardRevDfsP: 0.1,
      hardRevTicks: 3,
    },
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format scenario test results
 */
export function formatScenarioResults(results: ScenarioTestResult[]): string {
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  let output = `
=== Scenario Test Results ===
Passed: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)
Average Score: ${avgScore.toFixed(2)}

`;

  for (const result of results) {
    output += `\n${result.scenario.name}: ${result.passed ? '✓ PASSED' : '✗ FAILED'} (${result.score.toFixed(1)})\n`;
    output += `  Duration: ${(result.scenario.durationMs / 3600000).toFixed(1)}h\n`;
    output += `  Trades: ${result.backtestResult.metrics.totalTrades}\n`;
    output += `  Win Rate: ${result.backtestResult.metrics.winRate.toFixed(1)}%\n`;
    output += `  PnL: $${result.backtestResult.metrics.netProfit.toFixed(2)}\n`;
    output += `  Max DD: ${result.backtestResult.metrics.maxDrawdownPct.toFixed(1)}%\n`;

    for (const validation of result.validationResults) {
      const icon = validation.passed ? '✓' : validation.severity === 'error' ? '✗' : '⚠';
      output += `  ${icon} ${validation.check}: ${validation.actual} (expected: ${validation.expected})\n`;
    }
  }

  return output;
}

/**
 * Create a custom scenario from partial parameters
 */
export function createScenario(
  name: string,
  type: ScenarioType,
  partialParams: Partial<ScenarioParameters>,
  durationHours: number = 24
): ScenarioDefinition {
  const baseScenario = ALL_SCENARIOS.find(s => s.type === type) || NORMAL_SCENARIO;

  return {
    name,
    type,
    description: `Custom ${type} scenario`,
    durationMs: durationHours * 60 * 60 * 1000,
    parameters: {
      ...baseScenario.parameters,
      ...partialParams,
    },
    expectedBehavior: baseScenario.expectedBehavior,
  };
}

/**
 * Export scenario results to JSON
 */
export function exportScenarioResults(results: ScenarioTestResult[], filePath: string): void {
  const fs = require('fs');

  const exportData = results.map(r => ({
    scenario: r.scenario.name,
    type: r.scenario.type,
    passed: r.passed,
    score: r.score,
    metrics: {
      totalTrades: r.backtestResult.metrics.totalTrades,
      winRate: r.backtestResult.metrics.winRate,
      netProfit: r.backtestResult.metrics.netProfit,
      maxDrawdownPct: r.backtestResult.metrics.maxDrawdownPct,
      sharpeRatio: r.backtestResult.metrics.sharpeRatio,
      profitFactor: r.backtestResult.metrics.profitFactor,
    },
    validations: r.validationResults,
    executionTimeMs: r.executionTimeMs,
  }));

  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
}

// Export all types
export {
  MarketTick,
  BacktestResult,
  StrategyResearchHarness,
  BacktestConfig,
  StrategyConfig,
} from './strategy_research_harness';
