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

import { RiskStateManager, RiskState, RiskStateConfig, RiskStateTrigger } from './RiskStateManager';
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
  autoRecovery?: Partial<RiskAutoRecoveryConfig>;
}

export interface RiskAutoRecoveryConfig {
  enabled: boolean;
  haltedStableMs: number;
  reducedStableMs: number;
  haltedExecutionHeadroom: number;
  reducedExecutionHeadroom: number;
  haltedNotionalUtilization: number;
  haltedLeverageUtilization: number;
  reducedNotionalUtilization: number;
  reducedLeverageUtilization: number;
  maxHeartbeatAgeMs: number;
}

export interface AutoRecoveryResult {
  enabled: boolean;
  fromState: RiskState;
  targetState: RiskState | null;
  transitioned: boolean;
  blockedReasons: string[];
  stableForMs: number;
  requiredStableMs: number;
}

const DEFAULT_AUTO_RECOVERY_CONFIG: RiskAutoRecoveryConfig = {
  enabled: true,
  haltedStableMs: 30_000,
  reducedStableMs: 60_000,
  haltedExecutionHeadroom: 0.9,
  reducedExecutionHeadroom: 0.75,
  haltedNotionalUtilization: 0.95,
  haltedLeverageUtilization: 0.95,
  reducedNotionalUtilization: 0.8,
  reducedLeverageUtilization: 0.8,
  maxHeartbeatAgeMs: 15_000,
};

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
  private readonly autoRecoveryConfig: RiskAutoRecoveryConfig;
  
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
  private autoRecoveryStableSinceMs: number | null = null;
  private autoRecoveryTargetState: RiskState | null = null;

  constructor(config: InstitutionalRiskConfig = {}) {
    this.config = { ...config };
    const rawAutoRecovery = { ...DEFAULT_AUTO_RECOVERY_CONFIG, ...(this.config.autoRecovery || {}) };
    this.autoRecoveryConfig = {
      enabled: Boolean(rawAutoRecovery.enabled),
      haltedStableMs: Math.max(1_000, Number(rawAutoRecovery.haltedStableMs || DEFAULT_AUTO_RECOVERY_CONFIG.haltedStableMs)),
      reducedStableMs: Math.max(1_000, Number(rawAutoRecovery.reducedStableMs || DEFAULT_AUTO_RECOVERY_CONFIG.reducedStableMs)),
      haltedExecutionHeadroom: Math.max(0.1, Math.min(1, Number(rawAutoRecovery.haltedExecutionHeadroom || DEFAULT_AUTO_RECOVERY_CONFIG.haltedExecutionHeadroom))),
      reducedExecutionHeadroom: Math.max(0.1, Math.min(1, Number(rawAutoRecovery.reducedExecutionHeadroom || DEFAULT_AUTO_RECOVERY_CONFIG.reducedExecutionHeadroom))),
      haltedNotionalUtilization: Math.max(0.05, Math.min(1, Number(rawAutoRecovery.haltedNotionalUtilization || DEFAULT_AUTO_RECOVERY_CONFIG.haltedNotionalUtilization))),
      haltedLeverageUtilization: Math.max(0.05, Math.min(1, Number(rawAutoRecovery.haltedLeverageUtilization || DEFAULT_AUTO_RECOVERY_CONFIG.haltedLeverageUtilization))),
      reducedNotionalUtilization: Math.max(0.05, Math.min(1, Number(rawAutoRecovery.reducedNotionalUtilization || DEFAULT_AUTO_RECOVERY_CONFIG.reducedNotionalUtilization))),
      reducedLeverageUtilization: Math.max(0.05, Math.min(1, Number(rawAutoRecovery.reducedLeverageUtilization || DEFAULT_AUTO_RECOVERY_CONFIG.reducedLeverageUtilization))),
      maxHeartbeatAgeMs: Math.max(1_000, Number(rawAutoRecovery.maxHeartbeatAgeMs || DEFAULT_AUTO_RECOVERY_CONFIG.maxHeartbeatAgeMs)),
    };

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
   * Evaluate auto-recovery from HALTED/REDUCED states.
   * Uses hysteresis and strict safety checks to avoid flip-flopping.
   */
  evaluateAutoRecovery(timestamp?: number): AutoRecoveryResult {
    const state = this.stateManager.getCurrentState();
    const result: AutoRecoveryResult = {
      enabled: this.autoRecoveryConfig.enabled,
      fromState: state,
      targetState: null,
      transitioned: false,
      blockedReasons: [],
      stableForMs: 0,
      requiredStableMs: 0,
    };

    if (!this.autoRecoveryConfig.enabled || !this.isInitialized) {
      return result;
    }

    if (state === RiskState.KILL_SWITCH || state === RiskState.TRACKING) {
      this.autoRecoveryStableSinceMs = null;
      this.autoRecoveryTargetState = null;
      return result;
    }

    const now = timestamp || Date.now();
    this.consecutiveLossGuard.refresh(now);

    const drawdown = this.drawdownGuard.getDrawdownStatus();
    const lossStats = this.consecutiveLossGuard.getLossStatistics();
    const lossThresholds = this.consecutiveLossGuard.getThresholds();
    const executionStats = this.executionGuard.getExecutionStats();
    const executionThresholds = this.executionGuard.getThresholds();
    const positionSummary = this.positionGuard.getPositionSummary(this.accountEquity);
    const killSwitchHealth = this.killSwitchManager.getSystemHealth();

    const isHalted = state === RiskState.HALTED;
    const targetState = isHalted ? RiskState.REDUCED_RISK : RiskState.TRACKING;
    const requiredStableMs = isHalted
      ? this.autoRecoveryConfig.haltedStableMs
      : this.autoRecoveryConfig.reducedStableMs;
    const executionHeadroom = isHalted
      ? this.autoRecoveryConfig.haltedExecutionHeadroom
      : this.autoRecoveryConfig.reducedExecutionHeadroom;
    const notionalUtilizationLimit = isHalted
      ? this.autoRecoveryConfig.haltedNotionalUtilization
      : this.autoRecoveryConfig.reducedNotionalUtilization;
    const leverageUtilizationLimit = isHalted
      ? this.autoRecoveryConfig.haltedLeverageUtilization
      : this.autoRecoveryConfig.reducedLeverageUtilization;
    const maxConsecutiveLosses = isHalted
      ? Math.max(0, lossThresholds.maxConsecutiveLosses - 1)
      : Math.max(0, lossThresholds.reducedRiskThreshold - 1);

    result.targetState = targetState;
    result.requiredStableMs = requiredStableMs;

    if (this.autoRecoveryTargetState !== targetState) {
      this.autoRecoveryTargetState = targetState;
      this.autoRecoveryStableSinceMs = null;
    }

    const maxPartialFillForRecovery = executionThresholds.maxPartialFillRate * executionHeadroom;
    const maxRejectForRecovery = executionThresholds.maxRejectRate * executionHeadroom;

    if (drawdown.isLimit) {
      result.blockedReasons.push('drawdown_limit_active');
    }
    if (!isHalted && drawdown.isWarning) {
      result.blockedReasons.push('drawdown_warning_active');
    }
    if (lossStats.consecutiveLosses > maxConsecutiveLosses) {
      result.blockedReasons.push('consecutive_losses_not_cleared');
    }
    if (executionStats.partialFillRate > maxPartialFillForRecovery) {
      result.blockedReasons.push('partial_fill_rate_high');
    }
    if (executionStats.rejectRate > maxRejectForRecovery) {
      result.blockedReasons.push('reject_rate_high');
    }
    if (positionSummary.utilization.notional > notionalUtilizationLimit) {
      result.blockedReasons.push('notional_utilization_high');
    }
    if (positionSummary.utilization.leverage > leverageUtilizationLimit) {
      result.blockedReasons.push('leverage_utilization_high');
    }
    if (!killSwitchHealth.isConnected) {
      result.blockedReasons.push('heartbeat_disconnected');
    }
    if (killSwitchHealth.timeSinceLastHeartbeat > this.autoRecoveryConfig.maxHeartbeatAgeMs) {
      result.blockedReasons.push('heartbeat_stale');
    }

    if (result.blockedReasons.length > 0) {
      this.autoRecoveryStableSinceMs = null;
      return result;
    }

    if (this.autoRecoveryStableSinceMs == null) {
      this.autoRecoveryStableSinceMs = now;
      return result;
    }

    result.stableForMs = Math.max(0, now - this.autoRecoveryStableSinceMs);
    if (result.stableForMs < requiredStableMs) {
      return result;
    }

    const trigger = isHalted ? RiskStateTrigger.RISK_REDUCED : RiskStateTrigger.SYSTEM_STABLE;
    const transitioned = this.stateManager.transition(
      trigger,
      `auto_recovery_${state.toLowerCase()}_to_${targetState.toLowerCase()}`,
      {
        stableForMs: result.stableForMs,
        requiredStableMs,
        execution: {
          partialFillRate: executionStats.partialFillRate,
          rejectRate: executionStats.rejectRate,
        },
        drawdown: {
          isWarning: drawdown.isWarning,
          isLimit: drawdown.isLimit,
          lossRatio: drawdown.lossRatio,
        },
        positionUtilization: positionSummary.utilization,
        consecutiveLosses: lossStats.consecutiveLosses,
      }
    );

    result.transitioned = transitioned;
    if (transitioned) {
      this.autoRecoveryStableSinceMs = null;
      this.autoRecoveryTargetState = null;
    }
    return result;
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
    this.killSwitchManager.reset();
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
    this.autoRecoveryStableSinceMs = null;
    this.autoRecoveryTargetState = null;
  }

  /**
   * Stop all monitoring
   */
  stop(): void {
    this.drawdownGuard.stop();
    this.killSwitchManager.reset();
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
