/**
 * [FAZ-2] Kill Switch Manager
 * R19-R20: Kill switch (disconnect, latency spike, volatility spike)
 * 
 * Emergency shutdown system with multiple triggers.
 */

import { RiskStateManager, RiskStateTrigger } from './RiskStateManager';

export interface KillSwitchConfig {
  // R19: Latency spike threshold (ms)
  latencySpikeThresholdMs: number;
  
  // R20: Volatility spike threshold (price change ratio)
  volatilitySpikeThreshold: number;
  
  // Disconnect timeout (ms)
  disconnectTimeoutMs: number;
  
  // Price monitoring window (ms)
  priceWindowMs: number;
  
  // Auto-close positions on kill switch
  autoClosePositions: boolean;
  
  // Notification channels
  alertChannels: ('email' | 'sms' | 'webhook')[];
}

export interface LatencySample {
  timestamp: number;
  latencyMs: number;
}

export interface PriceSample {
  timestamp: number;
  symbol: string;
  price: number;
}

export interface KillSwitchEvent {
  timestamp: number;
  trigger: RiskStateTrigger;
  reason: string;
  metadata: Record<string, unknown>;
}

const DEFAULT_CONFIG: KillSwitchConfig = {
  latencySpikeThresholdMs: 5000,    // 5 second latency spike
  volatilitySpikeThreshold: 0.05,   // 5% price move
  disconnectTimeoutMs: 30000,       // 30 second disconnect
  priceWindowMs: 60000,             // 1 minute price window
  autoClosePositions: true,
  alertChannels: ['email', 'webhook']
};

/**
 * [FAZ-2] Kill Switch Manager
 * Monitors system health and triggers emergency shutdown
 */
export class KillSwitchManager {
  private config: KillSwitchConfig;
  private stateManager: RiskStateManager;
  
  // Latency tracking
  private latencyHistory: LatencySample[] = [];
  private lastHeartbeat: number = 0;
  
  // Price tracking
  private priceHistory: Map<string, PriceSample[]> = new Map();
  
  // Event log
  private killSwitchEvents: KillSwitchEvent[] = [];
  
  // Disconnect detection
  private disconnectTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = true;

  constructor(
    stateManager: RiskStateManager,
    config: Partial<KillSwitchConfig> = {}
  ) {
    this.stateManager = stateManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastHeartbeat = Date.now();
  }

  /**
   * Record heartbeat from connection
   */
  recordHeartbeat(timestamp?: number): void {
    const ts = timestamp || Date.now();
    this.lastHeartbeat = ts;
    this.isConnected = true;
    
    // Clear disconnect timer
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    
    // Set new disconnect timer
    this.disconnectTimer = setTimeout(() => {
      this.handleDisconnect();
    }, this.config.disconnectTimeoutMs);
  }

  /**
   * Record latency sample
   */
  recordLatency(latencyMs: number, timestamp?: number): void {
    const ts = timestamp || Date.now();
    
    this.latencyHistory.push({ timestamp: ts, latencyMs });
    
    // Clean old samples
    this.cleanOldLatencySamples(ts);
    
    // Check for latency spike
    this.checkLatencySpike(latencyMs);
  }

  /**
   * Record price update
   */
  recordPrice(symbol: string, price: number, timestamp?: number): void {
    const ts = timestamp || Date.now();
    
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }
    
    const history = this.priceHistory.get(symbol)!;
    history.push({ timestamp: ts, symbol, price });
    
    // Clean old samples
    const cutoff = ts - this.config.priceWindowMs;
    const filtered = history.filter(p => p.timestamp >= cutoff);
    this.priceHistory.set(symbol, filtered);
    
