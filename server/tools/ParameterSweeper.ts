/**
 * Parameter Sweep Engine
 * 
 * Comprehensive parameter optimization system for trading strategies.
 * Supports grid search, random search, and genetic algorithm optimization.
 * 
 * Features:
 * - Grid search parameter sweeps
 * - Random search with configurable distributions
 * - Parallel execution support
 * - Results aggregation and ranking
 * - Pareto frontier analysis
 */

import {
  StrategyResearchHarness,
  MarketTick,
  BacktestResult,
  StrategyConfig,
  defaultStrategyConfig,
  PerformanceMetrics,
} from './strategy_research_harness';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Parameter definition for sweep
 */
export interface ParameterDefinition {
  name: string;
  type: 'float' | 'int' | 'bool' | 'choice';
  min?: number;
  max?: number;
  step?: number;
  choices?: (string | number | boolean)[];
  distribution?: 'uniform' | 'log' | 'normal';
  defaultValue?: number | boolean | string;
}

/**
 * Parameter space definition
 */
export interface ParameterSpace {
  parameters: ParameterDefinition[];
}

/**
 * Sweep configuration
 */
export interface SweepConfig {
  // Sweep method
  method: 'grid' | 'random' | 'genetic' | 'bayesian';

  // Iteration limits
  maxIterations: number;
  maxParallel: number;

  // Random search specific
  randomSeed?: number;

  // Genetic algorithm specific
  populationSize?: number;
  mutationRate?: number;
  crossoverRate?: number;
  elitismCount?: number;

  // Objective function
  objectiveMetric: keyof PerformanceMetrics | 'composite';
  objectiveDirection: 'maximize' | 'minimize';

  // Composite objective weights (if using composite)
  compositeWeights?: Partial<Record<keyof PerformanceMetrics, number>>;

  // Constraints
  constraints?: SweepConstraint[];

  // Early stopping
  earlyStopping?: {
    enabled: boolean;
    patience: number;
    minImprovement: number;
  };

  // Progress callback
  onProgress?: (progress: SweepProgress) => void;
}

/**
 * Sweep constraint
 */
export interface SweepConstraint {
  metric: keyof PerformanceMetrics;
  operator: '>' | '<' | '>=' | '<=' | '==';
  value: number;
}

/**
 * Sweep progress
 */
export interface SweepProgress {
  currentIteration: number;
  totalIterations: number;
  bestScore: number;
  bestConfig: StrategyConfig | null;
  currentConfig: StrategyConfig;
  elapsedMs: number;
  estimatedRemainingMs: number;
}

/**
 * Sweep result
 */
export interface SweepResult {
  config: SweepConfig;
  startTime: number;
  endTime: number;
  totalIterations: number;
  completedIterations: number;

  // Results
  allResults: ParameterSetResult[];
  topResults: ParameterSetResult[];
  paretoFrontier: ParameterSetResult[];

  // Best result
  bestResult: ParameterSetResult | null;

  // Statistics
  statistics: SweepStatistics;
}

/**
 * Single parameter set result
 */
export interface ParameterSetResult {
  id: string;
  parameters: StrategyConfig;
  metrics: PerformanceMetrics;
  score: number;
  rank: number;
  backtestResult: BacktestResult;
  executionTimeMs: number;
  passedConstraints: boolean;
}

/**
 * Sweep statistics
 */
export interface SweepStatistics {
  avgExecutionTimeMs: number;
  minScore: number;
  maxScore: number;
  avgScore: number;
  scoreStdDev: number;
  constraintPassRate: number;
}

/**
 * Genetic algorithm individual
 */
