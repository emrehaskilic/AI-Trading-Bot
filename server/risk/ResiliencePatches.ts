/**
 * [FAZ-6] Resilience Patches - Integration Module
 * 
 * Central coordinator for all mitigation patches:
 * - M1: Anti-Spoof Guard (OBI robustness)
 * - M2: Delta Burst Filter
 * - M3: Churn Detector
 * - M4: Latency Guard
 * - M5: Flash Crash Guard
 * 
 * Provides unified interface for adversarial attack mitigation.
 */

import { AntiSpoofGuard, AntiSpoofGuardRegistry, SpoofDetectionConfig } from '../metrics/AntiSpoofGuard';
import { DeltaBurstFilter, DeltaBurstFilterRegistry, DeltaBurstConfig } from '../metrics/DeltaBurstFilter';
import { ChurnDetector, ChurnDetectorRegistry, ChurnDetectionConfig } from '../analytics/ChurnDetector';
import { LatencyGuard, EventLoopMonitor, LatencyGuardConfig } from '../perf/LatencyGuard';
import { FlashCrashGuard, FlashCrashGuardRegistry, FlashCrashConfig } from './FlashCrashGuard';
import { InstitutionalRiskEngine } from './InstitutionalRiskEngine';
import { RiskStateManager, RiskStateTrigger } from './RiskStateManager';

export interface ResiliencePatchesConfig {
  antiSpoof?: Partial<SpoofDetectionConfig>;
  deltaBurst?: Partial<DeltaBurstConfig>;
  churn?: Partial<ChurnDetectionConfig>;
  latency?: Partial<LatencyGuardConfig>;
  flashCrash?: Partial<FlashCrashConfig>;
  onGuardAction?: (event: {
    symbol?: string;
    action: 'ALLOW' | 'SUPPRESS' | 'NO_TRADE' | 'HALT' | 'KILL_SWITCH';
    reason: string;
    timestampMs: number;
    metadata?: Record<string, unknown>;
  }) => void;
  // Global settings
  enableAll: boolean;
  autoKillSwitch: boolean;
  autoHalt: boolean;
}

export interface ResilienceStatus {
  healthy: boolean;
  canTrade: boolean;
  patches: {
    antiSpoof: boolean;
    deltaBurst: boolean;
    churn: boolean;
    latency: boolean;
    flashCrash: boolean;
  };
  suppressions: {
    spoofDownWeightActive: boolean;
    deltaBurstCooldown: boolean;
    churnNoTrade: boolean;
    latencySuppress: boolean;
    flashCrashHalt: boolean;
  };
  confidenceMultiplier: number;
  reasons: string[];
}

export interface ResilienceGuardResult {
  allow: boolean;
  confidenceMultiplier: number;
  action: 'ALLOW' | 'SUPPRESS' | 'NO_TRADE' | 'HALT' | 'KILL_SWITCH';
  reasons: string[];
}

const DEFAULT_CONFIG: ResiliencePatchesConfig = {
  enableAll: true,
  autoKillSwitch: true,
  autoHalt: true,
};

/**
 * Resilience Patches - Central mitigation coordinator
 */
export class ResiliencePatches {
  private readonly config: ResiliencePatchesConfig;
  private readonly onGuardAction?: ResiliencePatchesConfig['onGuardAction'];
  
  // Patch registries
  private antiSpoofRegistry: AntiSpoofGuardRegistry;
  private deltaBurstRegistry: DeltaBurstFilterRegistry;
  private churnRegistry: ChurnDetectorRegistry;
  private flashCrashRegistry: FlashCrashGuardRegistry;
  
  // Global guards
  private latencyGuard: LatencyGuard;
  private eventLoopMonitor: EventLoopMonitor | null = null;
  
  // Risk engine reference
  private riskEngine: InstitutionalRiskEngine | null = null;
  private stateManager: RiskStateManager | null = null;
  
  // Status tracking
  private initialized = false;
  private lastEvaluationMs = 0;

