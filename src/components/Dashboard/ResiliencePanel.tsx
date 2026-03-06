import React, { memo, useMemo } from 'react';
import { useResilience, GuardActionType } from '../../hooks/useResilience';
import { formatDuration } from '../../utils/prometheusParser';

interface TriggerCounterProps {
  label: string;
  count: number;
  colorClass: string;
}

const TriggerCounter = memo<TriggerCounterProps>(({ label, count, colorClass }) => (
  <div className="bg-zinc-800/50 rounded-lg p-3">
    <div className={`text-2xl font-bold ${colorClass}`}>{count}</div>
    <div className="text-xs text-zinc-500">{label}</div>
  </div>
));

TriggerCounter.displayName = 'TriggerCounter';

interface GuardActionItemProps {
  action: {
    id: string;
    timestamp: string;
    type: GuardActionType;
    source: string;
    actionType: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
  };
}

const GuardActionItem = memo<GuardActionItemProps>(({ action }) => {
  const config = useMemo(() => {
    switch (action.type) {
      case 'flash_crash':
        return { label: 'Flash Crash', colorClass: 'text-red-400', bgClass: 'bg-red-900/20' };
      case 'latency':
        return { label: 'Latency', colorClass: 'text-orange-400', bgClass: 'bg-orange-900/20' };
      case 'delta_burst':
        return { label: 'Delta Burst', colorClass: 'text-yellow-400', bgClass: 'bg-yellow-900/20' };
      case 'anti_spoof':
        return { label: 'Anti-Spoof', colorClass: 'text-blue-400', bgClass: 'bg-blue-900/20' };
      default:
        return { label: 'General', colorClass: 'text-zinc-400', bgClass: 'bg-zinc-800' };
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
    <div className={`rounded-lg p-3 ${config.bgClass}`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${config.colorClass}`}>{config.label}</span>
        <span className="text-xs text-zinc-500">{timeAgo}</span>
      </div>
      <div className="mt-1 text-xs text-zinc-400">{action.source} | {action.actionType}</div>
      <div className="mt-1 text-xs text-zinc-500 break-all">{action.reason}</div>
    </div>
  );
});

GuardActionItem.displayName = 'GuardActionItem';

export interface ResiliencePanelProps {
  className?: string;
  maxActions?: number;
}

export const ResiliencePanel = memo<ResiliencePanelProps>(({ className = '', maxActions = 5 }) => {
  const { data, isLoading, error, lastUpdated, getRecentActions, totalTriggers } = useResilience();

  const recentActions = useMemo(() => (
    getRecentActions(maxActions).map((action) => ({
      ...action,
      actionType: action.action,
    }))
  ), [getRecentActions, maxActions]);

  const counters = data?.triggerCounters;
  const systemHealthStatus = data?.systemHealth.status ?? 'unknown';
  const healthConfig = useMemo(() => {
    switch (systemHealthStatus) {
      case 'healthy':
        return { bgClass: 'bg-green-900/40', textClass: 'text-green-400', icon: 'OK' };
      case 'degraded':
        return { bgClass: 'bg-yellow-900/40', textClass: 'text-yellow-400', icon: 'WARN' };
      case 'unhealthy':
        return { bgClass: 'bg-red-900/40', textClass: 'text-red-400', icon: 'HALT' };
      default:
        return { bgClass: 'bg-zinc-800', textClass: 'text-zinc-500', icon: 'N/A' };
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

      <div className={`mb-4 p-3 rounded-lg ${healthConfig.bgClass} flex items-center justify-between`}>
        <div className="flex items-center space-x-2">
          <span className={`text-xs font-semibold ${healthConfig.textClass}`}>{healthConfig.icon}</span>
          <span className={`text-sm font-medium ${healthConfig.textClass}`}>
            System {systemHealthStatus.charAt(0).toUpperCase() + systemHealthStatus.slice(1)}
          </span>
        </div>
        {data?.systemHealth.message && (
          <span className="text-xs text-zinc-400">{data.systemHealth.message}</span>
        )}
      </div>

      <div className="mb-4 p-4 bg-zinc-800/50 rounded-lg text-center">
        <div className="text-4xl font-bold text-zinc-200">{totalTriggers}</div>
        <div className="text-sm text-zinc-500">Total Triggers</div>
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-medium text-zinc-400 mb-2">Trigger Counters</h4>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <TriggerCounter label="Anti-Spoof" count={counters?.antiSpoof ?? 0} colorClass="text-blue-400" />
          <TriggerCounter label="Delta Burst" count={counters?.deltaBurst ?? 0} colorClass="text-yellow-400" />
          <TriggerCounter label="Latency" count={counters?.latencySpike ?? 0} colorClass="text-orange-400" />
          <TriggerCounter label="Flash Crash" count={counters?.flashCrash ?? 0} colorClass="text-red-400" />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-800/40 rounded-lg p-3">
          <div className="text-zinc-500">Flash Crash Guard</div>
          <div className="mt-2 flex items-center justify-between text-zinc-300">
            <span>Detections</span>
            <span>{data?.guards.flashCrash.totalDetections ?? 0}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-zinc-300">
            <span>Protection</span>
            <span className={(data?.guards.flashCrash.activeProtections ?? false) ? 'text-red-400' : 'text-green-400'}>
              {(data?.guards.flashCrash.activeProtections ?? false) ? 'active' : 'inactive'}
            </span>
          </div>
        </div>
        <div className="bg-zinc-800/40 rounded-lg p-3">
          <div className="text-zinc-500">Delta Burst Guard</div>
          <div className="mt-2 flex items-center justify-between text-zinc-300">
            <span>Detections</span>
            <span>{data?.guards.deltaBurst.totalBurstsDetected ?? 0}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-zinc-300">
            <span>Cooldown</span>
            <span>
              {(data?.guards.deltaBurst.currentCooldownActive ?? false)
                ? formatDuration(data?.guards.deltaBurst.cooldownRemainingMs ?? 0)
                : 'inactive'}
            </span>
          </div>
        </div>
        <div className="bg-zinc-800/40 rounded-lg p-3">
          <div className="text-zinc-500">Anti-Spoof Guard</div>
          <div className="mt-2 flex items-center justify-between text-zinc-300">
            <span>Suspected Levels</span>
            <span>{data?.guards.antiSpoof.activeSuspectedLevels ?? 0}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-zinc-300">
            <span>Total Detections</span>
            <span>{data?.guards.antiSpoof.totalDetections ?? 0}</span>
          </div>
        </div>
        <div className="bg-zinc-800/40 rounded-lg p-3">
          <div className="text-zinc-500">Latency Guard</div>
          <div className="mt-2 flex items-center justify-between text-zinc-300">
            <span>Samples</span>
            <span>{data?.guards.latency.totalSamples ?? 0}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-zinc-300">
            <span>Triggered</span>
            <span>{counters?.latencySpike ?? 0}</span>
          </div>
        </div>
      </div>

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