interface GeneticIndividual {
  parameters: StrategyConfig;
  fitness: number;
  metrics: PerformanceMetrics | null;
  backtestResult: BacktestResult | null;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default parameter space for NewStrategyV11
 */
export const defaultParameterSpace: ParameterSpace = {
  parameters: [
    {
      name: 'dfsEntryLongBase',
      type: 'float',
      min: 0.7,
      max: 0.95,
      step: 0.05,
      defaultValue: 0.85,
    },
    {
      name: 'dfsEntryShortBase',
      type: 'float',
      min: 0.05,
      max: 0.3,
      step: 0.05,
      defaultValue: 0.15,
    },
    {
      name: 'dfsBreakLongBase',
      type: 'float',
      min: 0.15,
      max: 0.4,
      step: 0.05,
      defaultValue: 0.25,
    },
    {
      name: 'dfsBreakShortBase',
      type: 'float',
      min: 0.6,
      max: 0.85,
      step: 0.05,
      defaultValue: 0.75,
    },
    {
      name: 'volHighP',
      type: 'float',
      min: 0.6,
      max: 0.9,
      step: 0.05,
      defaultValue: 0.8,
    },
    {
      name: 'volLowP',
      type: 'float',
      min: 0.1,
      max: 0.4,
      step: 0.05,
      defaultValue: 0.2,
    },
    {
      name: 'cooldownFlipS',
      type: 'int',
      min: 10,
      max: 60,
      step: 5,
      defaultValue: 30,
    },
    {
      name: 'cooldownSameS',
      type: 'int',
      min: 5,
      max: 30,
      step: 5,
      defaultValue: 15,
    },
    {
      name: 'mhtEVs',
      type: 'int',
      min: 60,
      max: 180,
      step: 15,
      defaultValue: 120,
    },
    {
      name: 'mhtMRs',
      type: 'int',
      min: 20,
      max: 90,
      step: 5,
      defaultValue: 45,
    },
    {
      name: 'mhtTRs',
      type: 'int',
      min: 30,
      max: 120,
      step: 10,
      defaultValue: 60,
    },
    {
      name: 'regimeLockTRMRTicks',
      type: 'int',
      min: 1,
      max: 5,
      step: 1,
      defaultValue: 3,
    },
    {
      name: 'regimeLockEVTicks',
      type: 'int',
      min: 1,
      max: 4,
      step: 1,
      defaultValue: 2,
    },
    {
      name: 'hardRevDfsP',
      type: 'float',
      min: 0.05,
      max: 0.3,
      step: 0.05,
      defaultValue: 0.15,
    },
    {
      name: 'hardRevTicks',
      type: 'int',
      min: 3,
      max: 10,
      step: 1,
      defaultValue: 5,
    },
    {
      name: 'hardRevRequireAbsorption',
      type: 'bool',
      defaultValue: true,
    },
  ],
};

/**
 * Default sweep configuration
 */
export const defaultSweepConfig: SweepConfig = {
  method: 'grid',
  maxIterations: 1000,
  maxParallel: 4,
  objectiveMetric: 'netProfit',
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
  ],
  earlyStopping: {
    enabled: true,
    patience: 50,
    minImprovement: 0.01,
  },
};

// ============================================================================
// PARAMETER SWEEPER CLASS
// ============================================================================

/**
 * Parameter Sweep Engine
 * 
 * Main class for running parameter optimization sweeps.
 */
export class ParameterSweeper {
  private parameterSpace: ParameterSpace;
  private sweepConfig: SweepConfig;
  private marketData: MarketTick[];

  // Results storage
  private results: ParameterSetResult[] = [];
  private bestScore: number = -Infinity;
  private bestConfig: StrategyConfig | null = null;
  private iterationsWithoutImprovement: number = 0;

  // Timing
  private startTime: number = 0;
  private lastImprovementTime: number = 0;

  constructor(
    parameterSpace: ParameterSpace = defaultParameterSpace,
    sweepConfig: Partial<SweepConfig> = {},
    marketData: MarketTick[]
  ) {
    this.parameterSpace = parameterSpace;
    this.sweepConfig = { ...defaultSweepConfig, ...sweepConfig };
    this.marketData = marketData;
  }

  /**
   * Run the parameter sweep
   */
  async runSweep(): Promise<SweepResult> {
    this.startTime = Date.now();
    this.results = [];
    this.bestScore = this.sweepConfig.objectiveDirection === 'maximize' ? -Infinity : Infinity;
    this.bestConfig = null;
    this.iterationsWithoutImprovement = 0;

    console.log(`[ParameterSweeper] Starting ${this.sweepConfig.method} sweep`);
    console.log(`[ParameterSweeper] Max iterations: ${this.sweepConfig.maxIterations}`);
    console.log(`[ParameterSweeper] Objective: ${this.sweepConfig.objectiveDirection} ${this.sweepConfig.objectiveMetric}`);

    switch (this.sweepConfig.method) {
      case 'grid':
        await this.runGridSearch();
        break;
      case 'random':
        await this.runRandomSearch();
        break;
      case 'genetic':
        await this.runGeneticAlgorithm();
        break;
      case 'bayesian':
        await this.runBayesianOptimization();
        break;
      default:
        throw new Error(`Unknown sweep method: ${this.sweepConfig.method}`);
    }

    return this.buildResult();
  }