  constructor(config?: Partial<ResiliencePatchesConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onGuardAction = this.config.onGuardAction;
    
    // Initialize registries with config
    this.antiSpoofRegistry = new AntiSpoofGuardRegistry(this.config.antiSpoof);
    this.deltaBurstRegistry = new DeltaBurstFilterRegistry(this.config.deltaBurst);
    this.churnRegistry = new ChurnDetectorRegistry(this.config.churn);
    this.flashCrashRegistry = new FlashCrashGuardRegistry(this.config.flashCrash);
    this.latencyGuard = new LatencyGuard(this.config.latency);
  }

  /**
   * Initialize with risk engine
   */
  initialize(riskEngine: InstitutionalRiskEngine): void {
    this.riskEngine = riskEngine;
    this.stateManager = riskEngine.getStateManager();
    this.initialized = true;
    
    // Start event loop monitoring
    this.startEventLoopMonitor();
    
    console.log('[ResiliencePatches] Initialized with risk engine');
  }

  /**
   * Start event loop monitoring
   */
  startEventLoopMonitor(): void {
    if (this.eventLoopMonitor) return;
    
    this.eventLoopMonitor = new EventLoopMonitor((lagMs, timestampMs) => {
      this.latencyGuard.recordEventLoopLag(lagMs, timestampMs);
      this.checkKillSwitchTriggers(timestampMs);
    });
    
    this.eventLoopMonitor.start();
    console.log('[ResiliencePatches] Event loop monitoring started');
  }

  /**
   * Stop event loop monitoring
   */
  stopEventLoopMonitor(): void {
    if (this.eventLoopMonitor) {
      this.eventLoopMonitor.stop();
      this.eventLoopMonitor = null;
    }
  }

  /**
   * Record order activity for anti-spoof detection
   */
  recordOrderActivity(
    symbol: string,
    price: number,
    side: 'bid' | 'ask',
    size: number,
    type: 'add' | 'cancel' | 'modify',
    timestampMs: number
  ): void {
    if (!this.config.enableAll) return;
    
    const guard = this.antiSpoofRegistry.getGuard(symbol);
    guard.recordActivity({ price, side, size, timestampMs, type });
  }

  /**
   * Record delta for burst detection
   */
  recordDelta(
    symbol: string,
    delta: number,
    price: number,
    timestampMs: number
  ): void {
    if (!this.config.enableAll) return;
    
    const filter = this.deltaBurstRegistry.getFilter(symbol);
    const result = filter.recordDelta(delta, price, timestampMs);
    
    // Check if burst requires action
    if (result.isBurst && result.severity === 'high') {
      console.warn(`[ResiliencePatches] High severity delta burst detected on ${symbol}`);
    }
  }

  /**
   * Record side flip for churn detection
   */
  recordSideFlip(
    symbol: string,
    newSide: 'BUY' | 'SELL',
    price: number,
    timestampMs: number
  ): void {
    if (!this.config.enableAll) return;
    
    const detector = this.churnRegistry.getDetector(symbol);
    detector.recordFlip(newSide, price, timestampMs);
  }

  /**
   * Record chop score for churn detection
   */
  recordChopScore(symbol: string, chopScore: number, timestampMs: number): void {
    if (!this.config.enableAll) return;
    
    const detector = this.churnRegistry.getDetector(symbol);
    detector.recordChopScore(chopScore, timestampMs);
  }

  /**
   * Record latency sample
   */
  recordLatency(latencyMs: number, timestampMs: number, type?: 'network' | 'processing'): void {
    if (!this.config.enableAll) return;
    
    const result = this.latencyGuard.recordLatency(latencyMs, timestampMs, type);
    
    if (result.shouldTriggerKillSwitch && this.config.autoKillSwitch) {
      this.emitGuardAction(undefined, 'KILL_SWITCH', `latency_violation_${result.reason}`, timestampMs, { type, latencyMs });
      this.triggerKillSwitch(RiskStateTrigger.LATENCY_SPIKE, `Latency violation: ${result.reason}`, timestampMs);
    }
  }

