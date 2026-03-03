/**
 * Dashboard Components Export
 * 
 * All dashboard panels and the main container are exported from here.
 * Use barrel exports for cleaner imports.
 */

export { default as Dashboard } from './Dashboard';
export { default as SystemStatusPanel } from './SystemStatusPanel';
export { default as TelemetryPanel } from './TelemetryPanel';
export { default as AnalyticsPanel } from './AnalyticsPanel';
export { default as StrategyPanel } from './StrategyPanel';
export { default as ResiliencePanel } from './ResiliencePanel';

// Re-export types
export type { SystemStatusPanelProps } from './SystemStatusPanel';
export type { TelemetryPanelProps } from './TelemetryPanel';
export type { AnalyticsPanelProps } from './AnalyticsPanel';
export type { StrategyPanelProps } from './StrategyPanel';
export type { ResiliencePanelProps } from './ResiliencePanel';