  /**
   * Run grid search sweep
   */
  private async runGridSearch(): Promise<void> {
    // Generate all parameter combinations
    const combinations = this.generateGridCombinations();
    const limitedCombinations = combinations.slice(0, this.sweepConfig.maxIterations);

    console.log(`[ParameterSweeper] Grid search: ${limitedCombinations.length} combinations`);

    // Execute in batches for parallel processing
    const batchSize = this.sweepConfig.maxParallel;
    for (let i = 0; i < limitedCombinations.length; i += batchSize) {
      const batch = limitedCombinations.slice(i, i + batchSize);
      await this.executeBatch(batch, i, limitedCombinations.length);

      // Check early stopping
      if (this.shouldStopEarly()) {
        console.log('[ParameterSweeper] Early stopping triggered');
        break;
      }
    }
  }

  /**
   * Run random search sweep
   */
  private async runRandomSearch(): Promise<void> {
    console.log(`[ParameterSweeper] Random search: ${this.sweepConfig.maxIterations} iterations`);

    // Set random seed if provided
    if (this.sweepConfig.randomSeed !== undefined) {
      this.setRandomSeed(this.sweepConfig.randomSeed);
    }

    for (let i = 0; i < this.sweepConfig.maxIterations; i++) {
      const params = this.generateRandomParameters();
      await this.evaluateParameters(params, i);

      // Check early stopping
      if (this.shouldStopEarly()) {
        console.log('[ParameterSweeper] Early stopping triggered');
        break;
      }
    }
  }

  /**
   * Run genetic algorithm optimization
   */
  private async runGeneticAlgorithm(): Promise<void> {
    const config = this.sweepConfig;
    const populationSize = config.populationSize || 50;
    const mutationRate = config.mutationRate || 0.1;
    const crossoverRate = config.crossoverRate || 0.8;
    const elitismCount = config.elitismCount || 5;

    console.log(`[ParameterSweeper] Genetic algorithm:`);
    console.log(`  Population: ${populationSize}`);
    console.log(`  Mutation rate: ${mutationRate}`);
    console.log(`  Crossover rate: ${crossoverRate}`);

    // Initialize population
    let population: GeneticIndividual[] = [];
    for (let i = 0; i < populationSize; i++) {
      population.push({
        parameters: this.generateRandomParameters(),
        fitness: 0,
        metrics: null,
        backtestResult: null,
      });
    }

    // Evolution loop
    const maxGenerations = Math.ceil(this.sweepConfig.maxIterations / populationSize);
    for (let generation = 0; generation < maxGenerations; generation++) {
      console.log(`[ParameterSweeper] Generation ${generation + 1}/${maxGenerations}`);

      // Evaluate population
      for (const individual of population) {
        if (individual.metrics === null) {
          const result = await this.evaluateParameters(individual.parameters, generation * populationSize);
          individual.fitness = result.score;
          individual.metrics = result.metrics;
          individual.backtestResult = result.backtestResult;
        }
      }

      // Sort by fitness
      population.sort((a, b) => b.fitness - a.fitness);

      // Update best
      if (population[0].fitness > this.bestScore) {
        this.bestScore = population[0].fitness;
        this.bestConfig = population[0].parameters;
        this.iterationsWithoutImprovement = 0;
        this.lastImprovementTime = Date.now();
      } else {
        this.iterationsWithoutImprovement++;
      }

      // Check early stopping
      if (this.shouldStopEarly()) {
        console.log('[ParameterSweeper] Early stopping triggered');
        break;
      }

      // Create next generation
      const newPopulation: GeneticIndividual[] = [];

      // Elitism
      newPopulation.push(...population.slice(0, elitismCount));

      // Crossover and mutation
      while (newPopulation.length < populationSize) {
        const parent1 = this.tournamentSelection(population);
        const parent2 = this.tournamentSelection(population);

        if (Math.random() < crossoverRate) {
          const [child1, child2] = this.crossover(parent1.parameters, parent2.parameters);
          newPopulation.push({
            parameters: this.mutate(child1, mutationRate),
            fitness: 0,
            metrics: null,
            backtestResult: null,
          });
          if (newPopulation.length < populationSize) {
            newPopulation.push({
              parameters: this.mutate(child2, mutationRate),
              fitness: 0,
              metrics: null,
              backtestResult: null,
            });
          }
        } else {
          newPopulation.push({ ...parent1 });
        }
      }

      population = newPopulation;
    }
  }

