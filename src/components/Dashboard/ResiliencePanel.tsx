import React, { memo, useMemo } from 'react';
import { useResilience, GuardActionType } from '../../hooks/useResilience';
import { formatDuration } from '../../utils/prometheusParser';

interface TriggerCounterProps {
  label: string;
  count: number;
  icon: React.ReactNode;
  colorClass: string;
}

const TriggerCounter = memo<TriggerCounterProps>(({ label, count, icon, colorClass }) => (
  <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center space-x-3">
    <div className={`w-10 h-10 rounded-lg ${colorClass} bg-opacity-20 flex items-center justify-center`}>
      {icon}
    </div>
    <div>
      <div className="text-2xl font-bold text-zinc-200">{count}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  </div>
));

TriggerCounter.displayName = 'TriggerCounter';

interface GuardActionItemProps {
  action: {
    id: string;
    timestamp: string;
    type: GuardActionType;
    source: string;
    reason: string;
    duration?: number;
  };
}

const GuardActionItem = memo<GuardActionItemProps>(({ action }) => {
  const typeConfig = useMemo(() => {
    switch (action.type) {
      case 'rate_limit_triggered':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          colorClass: 'text-yellow-400',
          bgClass: 'bg-yellow-900/20',
          label: 'Rate Limit',
        };
      case 'circuit_breaker_opened':
      case 'circuit_breaker_closed':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          ),
          colorClass: action.type === 'circuit_breaker_opened' ? 'text-red-400' : 'text-green-400',
          bgClass: action.type === 'circuit_breaker_opened' ? 'bg-red-900/20' : 'bg-green-900/20',
          label: action.type === 'circuit_breaker_opened' ? 'Circuit Open' : 'Circuit Close',
        };
      case 'throttle_applied':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
          ),
          colorClass: 'text-orange-400',
          bgClass: 'bg-orange-900/20',
          label: 'Throttle',
        };
      case 'request_dropped':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
          colorClass: 'text-red-400',
          bgClass: 'bg-red-900/20',
          label: 'Dropped',
        };
      case 'error_spike_detected':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          colorClass: 'text-red-400',
          bgClass: 'bg-red-900/20',
          label: 'Error Spike',
        };
      case 'recovery_initiated':
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ),
          colorClass: 'text-blue-400',
          bgClass: 'bg-blue-900/20',
          label: 'Recovery',
        };
      default:
        return {
          icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          colorClass: 'text-zinc-400',
          bgClass: 'bg-zinc-800',
          label: 'Unknown',
        };
    }
  }, [action.type]);

  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(action.timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }, [action.timestamp]);

  return (
    <div className={`flex items-start space-x-3 p-3 rounded-lg ${typeConfig.bgClass}`}>
      <div className={`mt-0.5 ${typeConfig.colorClass}`}>{typeConfig.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium ${typeConfig.colorClass}`}>
            {typeConfig.label}
          </span>
          <span className="text-xs text-zinc-500">{timeAgo}</span>
        </div>
        <div className="text-xs text-zinc-400 mt-1">{action.source}</div>
        <div className="text-xs text-zinc-500 mt-0.5 truncate">{action.reason}</div>
        {action.duration && (
          <div className="text-xs text-zinc-600 mt-1">
            Duration: {formatDuration(action.duration)}
          </div>
        )}
      </div>
    </div>
  );
});

GuardActionItem.displayName = 'GuardActionItem';

export interface ResiliencePanelProps {
  className?: string;
  maxActions?: number;
}

/**
 * Resilience Panel - Displays guard actions and trigger counters
 * Optimized with React.memo and useMemo for performance
 */
export const ResiliencePanel = memo<ResiliencePanelProps>(({ className = '', maxActions = 5 }) => {
  const { data, isLoading, error, lastUpdated, getRecentActions, totalTriggers } = useResilience();

  const recentActions = useMemo(() => getRecentActions(maxActions), [getRecentActions, maxActions]);

  const counters = data?.triggerCounters;

  const systemHealthStatus = data?.systemHealth.status ?? 'unknown';
  const healthConfig = useMemo(() => {
    switch (systemHealthStatus) {
      case 'healthy':
        return {
          bgClass: 'bg-green-900/40',
          textClass: 'text-green-400',
          icon: '✓',
        };
      case 'degraded':
        return {
          bgClass: 'bg-yellow-900/40',
          textClass: 'text-yellow-400',
          icon: '!',
        };
      case 'unhealthy':
        return {
          bgClass: 'bg-red-900/40',
          textClass: 'text-red-400',
          icon: '✕',
        };
      default:
        return {
          bgClass: 'bg-zinc-800',
          textClass: 'text-zinc-500',
          icon: '?',
        };
    }
  }, [systemHealthStatus]);

  const formattedLastUpdate = useMemo(() => {
    if (!lastUpdated) return 'Never';
    return lastUpdated.toLocaleTimeString();
  }, [lastUpdated]);

  if (isLoading && !data && !error) {
    return (
      <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-48 text-sm text-zinc-500">
          Initial resilience snapshot loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Resilience</span>
        </h3>
        {error && (
          <span className="px-2 py-1 text-xs bg-red-900/40 text-red-400 rounded">
            Error
          </span>
        )}
      </div>

      {/* System Health */}
      <div className={`mb-4 p-3 rounded-lg ${healthConfig.bgClass} flex items-center justify-between`}>
        <div className="flex items-center space-x-2">
          <span className={`text-lg ${healthConfig.textClass}`}>{healthConfig.icon}</span>
          <span className={`text-sm font-medium ${healthConfig.textClass}`}>
            System {systemHealthStatus.charAt(0).toUpperCase() + systemHealthStatus.slice(1)}
          </span>
        </div>
        {data?.systemHealth.message && (
          <span className="text-xs text-zinc-400">{data.systemHealth.message}</span>
        )}
      </div>

      {/* Total Triggers */}
      <div className="mb-4 p-4 bg-zinc-800/50 rounded-lg text-center">
        <div className="text-4xl font-bold text-zinc-200">{totalTriggers}</div>
        <div className="text-sm text-zinc-500">Total Triggers</div>
      </div>

      {/* Trigger Counters */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Trigger Counters</h4>
        <div className="grid grid-cols-2 gap-2">
          <TriggerCounter
            label="Rate Limit"
            count={counters?.rateLimit ?? 0}
            icon={
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            colorClass="text-yellow-400"
          />
          <TriggerCounter
            label="Circuit Breaker"
            count={counters?.circuitBreaker ?? 0}
            icon={
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            colorClass="text-red-400"
          />
          <TriggerCounter
            label="Throttle"
            count={counters?.throttle ?? 0}
            icon={
              <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
              </svg>
            }
            colorClass="text-orange-400"
          />
          <TriggerCounter
            label="Request Drop"
            count={counters?.requestDrop ?? 0}
            icon={
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            }
            colorClass="text-red-400"
          />
          <TriggerCounter
            label="Error Spike"
            count={counters?.errorSpike ?? 0}
            icon={
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
            colorClass="text-red-400"
          />
          <TriggerCounter
            label="Recovery"
            count={counters?.recovery ?? 0}
            icon={
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
            colorClass="text-blue-400"
          />
        </div>
      </div>

      {/* Active Guards */}
      {data?.activeGuards && data.activeGuards.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-zinc-400 mb-2">
            Active Guards ({data.activeGuards.length})
          </h4>
          <div className="flex flex-wrap gap-1">
            {data.activeGuards.map((guard) => (
              <span
                key={guard}
                className="px-2 py-0.5 text-xs bg-blue-900/40 text-blue-400 border border-blue-800 rounded"
              >
                {guard}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent Guard Actions */}
      <div>
        <h4 className="text-sm font-medium text-zinc-400 mb-2">
          Recent Actions ({recentActions.length})
        </h4>
        <div className="space-y-2 max-h-64 overflow-auto pr-1">
          {recentActions.length > 0 ? (
            recentActions.map((action) => (
              <GuardActionItem key={action.id} action={action} />
            ))
          ) : (
            <div className="text-center text-zinc-600 py-4">
              No guard actions recorded
            </div>
          )}
        </div>
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

ResiliencePanel.displayName = 'ResiliencePanel';

export default ResiliencePanel;
