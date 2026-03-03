/**
 * Health and Readiness Types
 * Production-grade type definitions for trading bot health monitoring
 */

// ============================================================================
// Health Status Types
// ============================================================================

/**
 * Overall health status of the system
 * - HEALTHY: All systems operational
 * - DEGRADED: Some systems impaired but functional
 * - UNHEALTHY: Critical failure, system not operational
 */
export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

/**
 * Readiness status for trading operations
 * - READY: All checks passed, ready to trade
 * - DEGRADED: Some checks failed, trading with limitations
 * - NOT_READY: Critical checks failed, trading disabled
 */
export type ReadinessStatus = 'READY' | 'DEGRADED' | 'NOT_READY';

/**
 * Risk state of the trading system
 */
export type RiskState = 'NORMAL' | 'CAUTION' | 'WARNING' | 'HALTED';

// ============================================================================
// Health Check Interfaces
// ============================================================================

/**
 * Individual health check result
 */
export interface HealthCheck {
  /** Name of the check */
  name: string;
  /** Status of this specific check */
  status: HealthStatus;
  /** Optional message providing details */
  message?: string;
  /** Timestamp when check was performed (ms since epoch) */
  lastChecked: number;
  /** Response time in milliseconds */
  responseTimeMs?: number;
}

/**
 * Complete health report
 */
export interface HealthReport {
  /** Overall system status */
  status: HealthStatus;
  /** Timestamp when report was generated */
  timestamp: number;
  /** System uptime in milliseconds */
  uptime: number;
  /** Application version */
  version: string;
  /** Environment (production, staging, development) */
  environment?: string;
  /** Individual check results */
  checks: HealthCheck[];
}

// ============================================================================
// Readiness Check Interfaces
// ============================================================================

/**
 * Individual readiness check results
 */
export interface ReadinessChecks {
  /** WebSocket connection status */
  ws: boolean;
  /** Risk system status */
  risk: boolean;
  /** Kill switch status */
  killSwitch: boolean;
  /** Memory usage status */
  memory: boolean;
}

/**
 * Detailed readiness check information
 */
export interface ReadinessDetails {
  /** WebSocket connection state */
  wsConnected: boolean;
  /** Current risk state */
  riskState: RiskState;
  /** Kill switch activation state */
  killSwitchActive: boolean;
  /** Memory usage percentage (0-100) */
  memoryUsagePercent: number;
}

/**
 * Complete readiness report for trading operations
 */
export interface ReadinessReport {
  /** Overall readiness status */
  status: ReadinessStatus;
  /** Timestamp when report was generated */
  timestamp: number;
  /** Individual check results (pass/fail) */
  checks: ReadinessChecks;
  /** Detailed information about each check */
  details?: ReadinessDetails;
  /** Optional message explaining status */
  message?: string;
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Configuration for health checks
 */
export interface HealthCheckConfig {
  /** Memory threshold percentage (0-100) */
  memoryThresholdPercent: number;
  /** Maximum acceptable response time for checks (ms) */
  maxCheckResponseTimeMs: number;
  /** Interval between automatic health checks (ms) */
  checkIntervalMs: number;
  /** Whether to enable automatic health monitoring */
  autoCheckEnabled: boolean;
}

/**
 * Configuration for readiness checks
 */
export interface ReadinessCheckConfig {
  /** Memory threshold percentage for readiness (0-100) */
  memoryThresholdPercent: number;
  /** Whether to require WebSocket for readiness */
  requireWebSocket: boolean;
  /** Whether to check kill switch for readiness */
  checkKillSwitch: boolean;
  /** Whether to check risk state for readiness */
  checkRiskState: boolean;
}

// ============================================================================
// Shutdown Handler Interfaces
// ============================================================================

/**
 * Shutdown handler configuration
 */
export interface ShutdownConfig {
  /** Timeout for graceful shutdown (ms) */
  gracefulTimeoutMs: number;
  /** Timeout for forceful shutdown (ms) */
  forcefulTimeoutMs: number;
  /** Whether to drain active connections */
  drainConnections: boolean;
  /** Exit code for successful shutdown */
  successExitCode: number;
  /** Exit code for error shutdown */
  errorExitCode: number;
}

/**
 * Shutdown state tracking
 */
export interface ShutdownState {
  /** Whether shutdown is in progress */
  isShuttingDown: boolean;
  /** Timestamp when shutdown started */
  shutdownStartedAt: number | null;
  /** Reason for shutdown */
  reason: string | null;
  /** Whether connections have been drained */
  connectionsDrained: boolean;
}

// ============================================================================
// Dependency Interfaces
// ============================================================================

/**
 * Interface for WebSocket connection provider
 */
export interface IWebSocketProvider {
  isConnected(): boolean;
  getConnectionTime(): number | null;
  getLastPingTime(): number | null;
}

/**
 * Interface for risk manager
 */
export interface IRiskManager {
  getState(): RiskState;
  isHalted(): boolean;
}

/**
 * Interface for kill switch
 */
export interface IKillSwitch {
  isActive(): boolean;
  getActivationReason(): string | null;
  getActivatedAt(): number | null;
}

/**
 * Dependencies required for health/readiness checks
 */
export interface HealthDependencies {
  webSocketProvider?: IWebSocketProvider;
  riskManager?: IRiskManager;
  killSwitch?: IKillSwitch;
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default health check configuration
 */
export const DEFAULT_HEALTH_CONFIG: HealthCheckConfig = {
  memoryThresholdPercent: 80,
  maxCheckResponseTimeMs: 100,
  checkIntervalMs: 30000,
  autoCheckEnabled: true,
};

/**
 * Default readiness check configuration
 */
export const DEFAULT_READINESS_CONFIG: ReadinessCheckConfig = {
  memoryThresholdPercent: 80,
  requireWebSocket: true,
  checkKillSwitch: true,
  checkRiskState: true,
};

/**
 * Default shutdown configuration
 */
export const DEFAULT_SHUTDOWN_CONFIG: ShutdownConfig = {
  gracefulTimeoutMs: 30000,
  forcefulTimeoutMs: 5000,
  drainConnections: true,
  successExitCode: 0,
  errorExitCode: 1,
};
