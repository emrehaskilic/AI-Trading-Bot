/**
 * [FAZ-2] Institutional Risk Engine
 * 
 * Main coordinator for all risk guards:
 * - PositionRiskGuard (R1-R4)
 * - DrawdownRiskGuard (R5-R8)
 * - ConsecutiveLossGuard (R9-R12)
 * - MultiSymbolExposureGuard (R13-R15)
 * - ExecutionRiskGuard (R16-R18)
 * - KillSwitchManager (R19-R20)
 * 
 * State Machine: TRACKING -> REDUCED_RISK -> HALTED -> KILL_SWITCH
 */

import { RiskStateManager, RiskState, RiskStateConfig } from './RiskStateManager';
import { PositionRiskGuard, PositionRiskConfig } from './PositionRiskGuard';
import { DrawdownRiskGuard, DrawdownRiskConfig } from './DrawdownRiskGuard';
import { ConsecutiveLossGuard, ConsecutiveLossConfig } from './ConsecutiveLossGuard';
import { MultiSymbolExposureGuard, MultiSymbolExposureConfig } from './MultiSymbolExposureGuard';
import { ExecutionRiskGuard, ExecutionRiskConfig } from './ExecutionRiskGuard';
import { KillSwitchManager, KillSwitchConfig } from './KillSwitchManager';

export interface InstitutionalRiskConfig {
  state?: Partial<RiskStateConfig>;
  position?: Partial<PositionRiskConfig>;
  drawdown?: Partial<DrawdownRiskConfig>;
  consecutiveLoss?: Partial<ConsecutiveLossConfig>;
  multiSymbol?: Partial<MultiSymbolExposureConfig>;
  execution?: Partial<ExecutionRiskConfig>;
  killSwitch?: Partial<KillSwitchConfig>;
}

export interface RiskCheckResult {
  allowed: boolean;
  state: RiskState;
  reason?: string;
  positionMultiplier: number;
  guards: {
    position: boolean;
    drawdown: boolean;
    consecutiveLoss: boolean;
    multiSymbol: boolean;
    execution: boolean;
    killSwitch: boolean;
  };
}

export interface RiskSummary {
  state: RiskState;
  canTrade: boolean;
  canOpenPosition: boolean;
  positionMultiplier: number;
  guards: {
    position: ReturnType<PositionRiskGuard['getPositionSummary']>;
    drawdown: ReturnType<DrawdownRiskGuard['getDrawdownStatus']>;
    consecutiveLoss: ReturnType<ConsecutiveLossGuard['getLossStatistics']>;
    multiSymbol: ReturnType<MultiSymbolExposureGuard['getExposureSummary']>;
    execution: ReturnType<ExecutionRiskGuard['getExecutionStats']>;
    killSwitch: ReturnType<KillSwitchManager['getSystemHealth']>;
  };
}

/**
 * [FAZ-2] Institutional Risk Engine
 * Central coordinator for all risk management
 */
export class InstitutionalRiskEngine {
  // Core state manager
  private stateManager: RiskStateManager;
  private readonly config: InstitutionalRiskConfig;
  
  // Risk guards
  private positionGuard: PositionRiskGuard;
  private drawdownGuard: DrawdownRiskGuard;
  private consecutiveLossGuard: ConsecutiveLossGuard;
  private multiSymbolGuard: MultiSymbolExposureGuard;
  private executionGuard: ExecutionRiskGuard;
  private killSwitchManager: KillSwitchManager;
  
  // Account state
  private accountEquity: number = 0;
  private isInitialized: boolean = false;

  constructor(config: InstitutionalRiskConfig = {}) {
    this.config = { ...config };

    // Initialize state manager first
    this.stateManager = new RiskStateManager(this.config.state);
    
    // Initialize all guards
    this.positionGuard = new PositionRiskGuard(this.stateManager, this.config.position);
    this.drawdownGuard = new DrawdownRiskGuard(this.stateManager, this.config.drawdown);
    this.consecutiveLossGuard = new ConsecutiveLossGuard(this.stateManager, this.config.consecutiveLoss);
    this.multiSymbolGuard = new MultiSymbolExposureGuard(this.stateManager, this.config.multiSymbol);
    this.executionGuard = new ExecutionRiskGuard(this.stateManager, this.config.execution);
    this.killSwitchManager = new KillSwitchManager(this.stateManager, this.config.killSwitch);
  }

  /**
   * Initialize risk engine with account equity
   */
  initialize(initialEquity: number): void {
    this.accountEquity = initialEquity;
    this.drawdownGuard.initialize(initialEquity);
    this.drawdownGuard.start();
    this.isInitialized = true;
    
    console.log(`[InstitutionalRiskEngine] Initialized with equity: ${initialEquity}`);
  }

