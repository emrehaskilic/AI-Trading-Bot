/**
 * API Routes Module
 * 
 * Exports all dashboard API routes for the trading bot UI.
 * All endpoints are read-only and have no side effects.
 */

// Export telemetry routes
export {
  createTelemetryRoutes,
  TelemetrySnapshotResponse,
  TelemetryRoutesOptions,
} from './telemetry';

// Export strategy routes
export {
  createStrategyRoutes,
  StrategySnapshotResponse,
  StrategyRoutesOptions,
} from './strategy';

// Export risk routes
export {
  createRiskRoutes,
  RiskSnapshotResponse,
  RiskRoutesOptions,
} from './risk';

// Export resilience routes
export {
  createResilienceRoutes,
  ResilienceSnapshotResponse,
  GuardAction,
  ResilienceRoutesOptions,
} from './resilience';

// Export analytics routes
export {
  createAnalyticsRoutes,
  AnalyticsSnapshotResponse,
  EvidencePackResponse,
  AnalyticsRoutesOptions,
} from './analytics';
