/**
 * [FAZ-6] Latency Guard - M4 Mitigation Patch
 * 
 * Monitors system latency and triggers protective actions:
 * - p95 > 100ms threshold
 * - p99 > 200ms threshold
 * - Event loop lag > 50ms
 * 
 * Actions: Trade suppression + Kill Switch integration
 */

export interface LatencyGuardConfig {
  // p95 threshold (ms)
  p95ThresholdMs: number;
  // p99 threshold (ms)
  p99ThresholdMs: number;
  // Event loop lag threshold (ms)
  eventLoopLagThresholdMs: number;
  // Sample window size
  sampleWindowSize: number;
  // Consecutive violations before action
  consecutiveViolations: number;
  // Cooldown after trigger (ms)
  cooldownMs: number;
  // Enable kill switch integration
  enableKillSwitch: boolean;
  // Kill switch trigger after N severe violations
  killSwitchAfterViolations: number;
}

export interface LatencySample {
  latencyMs: number;
  timestampMs: number;
  type: 'network' | 'processing' | 'event_loop';
}

export interface LatencyMetrics {
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  sampleCount: number;
}

export interface LatencyGuardResult {
  healthy: boolean;
  severity: 'none' | 'warning' | 'critical';
  p95Violation: boolean;
  p99Violation: boolean;
  eventLoopViolation: boolean;
  consecutiveViolations: number;
  shouldSuppressTrades: boolean;
  shouldTriggerKillSwitch: boolean;
  reason: string;
}

export interface LatencyGuardStatus {
  metrics: LatencyMetrics;
  eventLoopLagMs: number;
  isHealthy: boolean;
  consecutiveViolations: number;
  totalViolations: number;
  lastViolationMs: number;
  inCooldown: boolean;
  tradesSuppressed: boolean;
}

const DEFAULT_CONFIG: LatencyGuardConfig = {
  p95ThresholdMs: 100,              // p95 > 100ms
  p99ThresholdMs: 200,              // p99 > 200ms
  eventLoopLagThresholdMs: 50,      // Event loop > 50ms
  sampleWindowSize: 1000,           // Keep 1000 samples
  consecutiveViolations: 3,         // 3+ violations = action
  cooldownMs: 5000,                 // 5 second cooldown
  enableKillSwitch: true,           // Enable kill switch
  killSwitchAfterViolations: 5,     // 5 severe = kill switch
};

/**
 * Latency Guard - Monitors system latency metrics
 */
export class LatencyGuard {
  private readonly config: LatencyGuardConfig;
  private readonly samples: LatencySample[] = [];
  private readonly eventLoopSamples: number[] = [];
  
  private consecutiveViolationCount = 0;
  private totalViolations = 0;
  private lastViolationMs = 0;
  private lastCooldownStartMs = 0;
  private eventLoopLagMs = 0;

