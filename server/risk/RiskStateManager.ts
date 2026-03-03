/**
 * [FAZ-2] Risk State Manager
 * Institutional Risk Engine State Machine
 * 
 * State Transitions:
 * TRACKING -> REDUCED_RISK -> HALTED -> KILL_SWITCH
 * 
 * All transitions are deterministic and logged for audit.
 */

export enum RiskState {
  TRACKING = 'TRACKING',           // Normal operation
  REDUCED_RISK = 'REDUCED_RISK',   // Reduced position sizes
  HALTED = 'HALTED',               // No new positions
  KILL_SWITCH = 'KILL_SWITCH'      // Emergency shutdown
}

export enum RiskStateTrigger {
  // Position limits
  MAX_POSITION_CAP_BREACH = 'MAX_POSITION_CAP_BREACH',
  LEVERAGE_CAP_BREACH = 'LEVERAGE_CAP_BREACH',
  
  // Drawdown
  DAILY_LOSS_LIMIT_REACHED = 'DAILY_LOSS_LIMIT_REACHED',
  DAILY_LOSS_WARNING = 'DAILY_LOSS_WARNING',
  
  // Consecutive losses
  CONSECUTIVE_LOSS_THRESHOLD = 'CONSECUTIVE_LOSS_THRESHOLD',
  
  // Multi-symbol exposure
  MULTI_SYMBOL_EXPOSURE_CAP = 'MULTI_SYMBOL_EXPOSURE_CAP',
  CORRELATION_RISK_HIGH = 'CORRELATION_RISK_HIGH',
  
  // Execution issues
  PARTIAL_FILL_REJECT_RATE_HIGH = 'PARTIAL_FILL_REJECT_RATE_HIGH',
  EXECUTION_TIMEOUT = 'EXECUTION_TIMEOUT',
  
  // Kill switch triggers
  DISCONNECT_DETECTED = 'DISCONNECT_DETECTED',
  LATENCY_SPIKE = 'LATENCY_SPIKE',
  VOLATILITY_SPIKE = 'VOLATILITY_SPIKE',
  MANUAL_KILL = 'MANUAL_KILL',
  
  // Recovery
  RISK_REDUCED = 'RISK_REDUCED',
  SYSTEM_STABLE = 'SYSTEM_STABLE',
  MANUAL_RESET = 'MANUAL_RESET'
}

export interface RiskStateTransition {
  from: RiskState;
  to: RiskState;
  trigger: RiskStateTrigger;
  timestamp: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface RiskStateConfig {
  // Reduced risk thresholds
  reducedRiskPositionMultiplier: number;  // e.g., 0.5 (50% of normal)
  
  // Halt thresholds
  haltConsecutiveLosses: number;
  haltDailyLossRatio: number;
  
  // Kill switch thresholds
  killSwitchLatencyMs: number;
  killSwitchVolatilityThreshold: number;
  killSwitchDisconnectTimeoutMs: number;
}

const DEFAULT_CONFIG: RiskStateConfig = {
  reducedRiskPositionMultiplier: 0.5,
  haltConsecutiveLosses: 5,
  haltDailyLossRatio: 0.15,  // 15% of capital
  killSwitchLatencyMs: 5000,  // 5 seconds
  killSwitchVolatilityThreshold: 0.05,  // 5% price move
  killSwitchDisconnectTimeoutMs: 30000  // 30 seconds
};

/**
 * [FAZ-2] Risk State Manager
 * Manages state transitions with full audit trail
 */
export class RiskStateManager {
  private currentState: RiskState = RiskState.TRACKING;
  private transitionHistory: RiskStateTransition[] = [];
  private config: RiskStateConfig;
  
  // State entry timestamps for duration tracking
  private stateEntryTime: Map<RiskState, number> = new Map();
  
  // Deterministic timestamp provider (for testing/replay)
  private timestampProvider: () => number;

  constructor(
    config: Partial<RiskStateConfig> = {},
    timestampProvider?: () => number
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.timestampProvider = timestampProvider || (() => Date.now());
    this.stateEntryTime.set(RiskState.TRACKING, this.getTimestamp());
  }

  /**
   * Get current risk state
   */
  getCurrentState(): RiskState {
    return this.currentState;
  }

  /**
   * Check if system is in a specific state
   */
  isInState(state: RiskState): boolean {
    return this.currentState === state;
  }

  /**
   * Check if trading is allowed
   */
  canTrade(): boolean {
    return this.currentState === RiskState.TRACKING || 
           this.currentState === RiskState.REDUCED_RISK;
  }

  /**
   * Check if new positions can be opened
   */
  canOpenPosition(): boolean {
    return this.currentState === RiskState.TRACKING || 
           this.currentState === RiskState.REDUCED_RISK;
  }

  /**
   * Check if reduced risk mode is active
   */
  isReducedRisk(): boolean {
    return this.currentState === RiskState.REDUCED_RISK;
  }

  /**
   * Get position size multiplier based on current state
   */
  getPositionSizeMultiplier(): number {
    switch (this.currentState) {
      case RiskState.TRACKING:
        return 1.0;
      case RiskState.REDUCED_RISK:
        return this.config.reducedRiskPositionMultiplier;
      case RiskState.HALTED:
      case RiskState.KILL_SWITCH:
        return 0.0;
      default:
        return 0.0;
    }
  }

