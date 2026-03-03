/**
 * ReadinessChecker
 * Comprehensive readiness checks for trading bot operations
 * 
 * Checks:
 * - WebSocket connection active
 * - Risk state NOT HALTED
 * - Kill switch NOT active
 * - Memory usage below threshold
 */

import {
  HealthStatus,
  ReadinessStatus,
  ReadinessReport,
  ReadinessChecks,
  ReadinessDetails,
  RiskState,
  HealthDependencies,
  ReadinessCheckConfig,
  DEFAULT_READINESS_CONFIG,
} from './types';

// ============================================================================
// ReadinessChecker Class
// ============================================================================

export class ReadinessChecker {
  private dependencies: HealthDependencies;
  private config: ReadinessCheckConfig;
  private lastCheckTime: number = 0;
  private cachedReport: ReadinessReport | null = null;

  /**
   * Create a new ReadinessChecker
   * @param dependencies - Required dependencies for checks
   * @param config - Configuration for readiness checks
   */
  constructor(
    dependencies: HealthDependencies = {},
    config: Partial<ReadinessCheckConfig> = {}
  ) {
    this.dependencies = dependencies;
    this.config = { ...DEFAULT_READINESS_CONFIG, ...config };
  }

  // ============================================================================
  // Individual Check Methods
  // ============================================================================

  /**
   * Check if WebSocket connection is active
   * @returns true if connected or not required
   */
  public checkWebSocket(): boolean {
    if (!this.config.requireWebSocket) {
      return true;
    }

    if (!this.dependencies.webSocketProvider) {
      // No provider configured, assume not ready if required
      return false;
    }

    return this.dependencies.webSocketProvider.isConnected();
  }

  /**
   * Get WebSocket connection details
   * @returns Object with connection status and timing info
   */
  public getWebSocketDetails(): {
    connected: boolean;
    connectionTime: number | null;
    lastPingTime: number | null;
  } {
    if (!this.dependencies.webSocketProvider) {
      return {
        connected: false,
        connectionTime: null,
        lastPingTime: null,
      };
    }

    return {
      connected: this.dependencies.webSocketProvider.isConnected(),
      connectionTime: this.dependencies.webSocketProvider.getConnectionTime(),
      lastPingTime: this.dependencies.webSocketProvider.getLastPingTime(),
    };
  }

  /**
   * Check if risk state is acceptable for trading
   * @returns true if risk state is NOT HALTED
   */
  public checkRiskState(): boolean {
    if (!this.config.checkRiskState) {
      return true;
    }

    if (!this.dependencies.riskManager) {
      // No risk manager configured, assume ready if not checking
      return true;
    }

    return !this.dependencies.riskManager.isHalted();
  }

  /**
   * Get current risk state
   * @returns Current risk state or NORMAL if no risk manager
   */
  public getRiskState(): RiskState {
    if (!this.dependencies.riskManager) {
      return 'NORMAL';
    }

    return this.dependencies.riskManager.getState();
  }

  /**
   * Check if kill switch is NOT active
   * @returns true if kill switch is inactive
   */
  public checkKillSwitch(): boolean {
    if (!this.config.checkKillSwitch) {
      return true;
    }

    if (!this.dependencies.killSwitch) {
      // No kill switch configured, assume ready if not checking
      return true;
    }

    return !this.dependencies.killSwitch.isActive();
  }

  /**
   * Get kill switch details
   * @returns Object with kill switch status and activation info
   */
  public getKillSwitchDetails(): {
    active: boolean;
    reason: string | null;
    activatedAt: number | null;
  } {
    if (!this.dependencies.killSwitch) {
      return {
        active: false,
        reason: null,
        activatedAt: null,
      };
    }

    return {
      active: this.dependencies.killSwitch.isActive(),
      reason: this.dependencies.killSwitch.getActivationReason(),
      activatedAt: this.dependencies.killSwitch.getActivatedAt(),
    };
  }

  /**
   * Check if memory usage is below threshold
   * @returns true if memory usage is acceptable
   */
  public checkMemory(): boolean {
    const memoryUsage = this.getMemoryUsagePercent();
    return memoryUsage <= this.config.memoryThresholdPercent;
  }

  /**
   * Get current memory usage percentage
   * @returns Memory usage as percentage (0-100)
   */
  public getMemoryUsagePercent(): number {
    if (typeof process === 'undefined' || !process.memoryUsage) {
      return 0;
    }

    const usage = process.memoryUsage();
    
    // Calculate percentage based on heap usage
    // heapTotal is the total size of the allocated heap
    // heapUsed is the actual memory used during execution
    if (usage.heapTotal === 0) {
      return 0;
    }

    const heapPercent = (usage.heapUsed / usage.heapTotal) * 100;
    
    // Also consider RSS ( Resident Set Size ) for overall memory pressure
    // Use a reasonable max RSS estimate (4GB) if not available
    const maxRss = 4 * 1024 * 1024 * 1024; // 4GB
    const rssPercent = (usage.rss / maxRss) * 100;

    // Return the higher of heap or RSS percentage
    return Math.max(heapPercent, rssPercent);
  }