  /**
   * Run Bayesian optimization (simplified implementation)
   */
  private async runBayesianOptimization(): Promise<void> {
    // Simplified Bayesian optimization using random forest surrogate
    console.log('[ParameterSweeper] Bayesian optimization (simplified)');

    // Initial random sampling
    const nInitial = Math.min(20, Math.floor(this.sweepConfig.maxIterations * 0.1));
    for (let i = 0; i < nInitial; i++) {
      const params = this.generateRandomParameters();
      await this.evaluateParameters(params, i);
    }

    // Sequential optimization
    for (let i = nInitial; i < this.sweepConfig.maxIterations; i++) {
      // Use acquisition function (simplified: sample near best)
      const params = this.generateParametersNearBest();
      await this.evaluateParameters(params, i);

      if (this.shouldStopEarly()) {
        console.log('[ParameterSweeper] Early stopping triggered');
        break;
      }
    }
  }

  /**
   * Execute a batch of parameter sets
   */
  private async executeBatch(
    configs: StrategyConfig[],
    batchStart: number,
    total: number
  ): Promise<void> {
    const promises = configs.map((config, idx) => {
      const iteration = batchStart + idx;
      return this.evaluateParameters(config, iteration);
    });

    await Promise.all(promises);

    // Report progress
    const progress = ((batchStart + configs.length) / total) * 100;
    console.log(`[ParameterSweeper] Progress: ${progress.toFixed(1)}%`);
  }

  /**
   * Evaluate a single parameter configuration
   */
  private async evaluateParameters(
    params: StrategyConfig,
    iteration: number
  ): Promise<ParameterSetResult> {
    const startTime = Date.now();

    // Create harness and run backtest
    const harness = new StrategyResearchHarness({}, params);
    const backtestResult = await harness.runBacktest(this.marketData);

    // Calculate score
    const score = this.calculateScore(backtestResult.metrics);

    // Check constraints
    const passedConstraints = this.checkConstraints(backtestResult.metrics);

    // Create result
    const result: ParameterSetResult = {
      id: `iter_${iteration}`,
      parameters: params,
      metrics: backtestResult.metrics,
      score,
      rank: 0,
      backtestResult,
      executionTimeMs: Date.now() - startTime,
      passedConstraints,
    };

    this.results.push(result);

    // Update best
    const isBetter = this.sweepConfig.objectiveDirection === 'maximize'
      ? score > this.bestScore
      : score < this.bestScore;

    if (isBetter && passedConstraints) {
      this.bestScore = score;
      this.bestConfig = params;
      this.iterationsWithoutImprovement = 0;
      this.lastImprovementTime = Date.now();
      console.log(`[ParameterSweeper] New best score: ${score.toFixed(4)}`);
    } else {
      this.iterationsWithoutImprovement++;
    }

    // Report progress
    if (this.sweepConfig.onProgress) {
      const elapsed = Date.now() - this.startTime;
      const avgTimePerIter = elapsed / (iteration + 1);
      const remaining = (this.sweepConfig.maxIterations - iteration - 1) * avgTimePerIter;

      this.sweepConfig.onProgress({
        currentIteration: iteration + 1,
        totalIterations: this.sweepConfig.maxIterations,
        bestScore: this.bestScore,
        bestConfig: this.bestConfig,
        currentConfig: params,
        elapsedMs: elapsed,
        estimatedRemainingMs: remaining,
      });
    }

    return result;
  }

  /**
   * Calculate objective score from metrics
   */
  private calculateScore(metrics: PerformanceMetrics): number {
    if (this.sweepConfig.objectiveMetric === 'composite') {
      return this.calculateCompositeScore(metrics);
    }

    const value = metrics[this.sweepConfig.objectiveMetric];
    if (typeof value !== 'number') {
      throw new Error(`Metric ${this.sweepConfig.objectiveMetric} is not a number`);
    }

    return value;
  }

