/**
 * [FAZ-6] Flash Crash Guard - M5 Mitigation Patch
 * 
 * Detects flash crash conditions:
 * - 1 tick gap >= 2%
 * - Liquidity vacuum (spread > 0.5%)
 * 
 * Actions: KILL_SWITCH or HALTED state trigger
 */

export interface FlashCrashConfig {
  // Gap threshold for flash crash detection (ratio)
  gapThreshold: number;
  // Spread threshold for liquidity vacuum (ratio)
  spreadThreshold: number;
  // Minimum valid trade anchor deviation allowed for orderbook-only checks (ratio)
  maxMidDeviationFromLastPriceRatio: number;
  // Minimum price for valid calculation
  minPrice: number;
  // Consecutive ticks with gap before trigger
  consecutiveGapTicks: number;
  // Consecutive valid vacuum ticks before trigger
  consecutiveVacuumTicks: number;
  // Volume threshold for confirmation (0 = disabled)
  minVolumeForConfirmation: number;
  // Time window for gap detection (ms)
  gapWindowMs: number;
  // Enable automatic kill switch
  enableKillSwitch: boolean;
  // Cooldown after flash crash (ms)
  cooldownMs: number;
}

export interface PriceTick {
  price: number;
  volume: number;
  timestampMs: number;
  bestBid: number;
  bestAsk: number;
}

export interface FlashCrashDetection {
  isFlashCrash: boolean;
  gapDetected: boolean;
  liquidityVacuum: boolean;
  severity: 'none' | 'warning' | 'critical';
  gapPercent: number;
  spreadPercent: number;
  shouldHalt: boolean;
  shouldKillSwitch: boolean;
  reason: string;
}

export interface FlashCrashStatus {
  lastPrice: number;
  priceChange24h: number;
  highestPrice: number;
  lowestPrice: number;
  isMonitoring: boolean;
  flashCrashDetected: boolean;
  liquidityVacuumDetected: boolean;
  consecutiveGapTicks: number;
  consecutiveVacuumTicks: number;
  lastGapMs: number;
  lastVacuumMs: number;
  lastDetectionMs: number;
  totalFlashCrashEvents: number;
  inCooldown: boolean;
}

const DEFAULT_CONFIG: FlashCrashConfig = {
  gapThreshold: 0.02,               // 2% gap
  spreadThreshold: 0.005,           // 0.5% spread
  maxMidDeviationFromLastPriceRatio: 0.03, // Reject books > 3% away from last trade
  minPrice: 0.0001,                 // Minimum valid price
  consecutiveGapTicks: 2,           // 2+ consecutive gaps
  consecutiveVacuumTicks: 3,        // 3+ valid vacuum books
  minVolumeForConfirmation: 0,      // Volume check disabled by default
  gapWindowMs: 1000,                // 1 second window
  enableKillSwitch: true,           // Enable kill switch
  cooldownMs: 60000,                // 1 minute cooldown
};

/**
 * Flash Crash Guard - Detects extreme market conditions
 */
export class FlashCrashGuard {
  private readonly config: FlashCrashConfig;
  private readonly ticks: PriceTick[] = [];
  private readonly symbol: string;
  
  private lastPrice = 0;
  private highestPrice = 0;
  private lowestPrice = Infinity;
  private consecutiveGaps = 0;
  private consecutiveVacuumTicks = 0;
  private lastGapMs = 0;
  private lastVacuumMs = 0;
  private totalEvents = 0;
  private lastTriggerMs = 0;
  private lastDetectionMs = 0;
  private isMonitoring = false;