  /**
   * Attempt state transition
   * Returns true if transition was successful
   */
  transition(trigger: RiskStateTrigger, reason: string, metadata?: Record<string, unknown>): boolean {
    const newState = this.determineNewState(trigger);
    
    if (newState === this.currentState) {
      return false; // No transition needed
    }

    // Validate transition
    if (!this.isValidTransition(this.currentState, newState)) {
      console.warn(`[RiskStateManager] Invalid transition: ${this.currentState} -> ${newState} (trigger: ${trigger})`);
      return false;
    }

    // Perform transition
    const transition: RiskStateTransition = {
      from: this.currentState,
      to: newState,
      trigger,
      timestamp: this.getTimestamp(),
      reason,
      metadata
    };

    this.transitionHistory.push(transition);
    this.currentState = newState;
    this.stateEntryTime.set(newState, this.getTimestamp());

    console.log(`[RiskStateManager] State transition: ${transition.from} -> ${transition.to} (${trigger})`);
    
    return true;
  }

  /**
   * Determine new state based on trigger
   */
  private determineNewState(trigger: RiskStateTrigger): RiskState {
    switch (trigger) {
      // Escalation triggers
      case RiskStateTrigger.MAX_POSITION_CAP_BREACH:
      case RiskStateTrigger.LEVERAGE_CAP_BREACH:
      case RiskStateTrigger.DAILY_LOSS_WARNING:
        return RiskState.REDUCED_RISK;

      case RiskStateTrigger.DAILY_LOSS_LIMIT_REACHED:
      case RiskStateTrigger.CONSECUTIVE_LOSS_THRESHOLD:
      case RiskStateTrigger.MULTI_SYMBOL_EXPOSURE_CAP:
      case RiskStateTrigger.CORRELATION_RISK_HIGH:
      case RiskStateTrigger.PARTIAL_FILL_REJECT_RATE_HIGH:
      case RiskStateTrigger.EXECUTION_TIMEOUT:
        return RiskState.HALTED;

      case RiskStateTrigger.DISCONNECT_DETECTED:
      case RiskStateTrigger.LATENCY_SPIKE:
      case RiskStateTrigger.VOLATILITY_SPIKE:
      case RiskStateTrigger.MANUAL_KILL:
        return RiskState.KILL_SWITCH;

      // Recovery triggers
      case RiskStateTrigger.RISK_REDUCED:
        if (this.currentState === RiskState.HALTED) {
          return RiskState.REDUCED_RISK;
        }
        return this.currentState;

      case RiskStateTrigger.SYSTEM_STABLE:
        return RiskState.TRACKING;

      case RiskStateTrigger.MANUAL_RESET:
        if (this.currentState === RiskState.KILL_SWITCH) {
          return RiskState.TRACKING;
        }
        return this.currentState;

      default:
        return this.currentState;
    }
  }

  /**
   * Validate if transition is allowed
   */
  private isValidTransition(from: RiskState, to: RiskState): boolean {
    // Define valid transitions
    const validTransitions: Record<RiskState, RiskState[]> = {
      [RiskState.TRACKING]: [RiskState.REDUCED_RISK, RiskState.HALTED, RiskState.KILL_SWITCH],
      [RiskState.REDUCED_RISK]: [RiskState.TRACKING, RiskState.HALTED, RiskState.KILL_SWITCH],
      [RiskState.HALTED]: [RiskState.REDUCED_RISK, RiskState.KILL_SWITCH, RiskState.TRACKING],
      [RiskState.KILL_SWITCH]: [RiskState.TRACKING]  // Only manual reset from kill switch
    };

    return validTransitions[from]?.includes(to) ?? false;
  }

  /**
   * Get transition history
   */
  getTransitionHistory(): RiskStateTransition[] {
    return [...this.transitionHistory];
  }

  /**
   * Get time spent in current state (ms)
   */
  getTimeInCurrentState(): number {
    const entryTime = this.stateEntryTime.get(this.currentState);
    if (!entryTime) return 0;
    return this.getTimestamp() - entryTime;
  }

  /**
   * Reset to TRACKING state (manual override)
   */
  reset(reason: string): void {
    if (this.currentState === RiskState.KILL_SWITCH) {
      console.warn('[RiskStateManager] Cannot reset from KILL_SWITCH without explicit trigger');
      return;
    }

    this.transition(RiskStateTrigger.SYSTEM_STABLE, reason);
  }

  /**
   * Emergency kill switch activation
   */
  activateKillSwitch(reason: string, metadata?: Record<string, unknown>): void {
    this.transition(RiskStateTrigger.MANUAL_KILL, reason, metadata);
  }

  /**
   * Get current state summary
   */
  getStateSummary(): {
    state: RiskState;
    canTrade: boolean;
    canOpenPosition: boolean;
    positionMultiplier: number;
    timeInState: number;
    transitionCount: number;
  } {
    return {
      state: this.currentState,
      canTrade: this.canTrade(),
      canOpenPosition: this.canOpenPosition(),
      positionMultiplier: this.getPositionSizeMultiplier(),
      timeInState: this.getTimeInCurrentState(),
      transitionCount: this.transitionHistory.length
    };
  }

  private getTimestamp(): number {
    return this.timestampProvider();
  }
}