  /**
   * Calculate composite score from multiple metrics
   */
  private calculateCompositeScore(metrics: PerformanceMetrics): number {
    const weights = this.sweepConfig.compositeWeights || {};
    let score = 0;
    let totalWeight = 0;

    for (const [metric, weight] of Object.entries(weights)) {
      const value = metrics[metric as keyof PerformanceMetrics];
      if (typeof value === 'number') {
        // Normalize some metrics
        let normalizedValue = value;
        if (metric === 'maxDrawdownPct') {
          normalizedValue = -Math.abs(value); // Negative is better
        } else if (metric === 'sharpeRatio') {
          normalizedValue = Math.min(value, 5); // Cap at 5
        }

        score += normalizedValue * weight;
        totalWeight += Math.abs(weight);
      }
    }

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Check if metrics pass all constraints
   */
  private checkConstraints(metrics: PerformanceMetrics): boolean {
    if (!this.sweepConfig.constraints) return true;

    for (const constraint of this.sweepConfig.constraints) {
      const value = metrics[constraint.metric];
      if (typeof value !== 'number') continue;

      let passed = false;
      switch (constraint.operator) {
        case '>':
          passed = value > constraint.value;
          break;
        case '<':
          passed = value < constraint.value;
          break;
        case '>=':
          passed = value >= constraint.value;
          break;
        case '<=':
          passed = value <= constraint.value;
          break;
        case '==':
          passed = value === constraint.value;
          break;
      }

      if (!passed) return false;
    }

    return true;
  }

  /**
   * Check if early stopping should trigger
   */
  private shouldStopEarly(): boolean {
    if (!this.sweepConfig.earlyStopping?.enabled) return false;

    const { patience, minImprovement } = this.sweepConfig.earlyStopping;

    if (this.iterationsWithoutImprovement >= patience) {
      return true;
    }

    return false;
  }

  /**
   * Generate all grid combinations
   */
  private generateGridCombinations(): StrategyConfig[] {
    const combinations: StrategyConfig[] = [];

    const generate = (
      current: Partial<StrategyConfig>,
      paramIndex: number
    ): void => {
      if (paramIndex >= this.parameterSpace.parameters.length) {
        combinations.push({ ...defaultStrategyConfig, ...current } as StrategyConfig);
        return;
      }

      const param = this.parameterSpace.parameters[paramIndex];
      const values = this.getParameterValues(param);

      for (const value of values) {
        generate(
          { ...current, [param.name]: value },
          paramIndex + 1
        );
      }
    };

    generate({}, 0);
    return combinations;
  }

  /**
   * Get all values for a parameter
   */
  private getParameterValues(param: ParameterDefinition): (number | boolean | string)[] {
    if (param.type === 'choice' && param.choices) {
      return param.choices;
    }

    if (param.type === 'bool') {
      return [true, false];
    }

    if (param.type === 'int' || param.type === 'float') {
      const values: number[] = [];
      const min = param.min || 0;
      const max = param.max || 1;
      const step = param.step || (param.type === 'int' ? 1 : 0.1);

      for (let v = min; v <= max; v += step) {
        values.push(param.type === 'int' ? Math.round(v) : v);
      }

      return values;
    }

    return [];
  }

  /**
   * Generate random parameters
   */
  private generateRandomParameters(): StrategyConfig {
    const params: Partial<StrategyConfig> = {};

    for (const param of this.parameterSpace.parameters) {
      params[param.name as keyof StrategyConfig] = this.sampleParameter(param) as any;
    }

    return { ...defaultStrategyConfig, ...params };
  }

  /**
   * Sample a single parameter value
   */
  private sampleParameter(param: ParameterDefinition): number | boolean | string {
    if (param.type === 'choice' && param.choices) {
      return param.choices[Math.floor(Math.random() * param.choices.length)];
    }

    if (param.type === 'bool') {
      return Math.random() < 0.5;
    }

    const min = param.min || 0;
    const max = param.max || 1;

    if (param.distribution === 'log') {
      const logMin = Math.log(min + 1);
      const logMax = Math.log(max + 1);
      const logValue = logMin + Math.random() * (logMax - logMin);
      return Math.exp(logValue) - 1;
    }

    if (param.distribution === 'normal') {
      const mean = (min + max) / 2;
      const std = (max - min) / 4;
      const value = mean + this.randn() * std;
      return Math.max(min, Math.min(max, value));
    }

    // Uniform
    const value = min + Math.random() * (max - min);
    return param.type === 'int' ? Math.round(value) : value;
  }

  /**
   * Standard normal random variable
   */
  private randn(): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Tournament selection for genetic algorithm
   */
  private tournamentSelection(population: GeneticIndividual[]): GeneticIndividual {
    const tournamentSize = 3;
    let best = population[Math.floor(Math.random() * population.length)];

    for (let i = 1; i < tournamentSize; i++) {
      const candidate = population[Math.floor(Math.random() * population.length)];
      if (candidate.fitness > best.fitness) {
        best = candidate;
      }
    }

    return best;
  }

  /**
   * Crossover two parent configurations
   */
  private crossover(
    parent1: StrategyConfig,
    parent2: StrategyConfig
  ): [StrategyConfig, StrategyConfig] {
    const child1: Partial<StrategyConfig> = {};
    const child2: Partial<StrategyConfig> = {};

    for (const param of this.parameterSpace.parameters) {
      const key = param.name as keyof StrategyConfig;
      if (Math.random() < 0.5) {
        child1[key] = parent1[key] as any;
        child2[key] = parent2[key] as any;
      } else {
        child1[key] = parent2[key] as any;
        child2[key] = parent1[key] as any;
      }
    }

    return [
      { ...defaultStrategyConfig, ...child1 },
      { ...defaultStrategyConfig, ...child2 },
    ];
  }

  /**
   * Mutate a configuration
   */
  private mutate(params: StrategyConfig, rate: number): StrategyConfig {
    const mutated: Partial<StrategyConfig> = {};

    for (const param of this.parameterSpace.parameters) {
      const key = param.name as keyof StrategyConfig;
      if (Math.random() < rate) {
        mutated[key] = this.sampleParameter(param) as any;
      } else {
        mutated[key] = params[key] as any;
      }
    }

    return { ...defaultStrategyConfig, ...mutated };
  }

  /**
   * Generate parameters near the current best
   */
  private generateParametersNearBest(): StrategyConfig {
    if (!this.bestConfig) {
      return this.generateRandomParameters();
    }

    const params: Partial<StrategyConfig> = {};

    for (const param of this.parameterSpace.parameters) {
      const key = param.name as keyof StrategyConfig;
      const currentValue = this.bestConfig[key] as number;

      if (param.type === 'float' || param.type === 'int') {
        const range = ((param.max || 1) - (param.min || 0)) * 0.1;
        const newValue = currentValue + (Math.random() - 0.5) * 2 * range;
        params[key] = param.type === 'int'
          ? Math.round(Math.max(param.min || 0, Math.min(param.max || 1, newValue)))
          : Math.max(param.min || 0, Math.min(param.max || 1, newValue));
      } else {
        params[key] = this.bestConfig[key];
      }
    }

    return { ...defaultStrategyConfig, ...params };
  }

  /**
   * Set random seed for reproducibility
   */
  private setRandomSeed(seed: number): void {
    // Simple seeded random (not cryptographically secure)
    let s = seed;
    const random = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };

    // Override Math.random
    (Math as any).random = random;
  }