  /**
   * Get detailed memory statistics
   * @returns Object with memory usage details
   */
  public getMemoryDetails(): {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    percent: number;
  } {
    if (typeof process === 'undefined' || !process.memoryUsage) {
      return {
        heapUsed: 0,
        heapTotal: 0,
        rss: 0,
        external: 0,
        percent: 0,
      };
    }

    const usage = process.memoryUsage();
    const percent = this.getMemoryUsagePercent();

    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external || 0,
      percent,
    };
  }

  // ============================================================================
  // Comprehensive Report Generation
  // ============================================================================

  /**
   * Get the current readiness report
   * Performs all checks and returns comprehensive report
   * @param useCache - Whether to use cached result if available
   * @returns Complete readiness report
   */
  public getReadinessReport(useCache: boolean = false): ReadinessReport {
    const now = Date.now();

    // Use cached report if recent (within 1 second) and requested
    if (useCache && this.cachedReport && (now - this.lastCheckTime) < 1000) {
      return this.cachedReport;
    }

    // Perform all checks
    const wsCheck = this.checkWebSocket();
    const riskCheck = this.checkRiskState();
    const killSwitchCheck = this.checkKillSwitch();
    const memoryCheck = this.checkMemory();

    // Build checks object
    const checks: ReadinessChecks = {
      ws: wsCheck,
      risk: riskCheck,
      killSwitch: killSwitchCheck,
      memory: memoryCheck,
    };

    // Build details object
    const wsDetails = this.getWebSocketDetails();
    const killSwitchDetails = this.getKillSwitchDetails();
    const memoryDetails = this.getMemoryDetails();

    const details: ReadinessDetails = {
      wsConnected: wsDetails.connected,
      riskState: this.getRiskState(),
      killSwitchActive: killSwitchDetails.active,
      memoryUsagePercent: memoryDetails.percent,
    };

    // Determine overall status
    const status = this.calculateReadinessStatus(checks);

    // Generate message based on status
    const message = this.generateStatusMessage(status, checks, details);

    // Build and cache report
    const report: ReadinessReport = {
      status,
      timestamp: now,
      checks,
      details,
      message,
    };

    this.cachedReport = report;
    this.lastCheckTime = now;

    return report;
  }

  /**
   * Calculate overall readiness status from individual checks
   * @param checks - Individual check results
   * @returns Overall readiness status
   */
  private calculateReadinessStatus(checks: ReadinessChecks): ReadinessStatus {
    const allPassed = checks.ws && checks.risk && checks.killSwitch && checks.memory;
    const allFailed = !checks.ws && !checks.risk && !checks.killSwitch && !checks.memory;

    if (allPassed) {
      return 'READY';
    }

    if (allFailed) {
      return 'NOT_READY';
    }

    // Some passed, some failed - DEGRADED
    return 'DEGRADED';
  }

  /**
   * Generate a human-readable status message
   * @param status - Overall readiness status
   * @param checks - Individual check results
   * @param details - Detailed check information
   * @returns Status message
   */
  private generateStatusMessage(
    status: ReadinessStatus,
    checks: ReadinessChecks,
    details: ReadinessDetails
  ): string {
    if (status === 'READY') {
      return 'System is ready for trading operations';
    }

    const failures: string[] = [];

    if (!checks.ws) {
      failures.push('WebSocket disconnected');
    }

    if (!checks.risk) {
      failures.push(`Risk state is ${details.riskState}`);
    }

    if (!checks.killSwitch) {
      failures.push('Kill switch is active');
    }

    if (!checks.memory) {
      failures.push(`Memory usage at ${details.memoryUsagePercent.toFixed(1)}%`);
    }

    if (status === 'NOT_READY') {
      return `System not ready: ${failures.join(', ')}`;
    }

    return `System degraded: ${failures.join(', ')}`;
  }

  // ============================================================================
  // Quick Check Methods
  // ============================================================================

  /**
   * Quick check if system is ready for trading
   * @returns true if all critical checks pass
   */
  public isReady(): boolean {
    const report = this.getReadinessReport(true);
    return report.status === 'READY';
  }

  /**
   * Check if trading should be allowed
   * Trading is allowed if status is READY or DEGRADED (with caution)
   * @returns true if trading can proceed
   */
  public canTrade(): boolean {
    const report = this.getReadinessReport(true);
    return report.status === 'READY' || report.status === 'DEGRADED';
  }

  /**
   * Get list of failed checks
   * @returns Array of failed check names
   */
  public getFailedChecks(): string[] {
    const report = this.getReadinessReport(true);
    const failed: string[] = [];

    if (!report.checks.ws) failed.push('websocket');
    if (!report.checks.risk) failed.push('risk');
    if (!report.checks.killSwitch) failed.push('killSwitch');
    if (!report.checks.memory) failed.push('memory');

    return failed;
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Update configuration
   * @param config - Partial configuration to update
   */
  public updateConfig(config: Partial<ReadinessCheckConfig>): void {
    this.config = { ...this.config, ...config };
    // Clear cache to ensure new config is applied
    this.cachedReport = null;
  }

  /**
   * Get current configuration
   * @returns Current configuration
   */
  public getConfig(): ReadinessCheckConfig {
    return { ...this.config };
  }

  /**
   * Update dependencies
   * @param dependencies - Dependencies to update
   */
  public updateDependencies(dependencies: Partial<HealthDependencies>): void {
    this.dependencies = { ...this.dependencies, ...dependencies };
    // Clear cache to ensure new dependencies are used
    this.cachedReport = null;
  }

  /**
   * Clear the cached report
   */
  public clearCache(): void {
    this.cachedReport = null;
    this.lastCheckTime = 0;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultChecker: ReadinessChecker | null = null;

/**
 * Get or create the default ReadinessChecker instance
 * @returns Default ReadinessChecker instance
 */
export function getDefaultReadinessChecker(): ReadinessChecker {
  if (!defaultChecker) {
    defaultChecker = new ReadinessChecker();
  }
  return defaultChecker;
}

/**
 * Set the default ReadinessChecker instance
 * @param checker - ReadinessChecker to use as default
 */
export function setDefaultReadinessChecker(checker: ReadinessChecker): void {
  defaultChecker = checker;
}

/**
 * Reset the default ReadinessChecker instance
 */
export function resetDefaultReadinessChecker(): void {
  defaultChecker = null;
}
