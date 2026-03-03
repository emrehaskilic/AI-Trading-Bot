/**
 * [FAZ-2] Drawdown Risk Guard
 * R5-R8: Drawdown guard (daily loss limit)
 * 
 * Enhanced version of DailyLossMonitor with state machine integration.
 */

import { RiskStateManager, RiskStateTrigger } from './RiskStateManager';

export interface DrawdownRiskConfig {
  // R5: Daily loss limit (ratio of capital)
  dailyLossLimitRatio: number;
  
  // R6: Daily loss warning threshold
  dailyLossWarningRatio: number;
  
  // R7: Max drawdown from peak (session)
  maxDrawdownRatio: number;
  
  // R8: Check interval (ms)
  checkIntervalMs: number;
  
  // Auto-halt on limit breach
  autoHaltOnLimit: boolean;
}

export interface PnLSnapshot {
  timestamp: number;
  pnl: number;           // Current P&L
  capital: number;       // Current capital
  peakCapital: number;   // Peak capital (for drawdown)
}

const DEFAULT_CONFIG: DrawdownRiskConfig = {
  dailyLossLimitRatio: 0.1,      // 10% daily loss limit
  dailyLossWarningRatio: 0.07,   // 7% warning
  maxDrawdownRatio: 0.15,        // 15% max drawdown
  checkIntervalMs: 5000,         // 5 second check interval
  autoHaltOnLimit: true
};

/**
 * [FAZ-2] Drawdown Risk Guard
 * Monitors daily P&L and drawdown with state transitions
 */
export class DrawdownRiskGuard {
  private config: DrawdownRiskConfig;
  private stateManager: RiskStateManager;
  private timer: NodeJS.Timeout | null = null;
  
  // P&L tracking
  private initialCapital: number = 0;
  private currentCapital: number = 0;
  private peakCapital: number = 0;
  private dailyPnL: number = 0;
  private sessionStartTime: number = 0;
  
  // History for analysis
  private pnlHistory: PnLSnapshot[] = [];
  
  // Warning tracking
  private warningTriggered: boolean = false;
  private limitTriggered: boolean = false;