  /**
   * Build final sweep result
   */
  private buildResult(): SweepResult {
    const endTime = Date.now();

    // Rank results
    const sortedResults = [...this.results].sort((a, b) => b.score - a.score);
    sortedResults.forEach((r, i) => (r.rank = i + 1));

    // Calculate Pareto frontier (for multi-objective)
    const paretoFrontier = this.calculateParetoFrontier(sortedResults);

    // Calculate statistics
    const scores = this.results.map(r => r.score);
    const executionTimes = this.results.map(r => r.executionTimeMs);
    const passedCount = this.results.filter(r => r.passedConstraints).length;

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const scoreStdDev = Math.sqrt(
      scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length
    );

    const statistics: SweepStatistics = {
      avgExecutionTimeMs: executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length,
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
      avgScore,
      scoreStdDev,
      constraintPassRate: passedCount / this.results.length,
    };

    return {
      config: this.sweepConfig,
      startTime: this.startTime,
      endTime,
      totalIterations: this.sweepConfig.maxIterations,
      completedIterations: this.results.length,
      allResults: sortedResults,
      topResults: sortedResults.slice(0, 10),
      paretoFrontier,
      bestResult: sortedResults.find(r => r.passedConstraints) || sortedResults[0] || null,
      statistics,
    };
  }

