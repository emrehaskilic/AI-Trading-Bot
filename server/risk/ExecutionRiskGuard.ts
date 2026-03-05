/**
 * [FAZ-2] Execution Risk Guard
 * R16-R18: Partial fill / reject / timeout handling
 * 
 * Monitors execution quality and handles failures.
 */

import { RiskStateManager, RiskStateTrigger } from './RiskStateManager';

export interface ExecutionRiskConfig {
  // R16: Max partial fill rate (ratio)
  maxPartialFillRate: number;
  
  // R17: Max reject rate (ratio)
  maxRejectRate: number;
  
  // R18: Execution timeout (ms)
  executionTimeoutMs: number;
  
  // Window for rate calculations
  rateWindowMs: number;
  
  // Auto-halt on high failure rate
  autoHaltOnFailure: boolean;
}

export interface ExecutionEvent {
  timestamp: number;
  orderId: string;
  symbol: string;
  type: 'fill' | 'partial_fill' | 'reject' | 'timeout' | 'cancel';
  requestedQty: number;
  filledQty?: number;
  reason?: string;
}

const DEFAULT_CONFIG: ExecutionRiskConfig = {
  maxPartialFillRate: 0.3,      // 30% max partial fill rate
  maxRejectRate: 0.2,           // 20% max reject rate
  executionTimeoutMs: 10000,    // 10 second timeout
  rateWindowMs: 300000,         // 5 minute window
  autoHaltOnFailure: true
};

/**
 * [FAZ-2] Execution Risk Guard
 * Monitors execution quality and handles failures
 */
export class ExecutionRiskGuard {
  private config: ExecutionRiskConfig;
  private stateManager: RiskStateManager;
  
  // Execution history
  private executionHistory: ExecutionEvent[] = [];
  
  // Pending orders (for timeout tracking)
  private pendingOrders: Map<string, { timestamp: number; symbol: string; qty: number }> = new Map();
  
  // Rate tracking
  private partialFillCount: number = 0;
  private rejectCount: number = 0;
  private totalOrderCount: number = 0;

