/**
 * [FAZ-2] Position Risk Guard
 * R1-R4: Max position cap (notional/leverage/qty)
 * 
 * Enforces position-level risk limits with deterministic calculations.
 */

import { RiskStateManager, RiskStateTrigger } from './RiskStateManager';

export interface PositionRiskConfig {
  // R1: Max position notional (per symbol)
  maxPositionNotional: number;
  
  // R2: Max leverage (account-wide)
  maxLeverage: number;
  
  // R3: Max position quantity (per symbol)
  maxPositionQty: number;
  
  // R4: Max total notional (account-wide)
  maxTotalNotional: number;
  
  // Warning thresholds (percentage of limit)
  warningThreshold: number;  // e.g., 0.8 = 80%
}

export interface Position {
  symbol: string;
  quantity: number;
  notional: number;
  leverage: number;
}

export interface PositionRiskCheck {
  allowed: boolean;
  reason?: string;
  currentExposure: {
    symbolNotional: number;
    totalNotional: number;
    leverage: number;
    symbolQty: number;
  };
  limits: {
    symbolNotionalLimit: number;
    totalNotionalLimit: number;
    leverageLimit: number;
    symbolQtyLimit: number;
  };
}

const DEFAULT_CONFIG: PositionRiskConfig = {
  maxPositionNotional: 100000,  // $100k per symbol
  maxLeverage: 10,              // 10x max
  maxPositionQty: 10,           // 10 contracts per symbol
  maxTotalNotional: 500000,     // $500k total
  warningThreshold: 0.8         // 80% warning
};

/**
 * [FAZ-2] Position Risk Guard
 * Manages position-level risk limits
 */
export class PositionRiskGuard {
  private config: PositionRiskConfig;
  private positions: Map<string, Position> = new Map();
  private stateManager: RiskStateManager;

  constructor(
    stateManager: RiskStateManager,
    config: Partial<PositionRiskConfig> = {}
  ) {
    this.stateManager = stateManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update position for a symbol
   */
  updatePosition(position: Position): void {
    this.positions.set(position.symbol, position);
  }

  /**
   * Remove position for a symbol
   */
  removePosition(symbol: string): void {
    this.positions.delete(symbol);
  }

  /**
   * Get all positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Calculate total notional exposure
   */
  getTotalNotional(): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      total += Math.abs(pos.notional);
    }
    return total;
  }

  /**
   * Calculate effective leverage
   */
  getEffectiveLeverage(accountEquity: number): number {
    if (accountEquity <= 0) return 0;
    return this.getTotalNotional() / accountEquity;
  }

  /**
   * Check if new position can be opened
   * R1-R4 validation
   */
  canOpenPosition(
    symbol: string,
    quantity: number,
    notional: number,
    accountEquity: number
  ): PositionRiskCheck {
    const currentSymbolPos = this.positions.get(symbol);
    const currentSymbolNotional = currentSymbolPos ? Math.abs(currentSymbolPos.notional) : 0;
    const currentSymbolQty = currentSymbolPos ? Math.abs(currentSymbolPos.quantity) : 0;
    const currentTotalNotional = this.getTotalNotional();
    const currentLeverage = this.getEffectiveLeverage(accountEquity);

    const newSymbolNotional = currentSymbolNotional + Math.abs(notional);
    const newTotalNotional = currentTotalNotional + Math.abs(notional);
    const newSymbolQty = currentSymbolQty + Math.abs(quantity);
    const newLeverage = accountEquity > 0 ? newTotalNotional / accountEquity : 0;

    const check: PositionRiskCheck = {
      allowed: true,
      currentExposure: {
        symbolNotional: currentSymbolNotional,
        totalNotional: currentTotalNotional,
        leverage: currentLeverage,
        symbolQty: currentSymbolQty
      },
      limits: {
        symbolNotionalLimit: this.config.maxPositionNotional,
        totalNotionalLimit: this.config.maxTotalNotional,
        leverageLimit: this.config.maxLeverage,
        symbolQtyLimit: this.config.maxPositionQty
      }
    };

    // R1: Max position notional check
    if (newSymbolNotional > this.config.maxPositionNotional) {
      check.allowed = false;
      check.reason = `Symbol notional limit exceeded: ${newSymbolNotional.toFixed(2)} > ${this.config.maxPositionNotional}`;
      
      // Trigger state transition if limit breached
      this.stateManager.transition(
        RiskStateTrigger.MAX_POSITION_CAP_BREACH,
        check.reason,
        { symbol, requested: notional, limit: this.config.maxPositionNotional }
      );
      return check;
    }

    // R2: Max leverage check
    if (newLeverage > this.config.maxLeverage) {
      check.allowed = false;
      check.reason = `Leverage limit exceeded: ${newLeverage.toFixed(2)}x > ${this.config.maxLeverage}x`;
      
      this.stateManager.transition(
        RiskStateTrigger.LEVERAGE_CAP_BREACH,
        check.reason,
        { requested: newLeverage, limit: this.config.maxLeverage }
      );
      return check;
    }

    // R3: Max position quantity check
    if (newSymbolQty > this.config.maxPositionQty) {
      check.allowed = false;
      check.reason = `Symbol quantity limit exceeded: ${newSymbolQty} > ${this.config.maxPositionQty}`;
      return check;
    }

    // R4: Max total notional check
    if (newTotalNotional > this.config.maxTotalNotional) {
      check.allowed = false;
      check.reason = `Total notional limit exceeded: ${newTotalNotional.toFixed(2)} > ${this.config.maxTotalNotional}`;
      return check;
    }

    // Check warning thresholds
    this.checkWarningThresholds(
      newSymbolNotional,
      newTotalNotional,
      newLeverage,
      newSymbolQty
    );

    return check;
  }

  /**
   * Check warning thresholds and log alerts
   */
  private checkWarningThresholds(
    symbolNotional: number,
    totalNotional: number,
    leverage: number,
    symbolQty: number
  ): void {
    const symbolRatio = symbolNotional / this.config.maxPositionNotional;
    const leverageRatio = leverage / this.config.maxLeverage;
    const totalRatio = totalNotional / this.config.maxTotalNotional;

    if (symbolRatio > this.config.warningThreshold) {
      console.warn(`[PositionRiskGuard] WARNING: Symbol notional at ${(symbolRatio * 100).toFixed(1)}% of limit`);
    }

    if (leverageRatio > this.config.warningThreshold) {
      console.warn(`[PositionRiskGuard] WARNING: Leverage at ${(leverageRatio * 100).toFixed(1)}% of limit`);
    }

    if (totalRatio > this.config.warningThreshold) {
      console.warn(`[PositionRiskGuard] WARNING: Total notional at ${(totalRatio * 100).toFixed(1)}% of limit`);
    }
  }

  /**
   * Get position summary
   */
  getPositionSummary(accountEquity: number): {
    totalPositions: number;
    totalNotional: number;
    effectiveLeverage: number;
    utilization: {
      notional: number;  // percentage
      leverage: number;  // percentage
    };
  } {
    const totalNotional = this.getTotalNotional();
    const effectiveLeverage = this.getEffectiveLeverage(accountEquity);

    return {
      totalPositions: this.positions.size,
      totalNotional,
      effectiveLeverage,
      utilization: {
        notional: totalNotional / this.config.maxTotalNotional,
        leverage: effectiveLeverage / this.config.maxLeverage
      }
    };
  }

  /**
   * Reset all positions (for testing/replay)
   */
  reset(): void {
    this.positions.clear();
  }
}