  /**
   * Calculate Pareto frontier
   */
  private calculateParetoFrontier(results: ParameterSetResult[]): ParameterSetResult[] {
    // Simplified: use netProfit and maxDrawdown as objectives
    const frontier: ParameterSetResult[] = [];

    for (const result of results) {
      const dominated = frontier.some(
        f =>
          f.metrics.netProfit >= result.metrics.netProfit &&
          Math.abs(f.metrics.maxDrawdownPct) <= Math.abs(result.metrics.maxDrawdownPct) &&
          (f.metrics.netProfit > result.metrics.netProfit ||
            Math.abs(f.metrics.maxDrawdownPct) < Math.abs(result.metrics.maxDrawdownPct))
      );

      if (!dominated) {
        // Remove any points that this one dominates
        const newFrontier = frontier.filter(
          f =>
            !(
              result.metrics.netProfit >= f.metrics.netProfit &&
              Math.abs(result.metrics.maxDrawdownPct) <= Math.abs(f.metrics.maxDrawdownPct)
            )
        );
        newFrontier.push(result);
        frontier.length = 0;
        frontier.push(...newFrontier);
      }
    }

    return frontier.sort((a, b) => b.metrics.netProfit - a.metrics.netProfit);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a parameter space from a configuration object
 */
export function createParameterSpace(
  config: Record<string, { min: number; max: number; step: number; type?: 'float' | 'int' }>
): ParameterSpace {
  const parameters: ParameterDefinition[] = [];

  for (const [name, range] of Object.entries(config)) {
    parameters.push({
      name,
      type: range.type || 'float',
      min: range.min,
      max: range.max,
      step: range.step,
    });
  }

  return { parameters };
}

/**
 * Export sweep results to CSV
 */
export function exportSweepResultsToCSV(result: SweepResult, filePath: string): void {
  const fs = require('fs');

  // Header
  let csv = 'rank,id,score,passed_constraints';

  // Parameter columns
  if (result.allResults.length > 0) {
    const paramNames = Object.keys(result.allResults[0].parameters);
    csv += ',' + paramNames.join(',');
  }

  // Metric columns
  const metricNames: (keyof PerformanceMetrics)[] = [
    'netProfit',
    'totalReturnPct',
    'winRate',
    'profitFactor',
    'sharpeRatio',
    'maxDrawdownPct',
    'totalTrades',
    'avgTrade',
  ];
  csv += ',' + metricNames.join(',') + '\n';

  // Data rows
  for (const r of result.allResults) {
    csv += `${r.rank},${r.id},${r.score.toFixed(4)},${r.passedConstraints}`;

    // Parameters
    for (const key of Object.keys(r.parameters)) {
      csv += ',' + (r.parameters as any)[key];
    }

    // Metrics
    for (const metric of metricNames) {
      csv += ',' + (r.metrics[metric] as number).toFixed(4);
    }

    csv += '\n';
  }

  fs.writeFileSync(filePath, csv);
}

/**
 * Format sweep result for display
 */
export function formatSweepResult(result: SweepResult): string {
  let output = `
=== Parameter Sweep Results ===
Method: ${result.config.method}
Iterations: ${result.completedIterations}/${result.config.totalIterations}
Duration: ${((result.endTime - result.startTime) / 1000).toFixed(1)}s

=== Statistics ===
Avg Execution Time: ${result.statistics.avgExecutionTimeMs.toFixed(0)}ms
Score Range: ${result.statistics.minScore.toFixed(4)} - ${result.statistics.maxScore.toFixed(4)}
Avg Score: ${result.statistics.avgScore.toFixed(4)} (±${result.statistics.scoreStdDev.toFixed(4)})
Constraint Pass Rate: ${(result.statistics.constraintPassRate * 100).toFixed(1)}%
`;

  if (result.bestResult) {
    output += `
=== Best Result ===
Score: ${result.bestResult.score.toFixed(4)}
`;
    output += '\nParameters:\n';
    for (const [key, value] of Object.entries(result.bestResult.parameters)) {
      output += `  ${key}: ${value}\n`;
    }

    output += '\nMetrics:\n';
    output += `  Net Profit: $${result.bestResult.metrics.netProfit.toFixed(2)}\n`;
    output += `  Win Rate: ${result.bestResult.metrics.winRate.toFixed(2)}%\n`;
    output += `  Profit Factor: ${result.bestResult.metrics.profitFactor.toFixed(2)}\n`;
    output += `  Sharpe Ratio: ${result.bestResult.metrics.sharpeRatio.toFixed(2)}\n`;
    output += `  Max Drawdown: ${result.bestResult.metrics.maxDrawdownPct.toFixed(2)}%\n`;
  }

  return output;
}

// Export all types
export { StrategyConfig, PerformanceMetrics, MarketTick, BacktestResult };