  /**
   * Check if trade is allowed (comprehensive check)
   */
  canTrade(
    symbol: string,
    quantity: number,
    notional: number,
    direction: 'long' | 'short'
  ): RiskCheckResult {
    if (!this.isInitialized) {
      return {
        allowed: false,
        state: RiskState.HALTED,
        reason: 'Risk engine not initialized',
        positionMultiplier: 0,
        guards: {
          position: false,
          drawdown: false,
          consecutiveLoss: false,
          multiSymbol: false,
          execution: false,
          killSwitch: false
        }
      };
    }

    const result: RiskCheckResult = {
      allowed: true,
      state: this.stateManager.getCurrentState(),
      positionMultiplier: this.getPositionMultiplier(),
      guards: {
        position: true,
        drawdown: true,
        consecutiveLoss: true,
        multiSymbol: true,
        execution: true,
        killSwitch: true
      }
    };

    // Check kill switch first (highest priority)
    if (this.killSwitchManager.isKillSwitchActive()) {
      result.allowed = false;
      result.reason = 'Kill switch is active';
      result.guards.killSwitch = false;
      return result;
    }

    // Check state manager
    if (!this.stateManager.canTrade()) {
      result.allowed = false;
      result.reason = `Trading not allowed in state: ${result.state}`;
      return result;
    }

    // R1-R4: Position risk check
    const positionCheck = this.positionGuard.canOpenPosition(symbol, quantity, notional, this.accountEquity);
    if (!positionCheck.allowed) {
      result.allowed = false;
      result.reason = positionCheck.reason;
      result.guards.position = false;
      return result;
    }

    // R5-R8: Drawdown check
    const drawdownStatus = this.drawdownGuard.getDrawdownStatus();
    if (drawdownStatus.isLimit) {
      result.allowed = false;
      result.reason = 'Daily loss limit reached';
      result.guards.drawdown = false;
      return result;
    }

    // R9-R12: Consecutive loss check
    if (this.consecutiveLossGuard.shouldHalt()) {
      result.allowed = false;
      result.reason = `Consecutive loss limit reached: ${this.consecutiveLossGuard.getConsecutiveLosses()}`;
      result.guards.consecutiveLoss = false;
      return result;
    }

    // R13-R15: Multi-symbol exposure check
    const exposureCheck = this.multiSymbolGuard.canOpenPosition(symbol, notional, direction, this.accountEquity);
    if (!exposureCheck.allowed) {
      result.allowed = false;
      result.reason = exposureCheck.reason;
      result.guards.multiSymbol = false;
      return result;
    }

    // R16-R18: Execution quality check (aligned with guard configuration)
    const executionStats = this.executionGuard.getExecutionStats();
    const thresholds = this.executionGuard.getThresholds();
    if (
      executionStats.partialFillRate > thresholds.maxPartialFillRate ||
      executionStats.rejectRate > thresholds.maxRejectRate
    ) {
      result.allowed = false;
      result.reason = `Execution quality too low: partialFill=${(executionStats.partialFillRate * 100).toFixed(1)}%, reject=${(executionStats.rejectRate * 100).toFixed(1)}%`;
      result.guards.execution = false;
      return result;
    }

    return result;
  }

  /**
   * Pre-trade check (lightweight)
   */
  preTradeCheck(symbol: string, quantity: number, notional: number): boolean {
    const result = this.canTrade(symbol, quantity, notional, 'long');
    return result.allowed;
  }

  /**
   * Update position (call after trade execution)
   */
  updatePosition(symbol: string, quantity: number, notional: number, leverage: number): void {
    this.positionGuard.updatePosition({ symbol, quantity, notional, leverage });
    this.multiSymbolGuard.updateExposure({ 
      symbol, 
      notional, 
      direction: quantity > 0 ? 'long' : 'short',
      leverage 
    });
  }

  /**
   * Record trade result (for consecutive loss tracking)
   */
  recordTradeResult(symbol: string, pnl: number, quantity: number, timestamp?: number): void {
    this.consecutiveLossGuard.recordTrade({
      timestamp: timestamp || Date.now(),
      symbol,
      pnl,
      quantity
    });
  }

  /**
   * Record execution event
   */
  recordExecutionEvent(
    orderId: string,
    symbol: string,
    type: 'fill' | 'partial_fill' | 'reject' | 'timeout' | 'cancel',
    requestedQty: number,
    filledQty?: number
  ): void {
    this.executionGuard.recordExecution({
      timestamp: Date.now(),
      orderId,
      symbol,
      type,
      requestedQty,
      filledQty
    });
  }

