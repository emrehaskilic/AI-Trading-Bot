import React, { memo, useMemo } from 'react';
import { useHealth } from '../../hooks/useHealth';
import { useRisk } from '../../hooks/useRisk';
import { useDryRunStatus } from '../../hooks/useDryRunStatus';

interface StatusBadgeProps {
  label: string;
  status: 'healthy' | 'unhealthy' | 'degraded' | 'unknown' | boolean;
  details?: string;
}

const StatusBadge = memo<StatusBadgeProps>(({ label, status, details }) => {
  const { bgClass, textClass, icon } = useMemo(() => {
    if (status === true || status === 'healthy') {
      return {
        bgClass: 'bg-green-900/40',
        textClass: 'text-green-400',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
      };
    }
    if (status === false || status === 'unhealthy') {
      return {
        bgClass: 'bg-red-900/40',
        textClass: 'text-red-400',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
      };
    }
    if (status === 'degraded') {
      return {
        bgClass: 'bg-yellow-900/40',
        textClass: 'text-yellow-400',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
          </svg>
        ),
      };
    }
    return {
      bgClass: 'bg-zinc-800',
      textClass: 'text-zinc-500',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    };
  }, [status]);

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg ${bgClass}`}>
      <div className="flex items-center space-x-2">
        <span className={textClass}>{icon}</span>
        <span className={`text-sm font-medium ${textClass}`}>{label}</span>
      </div>
      {details && <span className="text-xs text-zinc-400">{details}</span>}
    </div>
  );
});

StatusBadge.displayName = 'StatusBadge';

interface RiskStateBadgeProps {
  state: string;
  tradingMode: string;
  killSwitchActive: boolean;
}

const RiskStateBadge = memo<RiskStateBadgeProps>(({ state, tradingMode, killSwitchActive }) => {
  const stateConfig = useMemo(() => {
    if (killSwitchActive) {
      return {
        bgClass: 'bg-red-900/60',
        textClass: 'text-red-300',
        borderClass: 'border-red-700',
        label: 'KILL SWITCH',
      };
    }
    switch (state) {
      case 'normal':
        return {
          bgClass: 'bg-green-900/40',
          textClass: 'text-green-400',
          borderClass: 'border-green-800',
          label: 'NORMAL',
        };
      case 'elevated':
        return {
          bgClass: 'bg-yellow-900/40',
          textClass: 'text-yellow-400',
          borderClass: 'border-yellow-800',
          label: 'ELEVATED',
        };
      case 'high':
        return {
          bgClass: 'bg-orange-900/40',
          textClass: 'text-orange-400',
          borderClass: 'border-orange-800',
          label: 'HIGH',
        };
      case 'critical':
        return {
          bgClass: 'bg-red-900/40',
          textClass: 'text-red-400',
          borderClass: 'border-red-800',
          label: 'CRITICAL',
        };
      default:
        return {
          bgClass: 'bg-zinc-800',
          textClass: 'text-zinc-500',
          borderClass: 'border-zinc-700',
          label: state.toUpperCase(),
        };
    }
  }, [state, killSwitchActive]);

  const modeConfig = useMemo(() => {
    switch (tradingMode) {
      case 'normal':
        return { textClass: 'text-green-400', label: 'Normal' };
      case 'reduced':
        return { textClass: 'text-yellow-400', label: 'Reduced' };
      case 'paused':
        return { textClass: 'text-orange-400', label: 'Paused' };
      case 'emergency_close':
        return { textClass: 'text-red-400', label: 'Emergency Close' };
      default:
        return { textClass: 'text-zinc-500', label: tradingMode };
    }
  }, [tradingMode]);

  return (
    <div className={`p-4 rounded-lg border ${stateConfig.borderClass} ${stateConfig.bgClass}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-400 uppercase tracking-wider">Risk State</span>
        <span className={`text-sm font-bold ${stateConfig.textClass}`}>{stateConfig.label}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">Trading Mode</span>
        <span className={`text-sm font-medium ${modeConfig.textClass}`}>{modeConfig.label}</span>
      </div>
    </div>
  );
});

RiskStateBadge.displayName = 'RiskStateBadge';

export interface SystemStatusPanelProps {
  className?: string;
}

/**
 * System Status Panel - Displays health, readiness, risk state, kill switch, and trading mode
 * Optimized with React.memo to prevent unnecessary re-renders
 */
