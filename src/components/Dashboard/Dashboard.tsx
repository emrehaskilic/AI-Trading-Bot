import React, { memo, useState, useCallback, Suspense } from 'react';
import { PanelErrorBoundary } from '../ErrorBoundary';

// Lazy load panels for code splitting
const SystemStatusPanel = React.lazy(() => import('./SystemStatusPanel'));
const TelemetryPanel = React.lazy(() => import('./TelemetryPanel'));
const AnalyticsPanel = React.lazy(() => import('./AnalyticsPanel'));
const StrategyPanel = React.lazy(() => import('./StrategyPanel'));
const ResiliencePanel = React.lazy(() => import('./ResiliencePanel'));

interface PanelWrapperProps {
  children: React.ReactNode;
  panelName: string;
}

const PanelWrapper = memo<PanelWrapperProps>(({ children, panelName }) => (
  <PanelErrorBoundary panelName={panelName}>
    <Suspense
      fallback={
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 h-48">
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
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
  connected: boolean;
}

const ConnectionStatusBar = memo<ConnectionStatusBarProps>(({ connected }) => (
  <div className={`px-4 py-1 text-xs text-center ${connected ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>
    <div className="flex items-center justify-center space-x-2">
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
      <span>{connected ? 'Connected to trading system' : 'Disconnected from trading system'}</span>
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
 * - Lazy loading with Suspense for code splitting
 * - Panel-level error boundaries for graceful degradation
 * - usePolling hooks with optimized intervals
 */
const Dashboard: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

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
      <ConnectionStatusBar connected={isConnected} />
      
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
              Trading Dashboard v1.0 | 
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
