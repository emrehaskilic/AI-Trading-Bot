/**
 * StrategyRegistry.ts
 * 
 * Central registry for managing trading strategies.
 * Part of FAZ-5 Strategy Framework.
 */

import { SignalSide, Strategy, StrategyContext, StrategySignal } from './StrategyInterface';

export class StrategyRegistry {
  /** Map of strategy ID to strategy instance */
  private strategies: Map<string, Strategy> = new Map();

  /**
   * Register a new strategy
   * @param strategy - Strategy instance to register
   * @throws Error if strategy ID already exists
   */
  register(strategy: Strategy): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(
        `Strategy with ID '${strategy.id}' is already registered. ` +
        `Unregister first or use a different ID.`
      );
    }
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Unregister a strategy by ID
   * @param strategyId - ID of strategy to unregister
   * @returns True if strategy was found and removed, false otherwise
   */
  unregister(strategyId: string): boolean {
    return this.strategies.delete(strategyId);
  }

  /**
   * Get a strategy by ID
   * @param strategyId - Strategy identifier
   * @returns Strategy instance or undefined if not found
   */
  get(strategyId: string): Strategy | undefined {
    return this.strategies.get(strategyId);
  }

  /**
   * Get all registered strategies
   * @returns Array of all registered strategies
   */
  getAll(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get all registered strategy IDs
   * @returns Array of strategy IDs
   */
  getAllIds(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Check if a strategy is registered
   * @param strategyId - Strategy identifier
   * @returns True if strategy exists
   */
  has(strategyId: string): boolean {
    return this.strategies.has(strategyId);
  }

  /**
   * Get the number of registered strategies
   * @returns Count of strategies
   */
  size(): number {
    return this.strategies.size;
  }

  /**
   * Evaluate all registered strategies
   * @param ctx - Strategy context for evaluation
   * @returns Array of signals from all strategies
   */
  evaluateAll(ctx: StrategyContext): StrategySignal[] {
    const signals: StrategySignal[] = [];
    
    for (const strategy of this.strategies.values()) {
      try {
        const signal = strategy.evaluate(ctx);
        signals.push(signal);
      } catch (error) {
        // Log error but continue with other strategies
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Strategy '${strategy.id}' evaluation failed: ${errorMessage}`);
        
        // Create a FLAT signal on error to maintain consistency
        signals.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          side: SignalSide.FLAT,
          confidence: 0,
          timestamp: ctx.timestamp,
          validityDurationMs: 0,
          metadata: { error: errorMessage }
        });
      }
    }
    
    return signals;
  }

  /**
   * Evaluate a specific subset of strategies
   * @param strategyIds - Array of strategy IDs to evaluate
   * @param ctx - Strategy context for evaluation
   * @returns Array of signals from specified strategies
   */
  evaluateSubset(strategyIds: string[], ctx: StrategyContext): StrategySignal[] {
    const signals: StrategySignal[] = [];
    
    for (const strategyId of strategyIds) {
      const strategy = this.strategies.get(strategyId);
      if (!strategy) {
        console.warn(`Strategy '${strategyId}' not found in registry`);
        continue;
      }
      
      try {
        const signal = strategy.evaluate(ctx);
        signals.push(signal);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Strategy '${strategyId}' evaluation failed: ${errorMessage}`);
        
        signals.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          side: SignalSide.FLAT,
          confidence: 0,
          timestamp: ctx.timestamp,
          validityDurationMs: 0,
          metadata: { error: errorMessage }
        });
      }
    }
    
    return signals;
  }

  /**
   * Get all veto-capable strategies
   * @returns Array of strategies that can veto
   */
  getVetoStrategies(): Strategy[] {
    return this.getAll().filter(strategy => strategy.canVeto());
  }

  /**
   * Clear all registered strategies
   */
  clear(): void {
    this.strategies.clear();
  }

  /**
   * Clear and register multiple strategies at once
   * @param strategies - Array of strategies to register
   */
  reset(strategies: Strategy[]): void {
    this.clear();
    for (const strategy of strategies) {
      this.register(strategy);
    }
  }

  /**
   * Create a snapshot of current registry state
   * @returns Object with strategy IDs and count
   */
  snapshot(): { ids: string[]; count: number } {
    return {
      ids: this.getAllIds(),
      count: this.size()
    };
  }
}