    // Check for volatility spike
    this.checkVolatilitySpike(symbol, price, ts);
  }

  /**
   * Handle disconnect detection
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    
    const reason = `Connection lost for ${this.config.disconnectTimeoutMs}ms`;
    
    console.error(`[KillSwitchManager] ${reason}`);
    
    this.triggerKillSwitch(RiskStateTrigger.DISCONNECT_DETECTED, reason, {
      lastHeartbeat: this.lastHeartbeat,
      disconnectTimeoutMs: this.config.disconnectTimeoutMs
    });
  }

  /**
   * Check for latency spike
   */
  private checkLatencySpike(currentLatency: number): void {
    if (currentLatency < this.config.latencySpikeThresholdMs) return;
    
    // Check if this is a sustained spike (not just one sample)
    const recentSamples = this.latencyHistory.slice(-5);
    if (recentSamples.length < 5) return;
    
    const avgLatency = recentSamples.reduce((sum, s) => sum + s.latencyMs, 0) / recentSamples.length;
    
    if (avgLatency > this.config.latencySpikeThresholdMs) {
      const reason = `Latency spike detected: ${avgLatency.toFixed(0)}ms avg > ${this.config.latencySpikeThresholdMs}ms threshold`;
      
      console.error(`[KillSwitchManager] ${reason}`);
      
      this.triggerKillSwitch(RiskStateTrigger.LATENCY_SPIKE, reason, {
        avgLatency,
        threshold: this.config.latencySpikeThresholdMs,
        samples: recentSamples
      });
    }
  }

  /**
   * Check for volatility spike
   */
  private checkVolatilitySpike(symbol: string, currentPrice: number, timestamp: number): void {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length < 2) return;
    
    // Get price from window start
    const windowStart = history[0];
    const priceChange = Math.abs(currentPrice - windowStart.price) / windowStart.price;
    
    if (priceChange > this.config.volatilitySpikeThreshold) {
      const reason = `Volatility spike in ${symbol}: ${(priceChange * 100).toFixed(2)}% > ${(this.config.volatilitySpikeThreshold * 100).toFixed(2)}% threshold`;
      
      console.error(`[KillSwitchManager] ${reason}`);
      
      this.triggerKillSwitch(RiskStateTrigger.VOLATILITY_SPIKE, reason, {
        symbol,
        priceChange,
        threshold: this.config.volatilitySpikeThreshold,
        startPrice: windowStart.price,
        currentPrice
      });
    }
  }

  /**
   * Trigger kill switch
   */
  private triggerKillSwitch(
    trigger: RiskStateTrigger,
    reason: string,
    metadata: Record<string, unknown>
  ): void {
    // Log event
    const event: KillSwitchEvent = {
      timestamp: Date.now(),
      trigger,
      reason,
      metadata
    };
    this.killSwitchEvents.push(event);
    
    // Trigger state transition
    this.stateManager.transition(trigger, reason, metadata);
    
    // Perform kill switch actions
    this.executeKillSwitchActions();
  }

  /**
   * Execute kill switch actions
   */
  private executeKillSwitchActions(): void {
    console.error('[KillSwitchManager] EXECUTING KILL SWITCH ACTIONS');
    
    if (this.config.autoClosePositions) {
      console.error('[KillSwitchManager] Auto-closing all positions');
      // Position close logic would be called here
    }
    
    // Send alerts
    this.sendAlerts();
  }

  /**
   * Send alert notifications
   */
  private sendAlerts(): void {
    for (const channel of this.config.alertChannels) {
      console.log(`[KillSwitchManager] Sending alert via ${channel}`);
      // Alert sending logic would be implemented here
    }
  }

  /**
   * Clean old latency samples
   */
  private cleanOldLatencySamples(currentTime: number): void {
    const cutoff = currentTime - 60000; // Keep 1 minute
    this.latencyHistory = this.latencyHistory.filter(s => s.timestamp >= cutoff);
  }

  /**
   * Manual kill switch activation
   */
  activateManualKillSwitch(reason: string): void {
    this.triggerKillSwitch(RiskStateTrigger.MANUAL_KILL, reason, { manual: true });
  }

  /**
   * Get system health status
   */
  getSystemHealth(): {
    isConnected: boolean;
    lastHeartbeat: number;
    timeSinceLastHeartbeat: number;
    avgLatency: number;
    maxLatency: number;
  } {
    const now = Date.now();
    const recentSamples = this.latencyHistory.slice(-10);
    
    return {
      isConnected: this.isConnected,
      lastHeartbeat: this.lastHeartbeat,
      timeSinceLastHeartbeat: now - this.lastHeartbeat,
      avgLatency: recentSamples.length > 0 
        ? recentSamples.reduce((sum, s) => sum + s.latencyMs, 0) / recentSamples.length 
        : 0,
      maxLatency: recentSamples.length > 0
        ? Math.max(...recentSamples.map(s => s.latencyMs))
        : 0
    };
  }

  /**
   * Get volatility status for a symbol
   */
  getVolatilityStatus(symbol: string): {
    currentPrice: number;
    windowStartPrice: number;
    priceChange: number;
    isSpike: boolean;
  } {
    const history = this.priceHistory.get(symbol) || [];
    if (history.length < 2) {
      return { currentPrice: 0, windowStartPrice: 0, priceChange: 0, isSpike: false };
    }
    
    const current = history[history.length - 1];
    const start = history[0];
    const priceChange = Math.abs(current.price - start.price) / start.price;
    
    return {
      currentPrice: current.price,
      windowStartPrice: start.price,
      priceChange,
      isSpike: priceChange > this.config.volatilitySpikeThreshold
    };
  }

  /**
   * Get kill switch events
   */
  getKillSwitchEvents(): KillSwitchEvent[] {
    return [...this.killSwitchEvents];
  }

  /**
   * Reset kill switch manager
   */
  reset(): void {
    this.latencyHistory = [];
    this.priceHistory.clear();
    this.killSwitchEvents = [];
    this.lastHeartbeat = Date.now();
    this.isConnected = true;
    
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  /**
   * Check if kill switch is active
   */
  isKillSwitchActive(): boolean {
    return this.stateManager.getCurrentState() === 'KILL_SWITCH';
  }
}