  constructor(symbol: string, config?: Partial<FlashCrashConfig>) {
    this.symbol = symbol;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a price tick for flash crash detection
   */
  recordTick(tick: PriceTick): FlashCrashDetection {
    // Validate tick
    if (!this.isValidTick(tick)) {
      return this.createNoDetection('invalid_tick');
    }

    // Update price tracking
    this.updatePriceTracking(tick);

    // Add to history
    this.ticks.push(tick);
    this.maintainWindow(tick.timestampMs);

    // Check for flash crash conditions
    return this.detectFlashCrash(tick);
  }

  /**
   * Record order book state for liquidity vacuum detection
   */
  recordOrderbook(
    bestBid: number,
    bestAsk: number,
    timestampMs: number
  ): FlashCrashDetection {
    if (bestBid <= 0 || bestAsk <= 0) {
      this.consecutiveVacuumTicks = 0;
      return this.createNoDetection('invalid_orderbook');
    }

    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPercent = spread / midPrice;
    if (!Number.isFinite(midPrice) || midPrice < this.config.minPrice || spread <= 0 || !Number.isFinite(spreadPercent)) {
      this.consecutiveVacuumTicks = 0;
      return this.createNoDetection('invalid_orderbook');
    }

    if (!(this.lastPrice > 0)) {
      this.consecutiveVacuumTicks = 0;
      return this.createNoDetection('orderbook_waiting_for_trade_anchor');
    }

    const midDeviation = Math.abs(midPrice - this.lastPrice) / this.lastPrice;
    if (midDeviation > this.config.maxMidDeviationFromLastPriceRatio) {
      this.consecutiveVacuumTicks = 0;
      return this.createNoDetection('desynced_orderbook');
    }

    // Check for liquidity vacuum
    const isVacuum = spreadPercent > this.config.spreadThreshold;

    if (isVacuum) {
      this.consecutiveVacuumTicks += 1;
      this.lastVacuumMs = timestampMs;

      if (this.consecutiveVacuumTicks >= this.config.consecutiveVacuumTicks) {
        this.totalEvents += 1;
        this.lastTriggerMs = timestampMs;
        this.lastDetectionMs = timestampMs;
        const severity = spreadPercent >= this.config.spreadThreshold * 2 ? 'critical' : 'warning';
        const shouldKillSwitch = this.config.enableKillSwitch
          && (severity === 'critical' || this.consecutiveVacuumTicks > this.config.consecutiveVacuumTicks);

        return {
          isFlashCrash: true,
          gapDetected: false,
          liquidityVacuum: true,
          severity,
          gapPercent: 0,
          spreadPercent: spreadPercent * 100,
          shouldHalt: true,
          shouldKillSwitch,
          reason: `liquidity_vacuum_spread_${(spreadPercent * 100).toFixed(2)}pct_consecutive_${this.consecutiveVacuumTicks}`,
        };
      }

      return {
        isFlashCrash: false,
        gapDetected: false,
        liquidityVacuum: true,
        severity: 'warning',
        gapPercent: 0,
        spreadPercent: spreadPercent * 100,
        shouldHalt: false,
        shouldKillSwitch: false,
        reason: `liquidity_vacuum_monitoring_spread_${(spreadPercent * 100).toFixed(2)}pct_consecutive_${this.consecutiveVacuumTicks}`,
      };
    }

    this.consecutiveVacuumTicks = 0;
    return this.createNoDetection('normal_conditions');
  }

  /**
   * Check if trading should be halted
   */
  shouldHalt(nowMs: number): boolean {
    // Halt if in cooldown after flash crash
    if (this.isInCooldown(nowMs)) return true;
    
    // Halt if flash crash conditions detected recently
    if (this.consecutiveGaps >= this.config.consecutiveGapTicks) return true;
    if (this.consecutiveVacuumTicks >= this.config.consecutiveVacuumTicks) return true;

    return false;
  }

  /**
   * Check if kill switch should be triggered
   */
  shouldTriggerKillSwitch(nowMs: number): boolean {
    if (!this.config.enableKillSwitch) return false;
    
    // Trigger if severe flash crash detected
    if (this.consecutiveGaps >= this.config.consecutiveGapTicks * 2) return true;
    if (this.consecutiveVacuumTicks > this.config.consecutiveVacuumTicks) return true;

    // Trigger if recent gap was extreme (> 2x threshold)
    if (nowMs - this.lastGapMs < this.config.gapWindowMs) {
      const recentTicks = this.getRecentTicks(nowMs);
      for (const tick of recentTicks) {
        const gap = this.calculateGap(tick);
        if (gap > this.config.gapThreshold * 2) return true;
      }
    }

    if (nowMs - this.lastVacuumMs < this.config.gapWindowMs && this.consecutiveVacuumTicks > this.config.consecutiveVacuumTicks) {
      return true;
    }

    return false;
  }

  /**
   * Get current guard status
   */
  getStatus(nowMs: number): FlashCrashStatus {
    return {
      lastPrice: this.lastPrice,
      priceChange24h: this.calculatePriceChange24h(),
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice === Infinity ? 0 : this.lowestPrice,
      isMonitoring: this.isMonitoring,
      flashCrashDetected: this.consecutiveGaps >= this.config.consecutiveGapTicks
        || this.consecutiveVacuumTicks >= this.config.consecutiveVacuumTicks,
      liquidityVacuumDetected: this.consecutiveVacuumTicks >= this.config.consecutiveVacuumTicks,
      consecutiveGapTicks: this.consecutiveGaps,
      consecutiveVacuumTicks: this.consecutiveVacuumTicks,
      lastGapMs: this.lastGapMs,
      lastVacuumMs: this.lastVacuumMs,
      lastDetectionMs: this.lastDetectionMs,
      totalFlashCrashEvents: this.totalEvents,
      inCooldown: this.isInCooldown(nowMs),
    };
  }

  /**
   * Start monitoring
   */
  start(): void {
    this.isMonitoring = true;
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.isMonitoring = false;
  }

  /**
   * Reset guard state
   */
  reset(): void {
    this.ticks.length = 0;
    this.lastPrice = 0;
    this.highestPrice = 0;
    this.lowestPrice = Infinity;
    this.consecutiveGaps = 0;
    this.consecutiveVacuumTicks = 0;
    this.lastGapMs = 0;
    this.lastVacuumMs = 0;
    this.totalEvents = 0;
    this.lastTriggerMs = 0;
    this.lastDetectionMs = 0;
    this.isMonitoring = false;
  }

  /**
   * Force flash crash detection (for testing/emergency)
   */
  forceFlashCrash(timestampMs: number): FlashCrashDetection {
    this.lastTriggerMs = timestampMs;
    this.lastDetectionMs = timestampMs;
    this.totalEvents++;
    this.consecutiveGaps = this.config.consecutiveGapTicks;

    return {
      isFlashCrash: true,
      gapDetected: true,
      liquidityVacuum: false,
      severity: 'critical',
      gapPercent: 0,
      spreadPercent: 0,
      shouldHalt: true,
      shouldKillSwitch: this.config.enableKillSwitch,
      reason: 'forced_flash_crash',
    };
  }

  private isValidTick(tick: PriceTick): boolean {
    return (
      Number.isFinite(tick.price) &&
      tick.price >= this.config.minPrice &&
      Number.isFinite(tick.timestampMs) &&
      tick.timestampMs > 0
    );
  }

  private updatePriceTracking(tick: PriceTick): void {
    this.lastPrice = tick.price;
    this.highestPrice = Math.max(this.highestPrice, tick.price);
    this.lowestPrice = Math.min(this.lowestPrice, tick.price);
  }

  private maintainWindow(nowMs: number): void {
    const cutoff = nowMs - this.config.gapWindowMs;
    while (this.ticks.length > 0 && this.ticks[0].timestampMs < cutoff) {
      this.ticks.shift();
    }

    // Reset consecutive gaps if window is empty
    if (this.ticks.length === 0) {
      this.consecutiveGaps = 0;
    }
    if (nowMs - this.lastVacuumMs > this.config.gapWindowMs) {
      this.consecutiveVacuumTicks = 0;
    }
  }

  private detectFlashCrash(tick: PriceTick): FlashCrashDetection {
    // Need at least 2 ticks to detect gap
    if (this.ticks.length < 2) {
      return this.createNoDetection('insufficient_data');
    }

    const gap = this.calculateGap(tick);
    const gapPercent = gap * 100;

    // Check for gap
    if (gap >= this.config.gapThreshold) {
      this.consecutiveGaps++;
      this.lastGapMs = tick.timestampMs;

      // Check if volume confirms (if enabled)
      const volumeConfirmed = this.config.minVolumeForConfirmation === 0 ||
        tick.volume >= this.config.minVolumeForConfirmation;

      if (this.consecutiveGaps >= this.config.consecutiveGapTicks && volumeConfirmed) {
        this.totalEvents++;
        this.lastTriggerMs = tick.timestampMs;
        this.lastDetectionMs = tick.timestampMs;

        const severity = gap >= this.config.gapThreshold * 2 ? 'critical' : 'warning';
        const shouldKillSwitch = this.config.enableKillSwitch && 
          (severity === 'critical' || this.consecutiveGaps >= this.config.consecutiveGapTicks * 2);

        return {
          isFlashCrash: true,
          gapDetected: true,
          liquidityVacuum: false,
          severity,
          gapPercent,
          spreadPercent: 0,
          shouldHalt: true,
          shouldKillSwitch,
          reason: `price_gap_${gapPercent.toFixed(2)}pct_consecutive_${this.consecutiveGaps}`,
        };
      }

      // Gap detected but not yet at threshold
      return {
        isFlashCrash: false,
        gapDetected: true,
        liquidityVacuum: false,
        severity: 'warning',
        gapPercent,
        spreadPercent: 0,
        shouldHalt: false,
        shouldKillSwitch: false,
        reason: `gap_detected_${gapPercent.toFixed(2)}pct_monitoring`,
      };
    }

    // No gap - reset consecutive counter
    this.consecutiveGaps = 0;

    return this.createNoDetection('normal_price_movement');
  }

  private calculateGap(tick: PriceTick): number {
    if (this.ticks.length < 2) return 0;

    const previousTick = this.ticks[this.ticks.length - 2];
    const priceChange = Math.abs(tick.price - previousTick.price);
    return priceChange / previousTick.price;
  }

  private getRecentTicks(nowMs: number): PriceTick[] {
    const cutoff = nowMs - this.config.gapWindowMs;
    return this.ticks.filter(t => t.timestampMs >= cutoff);
  }

  private calculatePriceChange24h(): number {
    // Simplified - would need 24h of data for accurate calculation
    if (this.ticks.length < 2) return 0;
    const first = this.ticks[0].price;
    const last = this.ticks[this.ticks.length - 1].price;
    return ((last - first) / first) * 100;
  }

  private isInCooldown(nowMs: number): boolean {
    if (this.lastTriggerMs === 0) return false;
    return (nowMs - this.lastTriggerMs) < this.config.cooldownMs;
  }

  getLastDetectionTime(): number | null {
    return this.lastDetectionMs > 0 ? this.lastDetectionMs : null;
  }

  private createNoDetection(reason: string): FlashCrashDetection {
    return {
      isFlashCrash: false,
      gapDetected: false,
      liquidityVacuum: false,
      severity: 'none',
      gapPercent: 0,
      spreadPercent: 0,
      shouldHalt: false,
      shouldKillSwitch: false,
      reason,
    };
  }
}

/**
 * Multi-symbol flash crash guard registry
 */
export class FlashCrashGuardRegistry {
  private readonly guards: Map<string, FlashCrashGuard> = new Map();
  private readonly defaultConfig?: Partial<FlashCrashConfig>;

