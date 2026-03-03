/**
 * [FAZ-2] Multi-Symbol Exposure Guard
 * R13-R15: Multi-symbol exposure cap (risk parity/correlation basit hali)
 * 
 * Manages cross-symbol exposure and correlation risk.
 */

import { RiskStateManager, RiskStateTrigger } from './RiskStateManager';

export interface MultiSymbolExposureConfig {
  // R13: Max number of concurrent positions
  maxConcurrentPositions: number;
  
  // R14: Max correlated exposure (same direction)
  maxCorrelatedExposureRatio: number;
  
  // R15: Max concentration in single symbol (ratio of total)
  maxSymbolConcentrationRatio: number;
  
  // Correlation groups (symbols that move together)
  correlationGroups: string[][];
}

export interface SymbolExposure {
  symbol: string;
  notional: number;
  direction: 'long' | 'short';
  leverage: number;
}

const DEFAULT_CONFIG: MultiSymbolExposureConfig = {
  maxConcurrentPositions: 5,
  maxCorrelatedExposureRatio: 0.6,   // 60% of capital in correlated positions
  maxSymbolConcentrationRatio: 0.4,  // 40% max in single symbol
  correlationGroups: [
    ['BTCUSDT', 'ETHUSDT'],           // Crypto majors
    ['ADAUSDT', 'SOLUSDT', 'DOTUSDT'] // Alts
  ]
};

/**
 * [FAZ-2] Multi-Symbol Exposure Guard
 * Monitors cross-symbol exposure and concentration risk
 */
export class MultiSymbolExposureGuard {
  private config: MultiSymbolExposureConfig;
  private stateManager: RiskStateManager;
  private exposures: Map<string, SymbolExposure> = new Map();