  /**
   * Record price tick for flash crash detection
   */
  recordPriceTick(
    symbol: string,
    price: number,
    volume: number,
    bestBid: number,
    bestAsk: number,
    timestampMs: number
  ): void {
    if (!this.config.enableAll) return;
    
    const guard = this.flashCrashRegistry.getGuard(symbol);
    const result = guard.recordTick({ price, volume, timestampMs, bestBid, bestAsk });
    
    if (result.shouldKillSwitch) {
      this.emitGuardAction(symbol, 'KILL_SWITCH', result.reason, timestampMs, {
        price,
        volume,
        bestBid,
        bestAsk,
        gapPercent: result.gapPercent,
      });
      this.triggerKillSwitch(RiskStateTrigger.VOLATILITY_SPIKE, `Flash crash on ${symbol}: ${result.reason}`, timestampMs);
    }
  }

  /**
   * Record order book for liquidity vacuum detection
   */
  recordOrderbook(
    symbol: string,
    bestBid: number,
    bestAsk: number,
    timestampMs: number
  ): void {
    if (!this.config.enableAll) return;
    
    const guard = this.flashCrashRegistry.getGuard(symbol);
    const result = guard.recordOrderbook(bestBid, bestAsk, timestampMs);
    
    if (result.shouldKillSwitch) {
      this.emitGuardAction(symbol, 'KILL_SWITCH', result.reason, timestampMs, {
        bestBid,
        bestAsk,
        spreadPercent: result.spreadPercent,
      });
      this.triggerKillSwitch(RiskStateTrigger.VOLATILITY_SPIKE, `Liquidity vacuum on ${symbol}: ${result.reason}`, timestampMs);
    }
  }

  /**
   * Get OBI with spoof-aware weighting
   */
  getOBI(
    symbol: string,
    bids: Map<number, number> | [number, number][],
    asks: Map<number, number> | [number, number][],
    depth: number,
    timestampMs: number
  ): { obi: number; obiWeighted: number; spoofAdjusted: boolean } {
    const guard = this.antiSpoofRegistry.getGuard(symbol);
    return guard.calculateOBI(bids, asks, depth, timestampMs);
  }

  /**
   * Evaluate all patches and return trading decision
   */
  evaluate(symbol: string, timestampMs: number): ResilienceGuardResult {
    this.lastEvaluationMs = timestampMs;
    
    const reasons: string[] = [];
    let confidenceMultiplier = 1.0;
    let action: 'ALLOW' | 'SUPPRESS' | 'NO_TRADE' | 'HALT' | 'KILL_SWITCH' = 'ALLOW';

    if (!this.config.enableAll) {
      return { allow: true, confidenceMultiplier: 1.0, action: 'ALLOW', reasons: [] };
    }

    // Check latency guard (global)
    if (this.latencyGuard.shouldSuppressTrades(timestampMs)) {
      reasons.push('latency_suppress');
      confidenceMultiplier *= 0.5;
      action = 'SUPPRESS';
    }

    // Check flash crash guard
    const flashCrashGuard = this.flashCrashRegistry.getGuard(symbol);
    if (flashCrashGuard.shouldHalt(timestampMs)) {
      reasons.push('flash_crash_halt');
      action = 'HALT';
      confidenceMultiplier = 0;
      if (this.config.autoHalt && this.stateManager) {
        this.stateManager.transition(
          RiskStateTrigger.EXECUTION_TIMEOUT,
          `ResiliencePatches flash-crash halt on ${symbol}`,
          { symbol, timestampMs }
        );
      }
    }
    if (flashCrashGuard.shouldTriggerKillSwitch(timestampMs)) {
      this.triggerKillSwitch(
        RiskStateTrigger.VOLATILITY_SPIKE,
        `Flash crash halt for ${symbol}`,
        timestampMs
      );
      action = 'KILL_SWITCH';
      confidenceMultiplier = 0;
    }

    // Check delta burst filter
    const deltaFilter = this.deltaBurstRegistry.getFilter(symbol);
    if (deltaFilter.shouldSuppressSignal(timestampMs)) {
      reasons.push('delta_burst_cooldown');
      confidenceMultiplier *= deltaFilter.getConfidenceMultiplier(timestampMs);
      action = action === 'ALLOW' ? 'SUPPRESS' : action;
    }

    // Check churn detector
    const churnDetector = this.churnRegistry.getDetector(symbol);
    const churnResult = churnDetector.detectChurn(timestampMs);
    if (churnResult.action === 'NO_TRADE') {
      reasons.push('churn_no_trade');
      action = 'NO_TRADE';
      confidenceMultiplier = 0;
    } else if (churnResult.action === 'CAP_CONFIDENCE') {
      reasons.push('churn_cap_confidence');
      confidenceMultiplier *= churnResult.confidenceCap;
      action = action === 'ALLOW' ? 'SUPPRESS' : action;
    }

    // Check anti-spoof (affects OBI weighting, not direct trading)
    const antiSpoofStatus = this.antiSpoofRegistry.getGuard(symbol).getStatus(timestampMs);
    if (antiSpoofStatus.spoofSuspectedLevels > 0) {
      reasons.push(`spoof_downweight_${antiSpoofStatus.spoofSuspectedLevels}_levels`);
    }

    // Determine final allow decision
    const allow = action === 'ALLOW' || action === 'SUPPRESS';

    return {
      allow,
      confidenceMultiplier: Math.max(0, Math.min(1, confidenceMultiplier)),
      action,
      reasons,
    };
  }