  constructor(
    stateManager: RiskStateManager,
    config: Partial<ExecutionRiskConfig> = {}
  ) {
    this.stateManager = stateManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record order submission
   */
  recordOrderSubmitted(orderId: string, symbol: string, qty: number, timestamp?: number): void {
    const ts = timestamp || Date.now();
    this.pendingOrders.set(orderId, { timestamp: ts, symbol, qty });
    this.totalOrderCount++;
    
    // Set timeout check
    setTimeout(() => {
      this.checkOrderTimeout(orderId);
    }, this.config.executionTimeoutMs);
  }

  /**
   * Record execution event
   */
  recordExecution(event: ExecutionEvent): void {
    this.executionHistory.push(event);
    
    // Remove from pending if completed
    if (event.type === 'fill' || event.type === 'reject' || event.type === 'cancel') {
      this.pendingOrders.delete(event.orderId);
    }
    
    // Update counts
    if (event.type === 'partial_fill') {
      this.partialFillCount++;
    } else if (event.type === 'reject') {
      this.rejectCount++;
    }
    
    // Clean old history
    this.cleanOldHistory(event.timestamp);
    
    // Evaluate rates
    this.evaluateRates();
  }

  /**
   * Check order timeout
   */
  private checkOrderTimeout(orderId: string): void {
    const order = this.pendingOrders.get(orderId);
    if (!order) return; // Already completed
    
    // Order timed out
    const timeoutEvent: ExecutionEvent = {
      timestamp: Date.now(),
      orderId,
      symbol: order.symbol,
      type: 'timeout',
      requestedQty: order.qty,
      reason: 'Execution timeout'
    };
    
    this.recordExecution(timeoutEvent);
    
    // Trigger state transition
    this.stateManager.transition(
      RiskStateTrigger.EXECUTION_TIMEOUT,
      `Order ${orderId} timed out after ${this.config.executionTimeoutMs}ms`,
      { orderId, symbol: order.symbol, timeoutMs: this.config.executionTimeoutMs }
    );
  }

  /**
   * Evaluate execution rates
   */
  private evaluateRates(): void {
    const windowEvents = this.getEventsInWindow();
    const totalInWindow = windowEvents.length;
    
    if (totalInWindow < 5) return; // Need minimum sample size
    
    const partialFills = windowEvents.filter(e => e.type === 'partial_fill').length;
    const rejects = windowEvents.filter(e => e.type === 'reject').length;
    
    const partialFillRate = partialFills / totalInWindow;
    const rejectRate = rejects / totalInWindow;

    // R16: Partial fill rate check
    if (partialFillRate > this.config.maxPartialFillRate) {
      const reason = `Partial fill rate exceeded: ${(partialFillRate * 100).toFixed(1)}% > ${(this.config.maxPartialFillRate * 100).toFixed(1)}%`;
      
      console.error(`[ExecutionRiskGuard] ${reason}`);
      
      this.stateManager.transition(
        RiskStateTrigger.PARTIAL_FILL_REJECT_RATE_HIGH,
        reason,
        { partialFillRate, threshold: this.config.maxPartialFillRate }
      );
      
      if (this.config.autoHaltOnFailure) {
        // Halt will be triggered by state manager
      }
    }

    // R17: Reject rate check
    if (rejectRate > this.config.maxRejectRate) {
      const reason = `Reject rate exceeded: ${(rejectRate * 100).toFixed(1)}% > ${(this.config.maxRejectRate * 100).toFixed(1)}%`;
      
      console.error(`[ExecutionRiskGuard] ${reason}`);
      
      this.stateManager.transition(
        RiskStateTrigger.PARTIAL_FILL_REJECT_RATE_HIGH,
        reason,
        { rejectRate, threshold: this.config.maxRejectRate }
      );
    }
  }

  /**
   * Get events within the rate window
   */
  private getEventsInWindow(): ExecutionEvent[] {
    const cutoff = Date.now() - this.config.rateWindowMs;
    return this.executionHistory.filter(e => e.timestamp >= cutoff);
  }

  /**
   * Clean old history
   */
  private cleanOldHistory(currentTime: number): void {
    const cutoff = currentTime - this.config.rateWindowMs * 2; // Keep 2x window
    
    const oldLength = this.executionHistory.length;
    this.executionHistory = this.executionHistory.filter(e => e.timestamp >= cutoff);
    
    // Recalculate counts if history was trimmed
    if (this.executionHistory.length < oldLength) {
      this.recalculateCounts();
    }
  }

  /**
   * Recalculate counts from history
   */
  private recalculateCounts(): void {
    this.partialFillCount = this.executionHistory.filter(e => e.type === 'partial_fill').length;
    this.rejectCount = this.executionHistory.filter(e => e.type === 'reject').length;
    this.totalOrderCount = this.executionHistory.length;
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): {
    totalOrders: number;
    partialFills: number;
    rejects: number;
    timeouts: number;
    partialFillRate: number;
    rejectRate: number;
    pendingOrders: number;
  } {
    const windowEvents = this.getEventsInWindow();
    const totalInWindow = windowEvents.length;
    
    return {
      totalOrders: this.totalOrderCount,
      partialFills: this.partialFillCount,
      rejects: this.rejectCount,
      timeouts: this.executionHistory.filter(e => e.type === 'timeout').length,
      partialFillRate: totalInWindow > 0 ? windowEvents.filter(e => e.type === 'partial_fill').length / totalInWindow : 0,
      rejectRate: totalInWindow > 0 ? windowEvents.filter(e => e.type === 'reject').length / totalInWindow : 0,
      pendingOrders: this.pendingOrders.size
    };
  }

  /**
   * Expose active guard thresholds for external coordinators.
   */
  getThresholds(): Pick<ExecutionRiskConfig, 'maxPartialFillRate' | 'maxRejectRate'> {
    return {
      maxPartialFillRate: this.config.maxPartialFillRate,
      maxRejectRate: this.config.maxRejectRate,
    };
  }

  /**
   * Get pending orders
   */
  getPendingOrders(): { orderId: string; symbol: string; qty: number; elapsedMs: number }[] {
    const now = Date.now();
    const pending: { orderId: string; symbol: string; qty: number; elapsedMs: number }[] = [];
    
    for (const [orderId, order] of this.pendingOrders.entries()) {
      pending.push({
        orderId,
        symbol: order.symbol,
        qty: order.qty,
        elapsedMs: now - order.timestamp
      });
    }
    
    return pending;
  }

  /**
   * Reset guard
   */
  reset(): void {
    this.executionHistory = [];
    this.pendingOrders.clear();
    this.partialFillCount = 0;
    this.rejectCount = 0;
    this.totalOrderCount = 0;
  }

  /**
   * Get execution quality score (0-1, higher is better)
   */
  getExecutionQualityScore(): number {
    const stats = this.getExecutionStats();
    if (stats.totalOrders === 0) return 1.0;
    
    // Weighted score
    const fillScore = 1 - stats.partialFillRate;
    const rejectScore = 1 - stats.rejectRate;
    
    return (fillScore * 0.5) + (rejectScore * 0.5);
  }
}