  /**
   * Update account equity
   */
  updateEquity(equity: number, timestamp?: number): void {
    this.accountEquity = equity;
    this.drawdownGuard.updateCapital(equity, timestamp);
  }

  /**
   * Record heartbeat (for disconnect detection)
   */
  recordHeartbeat(timestamp?: number): void {
    this.killSwitchManager.recordHeartbeat(timestamp);
  }

  /**
   * Record latency sample
   */
  recordLatency(latencyMs: number, timestamp?: number): void {
    this.killSwitchManager.recordLatency(latencyMs, timestamp);
  }

  /**
   * Record price update (for volatility detection)
   */
  recordPrice(symbol: string, price: number, timestamp?: number): void {
    this.killSwitchManager.recordPrice(symbol, price, timestamp);
  }

  /**
   * Get position multiplier based on risk state
   */
  getPositionMultiplier(): number {
    // Combine multipliers from different guards
    const stateMultiplier = this.stateManager.getPositionSizeMultiplier();
    const consecutiveLossMultiplier = this.consecutiveLossGuard.getPositionSizeMultiplier();
    
    return Math.min(stateMultiplier, consecutiveLossMultiplier);
  }

  /**
   * Get current risk state
   */
  getRiskState(): RiskState {
    return this.stateManager.getCurrentState();
  }

  /**
   * Get comprehensive risk summary
   */
  getRiskSummary(): RiskSummary {
    return {
      state: this.stateManager.getCurrentState(),
      canTrade: this.stateManager.canTrade(),
      canOpenPosition: this.stateManager.canOpenPosition(),
      positionMultiplier: this.getPositionMultiplier(),
      guards: {
        position: this.positionGuard.getPositionSummary(this.accountEquity),
        drawdown: this.drawdownGuard.getDrawdownStatus(),
        consecutiveLoss: this.consecutiveLossGuard.getLossStatistics(),
        multiSymbol: this.multiSymbolGuard.getExposureSummary(this.accountEquity),
        execution: this.executionGuard.getExecutionStats(),
        killSwitch: this.killSwitchManager.getSystemHealth()
      }
    };
  }

  /**
   * Get state manager (for advanced operations)
   */
  getStateManager(): RiskStateManager {
    return this.stateManager;
  }

  /**
   * Get individual guards (for direct access)
   */
  getGuards(): {
    position: PositionRiskGuard;
    drawdown: DrawdownRiskGuard;
    consecutiveLoss: ConsecutiveLossGuard;
    multiSymbol: MultiSymbolExposureGuard;
    execution: ExecutionRiskGuard;
    killSwitch: KillSwitchManager;
  } {
    return {
      position: this.positionGuard,
      drawdown: this.drawdownGuard,
      consecutiveLoss: this.consecutiveLossGuard,
      multiSymbol: this.multiSymbolGuard,
      execution: this.executionGuard,
      killSwitch: this.killSwitchManager
    };
  }

  /**
   * Manual kill switch activation
   */
  activateKillSwitch(reason: string): void {
    this.killSwitchManager.activateManualKillSwitch(reason);
  }

  /**
   * Reset risk engine (for testing/replay)
   */
  reset(): void {
    this.stop();
    this.stateManager = new RiskStateManager(this.config.state);
    this.positionGuard = new PositionRiskGuard(this.stateManager, this.config.position);
    this.drawdownGuard = new DrawdownRiskGuard(this.stateManager, this.config.drawdown);
    this.consecutiveLossGuard = new ConsecutiveLossGuard(this.stateManager, this.config.consecutiveLoss);
    this.multiSymbolGuard = new MultiSymbolExposureGuard(this.stateManager, this.config.multiSymbol);
    this.executionGuard = new ExecutionRiskGuard(this.stateManager, this.config.execution);
    this.killSwitchManager = new KillSwitchManager(this.stateManager, this.config.killSwitch);
    this.positionGuard.reset();
    this.drawdownGuard.reset();
    this.consecutiveLossGuard.reset();
    this.multiSymbolGuard.reset();
    this.executionGuard.reset();
    this.killSwitchManager.reset();
    this.accountEquity = 0;
    this.isInitialized = false;
  }

  /**
   * Stop all monitoring
   */
  stop(): void {
    this.drawdownGuard.stop();
  }

  /**
   * Check if risk engine is healthy
   */
  isHealthy(): boolean {
    const state = this.stateManager.getCurrentState();
    return state !== RiskState.HALTED && state !== RiskState.KILL_SWITCH;
  }
}

// Export all components
export * from './RiskStateManager';
export * from './PositionRiskGuard';
export * from './DrawdownRiskGuard';
export * from './ConsecutiveLossGuard';
export * from './MultiSymbolExposureGuard';
export * from './ExecutionRiskGuard';
export * from './KillSwitchManager';