  /**
   * Get comprehensive status
   */
  getStatus(timestampMs: number): ResilienceStatus {
    const reasons: string[] = [];
    
    // Check each patch
    const antiSpoofStatus = this.getAggregatedAntiSpoofStatus(timestampMs);
    const deltaBurstStatus = this.deltaBurstRegistry.anyInCooldown(timestampMs);
    const churnStatus = this.churnRegistry.anyChurning(timestampMs);
    const latencyStatus = this.latencyGuard.getStatus(timestampMs);
    const flashCrashStatus = this.flashCrashRegistry.anyShouldHalt(timestampMs);

    // Build suppressions
    const suppressions = {
      spoofDownWeightActive: antiSpoofStatus.spoofSuspectedLevels > 0,
      deltaBurstCooldown: deltaBurstStatus,
      churnNoTrade: churnStatus,
      latencySuppress: latencyStatus.tradesSuppressed,
      flashCrashHalt: flashCrashStatus,
    };

    // Determine overall health
    const healthy = !latencyStatus.inCooldown && !flashCrashStatus;
    const canTrade = !latencyStatus.tradesSuppressed && !flashCrashStatus && !churnStatus;

    // Collect reasons
    if (suppressions.spoofDownWeightActive) reasons.push('spoof_downweight_active');
    if (suppressions.deltaBurstCooldown) reasons.push('delta_burst_cooldown');
    if (suppressions.churnNoTrade) reasons.push('churn_no_trade');
    if (suppressions.latencySuppress) reasons.push('latency_suppress');
    if (suppressions.flashCrashHalt) reasons.push('flash_crash_halt');

    // Calculate confidence multiplier
    let confidenceMultiplier = 1.0;
    if (deltaBurstStatus) confidenceMultiplier *= this.deltaBurstRegistry.getMinConfidenceMultiplier(timestampMs);
    if (churnStatus) confidenceMultiplier *= this.churnRegistry.getMinConfidenceMultiplier(timestampMs);
    if (latencyStatus.tradesSuppressed) confidenceMultiplier *= 0.5;
    if (flashCrashStatus) confidenceMultiplier = 0;

    return {
      healthy,
      canTrade,
      patches: {
        antiSpoof: true,
        deltaBurst: true,
        churn: true,
        latency: true,
        flashCrash: true,
      },
      suppressions,
      confidenceMultiplier: Math.max(0, Math.min(1, confidenceMultiplier)),
      reasons,
    };
  }