  constructor(defaultConfig?: Partial<FlashCrashConfig>) {
    this.defaultConfig = defaultConfig;
  }

  getGuard(symbol: string): FlashCrashGuard {
    const normalized = symbol.toUpperCase();
    let guard = this.guards.get(normalized);
    if (!guard) {
      guard = new FlashCrashGuard(normalized, this.defaultConfig);
      this.guards.set(normalized, guard);
    }
    return guard;
  }

  removeGuard(symbol: string): void {
    this.guards.delete(symbol.toUpperCase());
  }

  startAll(): void {
    for (const guard of this.guards.values()) {
      guard.start();
    }
  }

  stopAll(): void {
    for (const guard of this.guards.values()) {
      guard.stop();
    }
  }

  resetAll(): void {
    for (const guard of this.guards.values()) {
      guard.reset();
    }
  }

  getAllStatus(nowMs: number): Record<string, FlashCrashStatus> {
    const status: Record<string, FlashCrashStatus> = {};
    for (const [symbol, guard] of this.guards.entries()) {
      status[symbol] = guard.getStatus(nowMs);
    }
    return status;
  }

  /**
   * Check if any symbol should halt trading
   */
  anyShouldHalt(nowMs: number): boolean {
    for (const guard of this.guards.values()) {
      if (guard.shouldHalt(nowMs)) return true;
    }
    return false;
  }

