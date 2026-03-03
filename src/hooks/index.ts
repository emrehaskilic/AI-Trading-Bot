/**
 * Custom Hooks Export
 *
 * All custom React hooks for the trading dashboard.
 */

export { usePolling } from './usePolling';
export type { PollingOptions, PollingState, PollingControls, PollingResult } from './usePolling';

export { useHealth } from './useHealth';
export type { HealthStatus, ReadyStatus, HealthState } from './useHealth';

export { useMetrics } from './useMetrics';
export type { TelemetrySnapshot, MetricsData } from './useMetrics';

export { useAnalytics } from './useAnalytics';
export type {
  PnLMetrics,
  FeeMetrics,
  SlippageMetrics,
  DrawdownMetrics,
  AnalyticsSnapshot,
} from './useAnalytics';

export { useStrategy } from './useStrategy';
export type {
  SignalDirection,
  SignalStrength,
  StrategySignal,
  ConsensusDecision,
  StrategySnapshot,
} from './useStrategy';

export { useRisk } from './useRisk';
export type {
  RiskState,
  TradingMode,
  RiskLimits,
  RiskExposure,
  RiskSnapshot,
} from './useRisk';

export { useResilience } from './useResilience';
export type {
  GuardActionType,
  GuardAction,
  TriggerCounters,
  ResilienceSnapshot,
} from './useResilience';