  constructor(
    stateManager: RiskStateManager,
    config: Partial<MultiSymbolExposureConfig> = {}
  ) {
    this.stateManager = stateManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update exposure for a symbol
   */
  updateExposure(exposure: SymbolExposure): void {
    this.exposures.set(exposure.symbol, exposure);
  }

  /**
   * Remove exposure for a symbol
   */
  removeExposure(symbol: string): void {
    this.exposures.delete(symbol);
  }

  /**
   * Get all exposures
   */
  getExposures(): SymbolExposure[] {
    return Array.from(this.exposures.values());
  }

  /**
   * Check if new position can be opened
   */
  canOpenPosition(
    symbol: string,
    notional: number,
    direction: 'long' | 'short',
    accountEquity: number
  ): { allowed: boolean; reason?: string } {
    // R13: Max concurrent positions check
    if (this.exposures.size >= this.config.maxConcurrentPositions) {
      // Check if symbol already exists (allowing modification)
      if (!this.exposures.has(symbol)) {
        return {
          allowed: false,
          reason: `Max concurrent positions reached: ${this.exposures.size} >= ${this.config.maxConcurrentPositions}`
        };
      }
    }

    // Calculate new totals
    const existingExposure = this.exposures.get(symbol);
    const newTotalNotional = this.getTotalNotional() + Math.abs(notional);

    // R15: Symbol concentration check
    // Skip for the very first position; concentration is meaningful once portfolio has more than one leg.
    const hasPriorExposure = this.exposures.size > 0 || Boolean(existingExposure);
    const currentSymbolNotional = existingExposure ? Math.abs(existingExposure.notional) : 0;
    const newSymbolNotional = currentSymbolNotional + Math.abs(notional);
    const symbolConcentration = newTotalNotional > 0 ? (newSymbolNotional / newTotalNotional) : 0;

    if (hasPriorExposure && symbolConcentration > this.config.maxSymbolConcentrationRatio) {
      const reason = `Symbol concentration limit exceeded: ${(symbolConcentration * 100).toFixed(1)}% > ${(this.config.maxSymbolConcentrationRatio * 100).toFixed(1)}%`;
      
      this.stateManager.transition(
        RiskStateTrigger.MULTI_SYMBOL_EXPOSURE_CAP,
        reason,
        { symbol, concentration: symbolConcentration }
      );
      
      return { allowed: false, reason };
    }

    // R14: Correlated exposure check
    const correlatedExposure = this.getCorrelatedExposure(symbol, direction);
    const newCorrelatedExposure = correlatedExposure + Math.abs(notional);
    const correlatedRatio = accountEquity > 0 ? newCorrelatedExposure / accountEquity : 0;

    if (correlatedRatio > this.config.maxCorrelatedExposureRatio) {
      const reason = `Correlated exposure limit exceeded: ${(correlatedRatio * 100).toFixed(1)}% > ${(this.config.maxCorrelatedExposureRatio * 100).toFixed(1)}%`;
      
      this.stateManager.transition(
        RiskStateTrigger.CORRELATION_RISK_HIGH,
        reason,
        { symbol, correlatedExposure: newCorrelatedExposure, ratio: correlatedRatio }
      );
      
      return { allowed: false, reason };
    }

    return { allowed: true };
  }

  /**
   * Get total notional exposure
   */
  getTotalNotional(): number {
    let total = 0;
    for (const exp of this.exposures.values()) {
      total += Math.abs(exp.notional);
    }
    return total;
  }

  /**
   * Get exposure by direction
   */
  getExposureByDirection(direction: 'long' | 'short'): number {
    let total = 0;
    for (const exp of this.exposures.values()) {
      if (exp.direction === direction) {
        total += Math.abs(exp.notional);
      }
    }
    return total;
  }

  /**
   * Get correlated exposure for a symbol
   */
  getCorrelatedExposure(symbol: string, direction: 'long' | 'short'): number {
    const group = this.findCorrelationGroup(symbol);
    if (!group) return 0;

    let correlatedExposure = 0;
    for (const sym of group) {
      if (sym === symbol) continue;
      const exp = this.exposures.get(sym);
      if (exp && exp.direction === direction) {
        correlatedExposure += Math.abs(exp.notional);
      }
    }
    return correlatedExposure;
  }

  /**
   * Find correlation group for a symbol
   */
  private findCorrelationGroup(symbol: string): string[] | null {
    for (const group of this.config.correlationGroups) {
      if (group.includes(symbol)) {
        return group;
      }
    }
    return null;
  }

  /**
   * Check if symbols are correlated
   */
  areCorrelated(symbol1: string, symbol2: string): boolean {
    for (const group of this.config.correlationGroups) {
      if (group.includes(symbol1) && group.includes(symbol2)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get exposure summary
   */
  getExposureSummary(accountEquity: number): {
    totalPositions: number;
    totalNotional: number;
    longExposure: number;
    shortExposure: number;
    netExposure: number;
    maxConcentration: { symbol: string; ratio: number };
  } {
    const totalNotional = this.getTotalNotional();
    const longExposure = this.getExposureByDirection('long');
    const shortExposure = this.getExposureByDirection('short');
    
    // Find max concentration
    let maxConcentration = { symbol: '', ratio: 0 };
    for (const [symbol, exp] of this.exposures.entries()) {
      const ratio = Math.abs(exp.notional) / totalNotional;
      if (ratio > maxConcentration.ratio) {
        maxConcentration = { symbol, ratio };
      }
    }

    return {
      totalPositions: this.exposures.size,
      totalNotional,
      longExposure,
      shortExposure,
      netExposure: longExposure - shortExposure,
      maxConcentration
    };
  }

  /**
   * Get risk parity score (0-1, lower is better balanced)
   */
  getRiskParityScore(): number {
    if (this.exposures.size === 0) return 0;
    
    const totalNotional = this.getTotalNotional();
    if (totalNotional === 0) return 0;
    
    // Ideal equal weight
    const idealWeight = 1 / this.exposures.size;
    
    // Calculate deviation from ideal
    let totalDeviation = 0;
    for (const exp of this.exposures.values()) {
      const weight = Math.abs(exp.notional) / totalNotional;
      totalDeviation += Math.abs(weight - idealWeight);
    }
    
    return totalDeviation / this.exposures.size;
  }

  /**
   * Reset all exposures
   */
  reset(): void {
    this.exposures.clear();
  }

  /**
   * Get correlation matrix (simplified)
   */
  getCorrelationMatrix(): { symbol1: string; symbol2: string; correlated: boolean }[] {
    const symbols = Array.from(this.exposures.keys());
    const matrix: { symbol1: string; symbol2: string; correlated: boolean }[] = [];
    
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        matrix.push({
          symbol1: symbols[i],
          symbol2: symbols[j],
          correlated: this.areCorrelated(symbols[i], symbols[j])
        });
      }
    }
    
    return matrix;
  }
}