  constructor(config?: Partial<LatencyGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a latency sample
   */
  recordLatency(latencyMs: number, timestampMs: number, type: 'network' | 'processing' = 'network'): LatencyGuardResult {
    this.samples.push({
      latencyMs,
      timestampMs,
      type,
    });

    // Maintain window size
    this.maintainWindow(timestampMs);

    // Check thresholds
    return this.checkThresholds(timestampMs);
  }

  /**
   * Record event loop lag measurement
   */
  recordEventLoopLag(lagMs: number, timestampMs: number): LatencyGuardResult {
    this.eventLoopLagMs = lagMs;
    this.eventLoopSamples.push(lagMs);

    // Keep limited history
    while (this.eventLoopSamples.length > 100) {
      this.eventLoopSamples.shift();
    }

    // Check if this constitutes a violation
    if (lagMs > this.config.eventLoopLagThresholdMs) {
      return this.recordViolation(timestampMs, `event_loop_lag_${lagMs.toFixed(0)}ms`);
    }

    return this.checkThresholds(timestampMs);
  }

  /**
   * Check if trades should be suppressed
   */
  shouldSuppressTrades(nowMs: number): boolean {
    // Suppress if in cooldown
    if (this.isInCooldown(nowMs)) return true;
    
    // Suppress if consecutive violations
    if (this.consecutiveViolationCount >= this.config.consecutiveViolations) return true;
    
    // Suppress if event loop lag critical
    if (this.eventLoopLagMs > this.config.eventLoopLagThresholdMs * 2) return true;

    return false;
  }

  /**
   * Check if kill switch should be triggered
   */
  shouldTriggerKillSwitch(nowMs: number): boolean {
    if (!this.config.enableKillSwitch) return false;
    
    // Trigger if severe consecutive violations
    if (this.consecutiveViolationCount >= this.config.killSwitchAfterViolations) {
      return true;
    }

    // Trigger if extreme event loop lag
    if (this.eventLoopLagMs > this.config.eventLoopLagThresholdMs * 4) {
      return true;
    }

    return false;
  }

  /**
   * Get current latency metrics
   */
  getMetrics(): LatencyMetrics {
    const latencies = this.samples.map(s => s.latencyMs);
    return this.calculateMetrics(latencies);
  }

  /**
   * Get guard status
   */
  getStatus(nowMs: number): LatencyGuardStatus {
    const metrics = this.getMetrics();
    const result = this.checkThresholds(nowMs);

    return {
      metrics,
      eventLoopLagMs: this.eventLoopLagMs,
      isHealthy: result.healthy,
      consecutiveViolations: this.consecutiveViolationCount,
      totalViolations: this.totalViolations,
      lastViolationMs: this.lastViolationMs,
      inCooldown: this.isInCooldown(nowMs),
      tradesSuppressed: this.shouldSuppressTrades(nowMs),
    };
  }

  /**
   * Reset guard state
   */
  reset(): void {
    this.samples.length = 0;
    this.eventLoopSamples.length = 0;
    this.consecutiveViolationCount = 0;
    this.totalViolations = 0;
    this.lastViolationMs = 0;
    this.lastCooldownStartMs = 0;
    this.eventLoopLagMs = 0;
  }

  /**
   * Force cooldown period
   */
  forceCooldown(nowMs: number): void {
    this.lastCooldownStartMs = nowMs;
    this.consecutiveViolationCount = 0;
  }

  private maintainWindow(referenceTimeMs: number): void {
    // Remove oldest samples if over window size
    while (this.samples.length > this.config.sampleWindowSize) {
      this.samples.shift();
    }

    // Also remove samples older than 5 minutes
    const cutoff = referenceTimeMs - 5 * 60 * 1000;
    while (this.samples.length > 0 && this.samples[0].timestampMs < cutoff) {
      this.samples.shift();
    }
  }

  private checkThresholds(timestampMs: number): LatencyGuardResult {
    const metrics = this.getMetrics();
    
    const p95Violation = metrics.p95 > this.config.p95ThresholdMs;
    const p99Violation = metrics.p99 > this.config.p99ThresholdMs;
    const eventLoopViolation = this.eventLoopLagMs > this.config.eventLoopLagThresholdMs;

    const anyViolation = p95Violation || p99Violation || eventLoopViolation;

    if (anyViolation) {
      const reasons: string[] = [];
      if (p95Violation) reasons.push(`p95_${metrics.p95.toFixed(0)}ms`);
      if (p99Violation) reasons.push(`p99_${metrics.p99.toFixed(0)}ms`);
      if (eventLoopViolation) reasons.push(`event_loop_${this.eventLoopLagMs.toFixed(0)}ms`);
      
      return this.recordViolation(timestampMs, reasons.join(','));
    }

    // No violation - decrement consecutive count (but not below 0)
    this.consecutiveViolationCount = Math.max(0, this.consecutiveViolationCount - 1);

    return {
      healthy: true,
      severity: 'none',
      p95Violation: false,
      p99Violation: false,
      eventLoopViolation: false,
      consecutiveViolations: this.consecutiveViolationCount,
      shouldSuppressTrades: false,
      shouldTriggerKillSwitch: false,
      reason: 'latency_healthy',
    };
  }

  private recordViolation(timestampMs: number, reason: string): LatencyGuardResult {
    this.consecutiveViolationCount++;
    this.totalViolations++;
    this.lastViolationMs = timestampMs;

    // Determine severity
    let severity: 'warning' | 'critical' = 'warning';
    if (this.consecutiveViolationCount >= this.config.killSwitchAfterViolations) {
      severity = 'critical';
    } else if (this.eventLoopLagMs > this.config.eventLoopLagThresholdMs * 2) {
      severity = 'critical';
    }

    // Check if we should enter cooldown
    const shouldSuppress = this.consecutiveViolationCount >= this.config.consecutiveViolations;
    if (shouldSuppress && this.lastCooldownStartMs === 0) {
      this.lastCooldownStartMs = timestampMs;
    }

    const shouldKillSwitch = this.shouldTriggerKillSwitch(timestampMs);

    return {
      healthy: false,
      severity,
      p95Violation: this.getMetrics().p95 > this.config.p95ThresholdMs,
      p99Violation: this.getMetrics().p99 > this.config.p99ThresholdMs,
      eventLoopViolation: this.eventLoopLagMs > this.config.eventLoopLagThresholdMs,
      consecutiveViolations: this.consecutiveViolationCount,
      shouldSuppressTrades: shouldSuppress,
      shouldTriggerKillSwitch: shouldKillSwitch,
      reason: `latency_violation_${reason}`,
    };
  }

  private isInCooldown(nowMs: number): boolean {
    if (this.lastCooldownStartMs === 0) return false;
    const elapsed = nowMs - this.lastCooldownStartMs;
    if (elapsed >= this.config.cooldownMs) {
      // Cooldown expired
      this.lastCooldownStartMs = 0;
      return false;
    }
    return true;
  }

  private calculateMetrics(values: number[]): LatencyMetrics {
    if (values.length === 0) {
      return {
        p50: 0,
        p75: 0,
        p95: 0,
        p99: 0,
        mean: 0,
        std: 0,
        min: 0,
        max: 0,
        sampleCount: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const variance = sorted.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const std = Math.sqrt(variance);

    return {
      p50: this.percentile(sorted, 0.5),
      p75: this.percentile(sorted, 0.75),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
      mean,
      std,
      min: sorted[0],
      max: sorted[n - 1],
      sampleCount: n,
    };
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }
}

/**
 * Event Loop Lag Monitor - Measures Node.js event loop lag
 */
export class EventLoopMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private lastLagMs = 0;
  private readonly intervalMs: number;
  private readonly onLag: (lagMs: number, timestampMs: number) => void;
  private readonly timeProvider: () => number;

  constructor(
    onLag: (lagMs: number, timestampMs: number) => void,
    intervalMs: number = 1000,
    timeProvider: () => number = () => Date.now()
  ) {
    this.onLag = onLag;
    this.intervalMs = intervalMs;
    this.timeProvider = timeProvider;
  }

  start(): void {
    if (this.intervalId) return;

    let lastCheck = this.timeProvider();
    
    this.intervalId = setInterval(() => {
      const now = this.timeProvider();
      const expected = lastCheck + this.intervalMs;
      const lag = Math.max(0, now - expected);
      lastCheck = now;
      
      this.lastLagMs = lag;
      this.onLag(lag, now);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getLastLagMs(): number {
    return this.lastLagMs;
  }
}

/**
 * Global latency guard singleton
 */
let globalLatencyGuard: LatencyGuard | null = null;

export function getGlobalLatencyGuard(config?: Partial<LatencyGuardConfig>): LatencyGuard {
  if (!globalLatencyGuard) {
    globalLatencyGuard = new LatencyGuard(config);
  }
  return globalLatencyGuard;
}

export function resetGlobalLatencyGuard(): void {
  globalLatencyGuard = null;
}

export default LatencyGuard;