export const SystemStatusPanel = memo<SystemStatusPanelProps>(({ className = '' }) => {
  const { health, ready, isLoading, error, lastUpdated } = useHealth();
  const { data: riskData, isLoading: riskLoading, error: riskError } = useRisk();
  const { data: dryRunData, error: dryRunError, lastUpdated: dryRunLastUpdated } = useDryRunStatus();

  const healthStatus = useMemo(() => {
    if (!health) return 'unknown' as const;
    return health.status;
  }, [health]);

  const readyStatus = useMemo(() => {
    if (!ready) return 'unknown' as const;
    return ready.ready ? 'healthy' : 'unhealthy';
  }, [ready]);

  const formattedLastUpdate = useMemo(() => {
    const latest = [lastUpdated, dryRunLastUpdated]
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latest) return 'Never';
    return latest.toLocaleTimeString();
  }, [dryRunLastUpdated, lastUpdated]);

  const dryRunPnl = useMemo(() => {
    if (!dryRunData) return 0;
    return Number(dryRunData.summary.realizedPnl || 0)
      + Number(dryRunData.summary.unrealizedPnl || 0)
      - Number(dryRunData.summary.feePaid || 0);
  }, [dryRunData]);

  if (isLoading && !health && !ready && !error && !riskError && !dryRunError) {
    return (
      <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-32 text-sm text-zinc-500">
          Initial system snapshot loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>System Status</span>
        </h3>
        {(error || riskError || dryRunError) && (
          <span className="px-2 py-1 text-xs bg-red-900/40 text-red-400 rounded">
            Error
          </span>
        )}
      </div>

      <div className="space-y-3">
        <StatusBadge 
          label="Health" 
          status={healthStatus} 
          details={health?.version ? `v${health.version}` : undefined}
        />
        <StatusBadge 
          label="Ready" 
          status={readyStatus}
          details={ready?.dependencies ? `${Object.values(ready.dependencies).filter(Boolean).length}/${Object.keys(ready.dependencies).length} deps` : undefined}
        />
        <StatusBadge
          label="Dry Run"
          status={dryRunData?.running ? 'healthy' : 'unknown'}
          details={dryRunData?.running ? `${dryRunData.symbols.length} symbols` : 'inactive'}
        />

        {riskData && (
          <RiskStateBadge
            state={riskData.state}
            tradingMode={riskData.tradingMode}
            killSwitchActive={riskData.killSwitchActive}
          />
        )}

        {riskData?.killSwitchActive && riskData.killSwitchReason && (
          <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
            <div className="flex items-center space-x-2 text-red-400 mb-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm font-medium">Kill Switch Active</span>
            </div>
            <p className="text-xs text-red-300/80">{riskData.killSwitchReason}</p>
          </div>
        )}

        {dryRunData?.running && (
          <div className="p-3 bg-blue-950/40 border border-blue-900 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-blue-300 uppercase tracking-wider">Dry Run Session</span>
              <span className="text-xs text-blue-200">{dryRunData.runId || 'active'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-zinc-950/50 px-2 py-2">
                <div className="text-zinc-500">Symbols</div>
                <div className="mt-1 text-zinc-200">{dryRunData.symbols.join(', ') || '-'}</div>
              </div>
              <div className="rounded bg-zinc-950/50 px-2 py-2">
                <div className="text-zinc-500">Reserve Scale</div>
                <div className="mt-1 text-zinc-200">
                  {(dryRunData.config?.reserveScale ?? 1).toFixed(4)}
                </div>
              </div>
              <div className="rounded bg-zinc-950/50 px-2 py-2">
                <div className="text-zinc-500">Shared Wallet</div>
                <div className="mt-1 text-zinc-200">
                  {(dryRunData.config?.sharedWalletStartUsdt ?? 0).toFixed(2)} USDT
                </div>
              </div>
              <div className="rounded bg-zinc-950/50 px-2 py-2">
                <div className="text-zinc-500">Configured Reserve</div>
                <div className="mt-1 text-zinc-200">
                  {(dryRunData.config?.totalConfiguredReserveUsdt ?? 0).toFixed(2)} USDT
                </div>
              </div>
              <div className="rounded bg-zinc-950/50 px-2 py-2">
                <div className="text-zinc-500">Total Equity</div>
                <div className="mt-1 text-zinc-200">{dryRunData.summary.totalEquity.toFixed(2)} USDT</div>
              </div>
              <div className="rounded bg-zinc-950/50 px-2 py-2">
                <div className="text-zinc-500">Open Positions</div>
                <div className="mt-1 text-zinc-200">{dryRunData.openPositions}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-zinc-500">Net PnL</span>
              <span className={dryRunPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                {dryRunPnl >= 0 ? '+' : ''}{dryRunPnl.toFixed(2)} USDT
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-800">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Last updated</span>
          <span>{formattedLastUpdate}</span>
        </div>
      </div>
    </div>
  );
});

SystemStatusPanel.displayName = 'SystemStatusPanel';

export default SystemStatusPanel;