  /**
   * Check if any symbol should trigger kill switch
   */
  anyShouldKillSwitch(nowMs: number): boolean {
    for (const guard of this.guards.values()) {
      if (guard.shouldTriggerKillSwitch(nowMs)) return true;
    }
    return false;
  }

  /**
   * Get symbols that should halt
   */
  getHaltSymbols(nowMs: number): string[] {
    const symbols: string[] = [];
    for (const [symbol, guard] of this.guards.entries()) {
      if (guard.shouldHalt(nowMs)) {
        symbols.push(symbol);
      }
    }
    return symbols;
  }

  getDetectionCount(): number {
    let total = 0;
    for (const guard of this.guards.values()) {
      total += guard.getStatus(Date.now()).totalFlashCrashEvents;
    }
    return total;
  }

  getLastDetectionTime(): number | null {
    let latest: number | null = null;
    for (const guard of this.guards.values()) {
      const detectedAt = guard.getLastDetectionTime();
      if (detectedAt !== null && (latest === null || detectedAt > latest)) {
        latest = detectedAt;
      }
    }
    return latest;
  }

  isProtectionActive(): boolean {
    const nowMs = Date.now();
    for (const guard of this.guards.values()) {
      if (guard.shouldHalt(nowMs)) {
        return true;
      }
    }
    return false;
  }
}

export default FlashCrashGuard;