  constructor(
    stateManager: RiskStateManager,
    config: Partial<DrawdownRiskConfig> = {}
  ) {
    this.stateManager = stateManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with starting capital
   */
  initialize(initialCapital: number, timestamp?: number): void {
    this.initialCapital = initialCapital;
    this.currentCapital = initialCapital;
    this.peakCapital = initialCapital;
    this.dailyPnL = 0;
    this.sessionStartTime = timestamp || Date.now();
    this.pnlHistory = [];
    this.warningTriggered = false;
    this.limitTriggered = false;
    
    console.log(`[DrawdownRiskGuard] Initialized with capital: ${initialCapital}`);
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.timer) return;
    
    this.timer = setInterval(() => {
      this.evaluate();
    }, this.config.checkIntervalMs);
    
    console.log('[DrawdownRiskGuard] Monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[DrawdownRiskGuard] Monitoring stopped');
    }
  }

  /**
   * Update current capital/P&L
   */
  updateCapital(currentCapital: number, timestamp?: number): void {
    const prevCapital = this.currentCapital;
    this.currentCapital = currentCapital;
    this.dailyPnL = currentCapital - this.initialCapital;
    
    // Update peak capital
    if (currentCapital > this.peakCapital) {
      this.peakCapital = currentCapital;
    }
    
    // Record snapshot
    const snapshot: PnLSnapshot = {
      timestamp: timestamp || Date.now(),
      pnl: this.dailyPnL,
      capital: currentCapital,
      peakCapital: this.peakCapital
    };
    this.pnlHistory.push(snapshot);
    
    // Trim history (keep last 1000)
    if (this.pnlHistory.length > 1000) {
      this.pnlHistory = this.pnlHistory.slice(-1000);
    }

    // Evaluate on update so callers do not depend on timer tick timing.
    this.evaluate();
  }

  /**
   * Evaluate risk conditions
   */
  private evaluate(): void {
    if (this.initialCapital <= 0) return;

    const lossRatio = this.dailyPnL < 0
      ? Math.abs(this.dailyPnL) / this.initialCapital
      : 0;
    const drawdownRatio = (this.peakCapital - this.currentCapital) / this.peakCapital;

    // R5: Daily loss limit check
    if (lossRatio >= this.config.dailyLossLimitRatio) {
      if (!this.limitTriggered) {
        this.limitTriggered = true;
        const reason = `Daily loss limit reached: ${(lossRatio * 100).toFixed(2)}% >= ${(this.config.dailyLossLimitRatio * 100).toFixed(2)}%`;
        
        console.error(`[DrawdownRiskGuard] ${reason}`);
        
        this.stateManager.transition(
          RiskStateTrigger.DAILY_LOSS_LIMIT_REACHED,
          reason,
          {
            dailyPnL: this.dailyPnL,
            lossRatio,
            limit: this.config.dailyLossLimitRatio
          }
        );

        if (this.config.autoHaltOnLimit) {
          this.stop();
        }
      }
      return;
    }

    // R6: Daily loss warning check
    if (lossRatio >= this.config.dailyLossWarningRatio) {
      if (!this.warningTriggered) {
        this.warningTriggered = true;
        const reason = `Daily loss warning: ${(lossRatio * 100).toFixed(2)}% >= ${(this.config.dailyLossWarningRatio * 100).toFixed(2)}%`;
        
        console.warn(`[DrawdownRiskGuard] ${reason}`);
        
        this.stateManager.transition(
          RiskStateTrigger.DAILY_LOSS_WARNING,
          reason,
          {
            dailyPnL: this.dailyPnL,
            lossRatio,
            warningThreshold: this.config.dailyLossWarningRatio
          }
        );
      }
    }

    // R7: Max drawdown check
    if (drawdownRatio >= this.config.maxDrawdownRatio) {
      const reason = `Max drawdown reached: ${(drawdownRatio * 100).toFixed(2)}% >= ${(this.config.maxDrawdownRatio * 100).toFixed(2)}%`;
      
      console.error(`[DrawdownRiskGuard] ${reason}`);
      
      this.stateManager.transition(
        RiskStateTrigger.DAILY_LOSS_LIMIT_REACHED,
        reason,
        {
          drawdown: this.peakCapital - this.currentCapital,
          drawdownRatio,
          peakCapital: this.peakCapital
        }
      );

      if (this.config.autoHaltOnLimit) {
        this.stop();
      }
    }
  }

  /**
   * Get current drawdown status
   */
  getDrawdownStatus(): {
    dailyPnL: number;
    lossRatio: number;
    drawdown: number;
    drawdownRatio: number;
    peakCapital: number;
    isWarning: boolean;
    isLimit: boolean;
  } {
    const lossRatio = this.initialCapital > 0 && this.dailyPnL < 0
      ? Math.abs(this.dailyPnL) / this.initialCapital
      : 0;
    const drawdown = this.peakCapital - this.currentCapital;
    const drawdownRatio = this.peakCapital > 0 ? drawdown / this.peakCapital : 0;

    return {
      dailyPnL: this.dailyPnL,
      lossRatio,
      drawdown,
      drawdownRatio,
      peakCapital: this.peakCapital,
      isWarning: lossRatio >= this.config.dailyLossWarningRatio,
      isLimit: lossRatio >= this.config.dailyLossLimitRatio || drawdownRatio >= this.config.maxDrawdownRatio
    };
  }

  /**
   * Get P&L history
   */
  getPnLHistory(): PnLSnapshot[] {
    return [...this.pnlHistory];
  }

  /**
   * Check if daily loss limit is reached
   */
  isDailyLossLimitReached(): boolean {
    return this.limitTriggered;
  }

  /**
   * Reset for new session
   */
  reset(): void {
    this.stop();
    this.initialCapital = 0;
    this.currentCapital = 0;
    this.peakCapital = 0;
    this.dailyPnL = 0;
    this.pnlHistory = [];
    this.warningTriggered = false;
    this.limitTriggered = false;
  }

  /**
   * Get risk summary
   */
  getRiskSummary(): {
    dailyLossLimit: number;
    currentLoss: number;
    remainingLossBudget: number;
    maxDrawdownLimit: number;
    currentDrawdown: number;
  } {
    const dailyLossLimit = this.initialCapital * this.config.dailyLossLimitRatio;
    const currentLoss = Math.abs(this.dailyPnL);
    const maxDrawdownLimit = this.initialCapital * this.config.maxDrawdownRatio;
    const currentDrawdown = this.peakCapital - this.currentCapital;

    return {
      dailyLossLimit,
      currentLoss,
      remainingLossBudget: Math.max(0, dailyLossLimit - currentLoss),
      maxDrawdownLimit,
      currentDrawdown
    };
  }
}