  /**
   * Cleanup old data
   */
  cleanup(timestampMs: number): void {
    this.antiSpoofRegistry.cleanupAll(timestampMs);
    this.lastEvaluationMs = timestampMs;
  }

  /**
   * Reset all patches
   */
  reset(): void {
    this.antiSpoofRegistry.resetAll();
    this.deltaBurstRegistry.resetAll();
    this.churnRegistry.resetAll();
    this.flashCrashRegistry.resetAll();
    this.latencyGuard.reset();
    this.lastEvaluationMs = 0;
  }

  /**
   * Stop all monitoring
   */
  stop(): void {
    this.stopEventLoopMonitor();
    this.flashCrashRegistry.stopAll();
  }

  getAntiSpoofGuards(): Map<string, AntiSpoofGuard> {
    return this.antiSpoofRegistry.getGuardMap();
  }

  getDeltaBurstFilters(): Map<string, DeltaBurstFilter> {
    return this.deltaBurstRegistry.getFilterMap();
  }

  getFlashCrashDetector(): {
    getDetectionCount: () => number;
    getLastDetectionTime: () => number | null;
    isProtectionActive: () => boolean;
  } {
    return {
      getDetectionCount: () => this.flashCrashRegistry.getDetectionCount(),
      getLastDetectionTime: () => this.flashCrashRegistry.getLastDetectionTime(),
      isProtectionActive: () => this.flashCrashRegistry.isProtectionActive(),
    };
  }

  // Private helpers

  private checkKillSwitchTriggers(timestampMs: number): void {
    if (!this.config.autoKillSwitch) return;

    // Check latency
    if (this.latencyGuard.shouldTriggerKillSwitch(timestampMs)) {
      this.triggerKillSwitch(RiskStateTrigger.LATENCY_SPIKE, 'Critical latency detected', timestampMs);
      return;
    }

    // Check flash crash
    if (this.flashCrashRegistry.anyShouldKillSwitch(timestampMs)) {
      this.triggerKillSwitch(RiskStateTrigger.VOLATILITY_SPIKE, 'Flash crash detected on monitored symbols', timestampMs);
      return;
    }
  }

  private triggerKillSwitch(
    trigger: RiskStateTrigger,
    reason: string,
    timestampMs: number
  ): void {
    console.error(`[ResiliencePatches] KILL SWITCH TRIGGERED: ${trigger} - ${reason}`);
    
    if (this.riskEngine) {
      this.riskEngine.activateKillSwitch(`[ResiliencePatches] ${reason}`);
    } else if (this.stateManager) {
      this.stateManager.transition(trigger, reason, { timestamp: timestampMs });
    }
  }

  private emitGuardAction(
    symbol: string | undefined,
    action: 'ALLOW' | 'SUPPRESS' | 'NO_TRADE' | 'HALT' | 'KILL_SWITCH',
    reason: string,
    timestampMs: number,
    metadata?: Record<string, unknown>
  ): void {
    this.onGuardAction?.({
      symbol,
      action,
      reason,
      timestampMs,
      metadata,
    });
  }

  private getAggregatedAntiSpoofStatus(timestampMs: number): { 
    totalLevels: number; 
    spoofSuspectedLevels: number; 
  } {
    const allStatus = this.antiSpoofRegistry.getAllStatus(timestampMs);
    let totalLevels = 0;
    let spoofSuspectedLevels = 0;

    for (const status of Object.values(allStatus)) {
      totalLevels += status.totalLevelsTracked;
      spoofSuspectedLevels += status.spoofSuspectedLevels;
    }

    return { totalLevels, spoofSuspectedLevels };
  }
}

// Export all patch components
export * from '../metrics/AntiSpoofGuard';
export * from '../metrics/DeltaBurstFilter';
export * from '../analytics/ChurnDetector';
export * from '../perf/LatencyGuard';
export * from './FlashCrashGuard';

export default ResiliencePatches;
