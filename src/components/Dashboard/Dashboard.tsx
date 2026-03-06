import React, { memo, useState, useCallback, useRef } from 'react';
import { PanelErrorBoundary } from '../ErrorBoundary';
import { useHealth } from '../../hooks/useHealth';
import { useMetrics } from '../../hooks/useMetrics';
import { useDryRunStatus } from '../../hooks/useDryRunStatus';
import SystemStatusPanel from './SystemStatusPanel';
import TelemetryPanel from './TelemetryPanel';
import AnalyticsPanel from './AnalyticsPanel';
import StrategyPanel from './StrategyPanel';
import ResiliencePanel from './ResiliencePanel';

interface PanelWrapperProps {
  children: React.ReactNode;
  panelName: string;
}

const PanelWrapper = memo<PanelWrapperProps>(({ children, panelName }) => (
  <PanelErrorBoundary panelName={panelName}>
    {children}
  </PanelErrorBoundary>
));

PanelWrapper.displayName = 'PanelWrapper';

interface DashboardHeaderProps {
  onRefresh: () => void;
  isRefreshing: boolean;
}

const DashboardHeader = memo<DashboardHeaderProps>(({ onRefresh, isRefreshing }) => (
  <header className="bg-zinc-900/80 border-b border-zinc-800 sticky top-0 z-10 backdrop-blur-sm">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Trading Dashboard</h1>
            <p className="text-xs text-zinc-500">Real-time telemetry, risk & analytics</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 text-zinc-300 rounded-lg transition-colors text-sm"
          >
            {isRefreshing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-zinc-400"></div>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span>Refresh</span>
          </button>
        </div>
      </div>
    </div>
  </header>
));

DashboardHeader.displayName = 'DashboardHeader';

interface ConnectionStatusBarProps {
  state: 'connected' | 'degraded' | 'disconnected' | 'connecting';
  dryRunActive: boolean;
}

const ConnectionStatusBar = memo<ConnectionStatusBarProps>(({ state, dryRunActive }) => (
  <div className={`px-4 py-1 text-xs text-center ${
    state === 'connected'
      ? 'bg-green-900/20 text-green-400'
      : state === 'connecting'
        ? 'bg-blue-900/20 text-blue-400'
      : state === 'degraded'
        ? 'bg-yellow-900/20 text-yellow-400'
        : 'bg-red-900/20 text-red-400'
  }`}>
    <div className="flex items-center justify-center space-x-2">
      <span className={`w-2 h-2 rounded-full ${
        state === 'connected'
          ? 'bg-green-500 animate-pulse'
          : state === 'connecting'
            ? 'bg-blue-500 animate-pulse'
          : state === 'degraded'
            ? 'bg-yellow-500 animate-pulse'
            : 'bg-red-500'
      }`}></span>
      <span>{
        state === 'connected'
          ? (dryRunActive ? 'Connected to trading system | dry run active' : 'Connected to trading system')
          : state === 'connecting'
            ? 'Connecting to trading system'
          : state === 'degraded'
            ? (dryRunActive ? 'Connected | dry run active, telemetry partial' : 'Connected, waiting telemetry data')
            : 'Disconnected from trading system'
      }</span>
    </div>
  </div>
));

ConnectionStatusBar.displayName = 'ConnectionStatusBar';

/**
 * Main Dashboard Component
 * 
 * Features:
 * - System Status Panel: Health/Ready/Risk State/Kill Switch/Trading Mode
 * - Telemetry Panel: Prometheus metrics, WS latency histogram, strategy confidence
 * - Analytics Panel: PnL, fees, slippage, drawdown, evidence pack download
 * - Strategy Panel: Consensus decision, signals list
 * - Resilience Panel: Guard actions, trigger counters
 * 
 * Optimizations:
 * - React.memo for all panels to prevent unnecessary re-renders
 * - Panel-level error boundaries for graceful degradation
 * - usePolling hooks with optimized intervals
 */
const Dashboard: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mountedAtRef = useRef<number>(Date.now());
  const { health, error: healthError } = useHealth();
  const { data: metricsData, error: metricsError } = useMetrics();
  const { data: dryRunData } = useDryRunStatus();
  const hasHealthData = Boolean(health);
  const hasTelemetryData = Boolean(metricsData);
  const hasDryRunData = Boolean(dryRunData?.running);
  const hasAnyData = hasHealthData || hasTelemetryData || hasDryRunData;
  const hasAnyError = Boolean(healthError || metricsError);
  const isWithinGrace = Date.now() - mountedAtRef.current < 15000;

  const connectionState: 'connected' | 'degraded' | 'disconnected' | 'connecting' = (
    hasHealthData && (hasTelemetryData || hasDryRunData)
      ? 'connected'
      : hasAnyData
        ? 'degraded'
        : hasAnyError
          ? 'disconnected'
          : isWithinGrace
            ? 'connecting'
            : 'disconnected'
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Trigger refresh on all panels by forcing a re-render
    // The hooks will automatically refresh due to their internal logic
    await new Promise(resolve => setTimeout(resolve, 500));
    setIsRefreshing(false);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950">
      <DashboardHeader onRefresh={handleRefresh} isRefreshing={isRefreshing} />
      <ConnectionStatusBar state={connectionState} dryRunActive={hasDryRunData} />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Top Row - System Status & Telemetry */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <PanelWrapper panelName="System Status">
            <SystemStatusPanel />
          </PanelWrapper>
          <PanelWrapper panelName="Telemetry">
            <TelemetryPanel />
          </PanelWrapper>
        </div>

        {/* Middle Row - Analytics & Strategy */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <PanelWrapper panelName="Analytics">
            <AnalyticsPanel />
          </PanelWrapper>
          <PanelWrapper panelName="Strategy">
            <StrategyPanel maxSignals={8} />
          </PanelWrapper>
        </div>

        {/* Bottom Row - Resilience (full width) */}
        <div className="grid grid-cols-1 gap-6">
          <PanelWrapper panelName="Resilience">
            <ResiliencePanel maxActions={10} />
          </PanelWrapper>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-8 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between text-xs text-zinc-600">
            <div>
              Trading Dashboard v1.1 | 
              <span className="ml-1">Polling: Health 1s | Metrics/Analytics/Strategy 2s | Risk 1s</span>
            </div>
            <div>
              Built with React + TypeScript
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default memo(Dashboard);
