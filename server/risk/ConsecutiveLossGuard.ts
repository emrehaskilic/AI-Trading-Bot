/**
 * [FAZ-2] Consecutive Loss Guard
 * R9-R12: Consecutive loss breaker
 * 
 * Tracks consecutive losing trades and triggers risk reduction.
 */

import { RiskStateManager, RiskStateTrigger } from './RiskStateManager';

export interface ConsecutiveLossConfig {
  // R9: Max consecutive losses before halt
  maxConsecutiveLosses: number;
  
  // R10: Consecutive loss window (ms)
  lossWindowMs: number;
  
  // R11: Minimum loss amount to count
  minLossAmount: number;
  
  // R12: Reset after win
  resetAfterWin: boolean;
  
  // Reduced risk after N losses
  reducedRiskThreshold: number;
  reducedRiskMultiplier: number;
}

export interface TradeResult {
  timestamp: number;
  symbol: string;
  pnl: number;
  quantity: number;
}

const DEFAULT_CONFIG: ConsecutiveLossConfig = {
  maxConsecutiveLosses: 5,       // Halt after 5 consecutive losses
  lossWindowMs: 3600000,         // 1 hour window
  minLossAmount: 1,              // $1 minimum
  resetAfterWin: true,
  reducedRiskThreshold: 3,       // Reduce risk after 3 losses
  reducedRiskMultiplier: 0.5     // 50% position size
};

/**
 * [FAZ-2] Consecutive Loss Guard
 * Monitors losing streaks and triggers risk controls
 */
export class ConsecutiveLossGuard {
  private config: ConsecutiveLossConfig;
  private stateManager: RiskStateManager;
  
  // Trade history
  private tradeHistory: TradeResult[] = [];
  private consecutiveLosses: number = 0;
  private lastTradeTime: number = 0;
  
  // State tracking
  private reducedRiskActive: boolean = false;

  constructor(
    stateManager: RiskStateManager,
    config: Partial<ConsecutiveLossConfig> = {}
  ) {
    this.stateManager = stateManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a trade result
   */
  recordTrade(result: TradeResult): void {
    // Add to history
    this.tradeHistory.push(result);
    this.lastTradeTime = result.timestamp;
    
    // Clean old trades
    this.cleanOldTrades(result.timestamp);
    
    // Process result
    if (result.pnl < -this.config.minLossAmount) {
      // Loss
      this.consecutiveLosses++;
      console.log(`[ConsecutiveLossGuard] Loss recorded: ${result.pnl.toFixed(2)} (consecutive: ${this.consecutiveLosses})`);
      
      this.evaluateLossStreak();
    } else if (result.pnl > 0) {
      // Win
      if (this.config.resetAfterWin) {
        if (this.consecutiveLosses > 0) {
          console.log(`[ConsecutiveLossGuard] Win recorded, resetting consecutive losses`);
        }
        this.consecutiveLosses = 0;
        this.reducedRiskActive = false;
      }
    }
  }

  /**
   * Evaluate loss streak and trigger actions
   */
  private evaluateLossStreak(): void {
    // R12: Reduced risk threshold
    if (this.consecutiveLosses >= this.config.reducedRiskThreshold && !this.reducedRiskActive) {
      this.reducedRiskActive = true;
      console.warn(`[ConsecutiveLossGuard] Reduced risk activated after ${this.consecutiveLosses} losses`);
    }

    // R9: Max consecutive losses
    if (this.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      const reason = `Consecutive loss limit reached: ${this.consecutiveLosses} losses`;
      
      console.error(`[ConsecutiveLossGuard] ${reason}`);
      
      this.stateManager.transition(
        RiskStateTrigger.CONSECUTIVE_LOSS_THRESHOLD,
        reason,
        {
          consecutiveLosses: this.consecutiveLosses,
          limit: this.config.maxConsecutiveLosses,
          tradeHistory: this.tradeHistory.slice(-10) // Last 10 trades
        }
      );
    }
  }

  /**
   * Clean old trades outside the window
   */
  private cleanOldTrades(currentTime: number): void {
    const cutoff = currentTime - this.config.lossWindowMs;
    const oldLength = this.tradeHistory.length;
    
    this.tradeHistory = this.tradeHistory.filter(t => t.timestamp >= cutoff);
    
    if (this.tradeHistory.length < oldLength) {
      // Recalculate consecutive losses
      this.recalculateConsecutiveLosses();
    }
  }

  /**
   * Recalculate consecutive losses from history
   */
  private recalculateConsecutiveLosses(): void {
    let count = 0;
    
    // Count from the end (most recent)
    for (let i = this.tradeHistory.length - 1; i >= 0; i--) {
      const trade = this.tradeHistory[i];
      if (trade.pnl < -this.config.minLossAmount) {
        count++;
      } else if (trade.pnl > 0 && this.config.resetAfterWin) {
        break;
      }
    }
    
    this.consecutiveLosses = count;
  }

  /**
   * Get current consecutive loss count
   */
  getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  /**
   * Check if reduced risk is active
   */
  isReducedRiskActive(): boolean {
    return this.reducedRiskActive;
  }

  /**
   * Get position size multiplier
   */
  getPositionSizeMultiplier(): number {
    this.refresh();
    if (this.reducedRiskActive) {
      return this.config.reducedRiskMultiplier;
    }
    return 1.0;
  }

  /**
   * Get trade history
   */
  getTradeHistory(): TradeResult[] {
    return [...this.tradeHistory];
  }

  /**
   * Get loss statistics
   */
  getLossStatistics(): {
    consecutiveLosses: number;
    totalLossesInWindow: number;
    totalTradesInWindow: number;
    lossRate: number;
    totalLossAmount: number;
  } {
    this.refresh();
    const losses = this.tradeHistory.filter(t => t.pnl < -this.config.minLossAmount);
    const totalLossAmount = losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0);
    
    return {
      consecutiveLosses: this.consecutiveLosses,
      totalLossesInWindow: losses.length,
      totalTradesInWindow: this.tradeHistory.length,
      lossRate: this.tradeHistory.length > 0 ? losses.length / this.tradeHistory.length : 0,
      totalLossAmount
    };
  }

  /**
   * Reset guard state
   */
  reset(): void {
    this.tradeHistory = [];
    this.consecutiveLosses = 0;
    this.lastTradeTime = 0;
    this.reducedRiskActive = false;
  }

  /**
   * Check if trading should be halted
   */
  shouldHalt(): boolean {
    this.refresh();
    return this.consecutiveLosses >= this.config.maxConsecutiveLosses;
  }

  /**
   * Refresh rolling window state even when no new trade is recorded.
   * This allows automatic recovery once stale losses fall out of the window.
   */
  refresh(currentTime?: number): void {
    const now = currentTime || Date.now();
    this.cleanOldTrades(now);
    if (this.consecutiveLosses < this.config.reducedRiskThreshold) {
      this.reducedRiskActive = false;
    }
  }

  /**
   * Expose active thresholds for recovery coordinators.
   */
  getThresholds(): Pick<ConsecutiveLossConfig, 'maxConsecutiveLosses' | 'reducedRiskThreshold' | 'lossWindowMs'> {
    return {
      maxConsecutiveLosses: this.config.maxConsecutiveLosses,
      reducedRiskThreshold: this.config.reducedRiskThreshold,
      lossWindowMs: this.config.lossWindowMs,
    };
  }
}
