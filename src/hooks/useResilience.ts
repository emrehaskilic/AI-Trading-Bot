import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiJson } from '../services/apiFetch';

export type GuardActionType =
  | 'rate_limit_triggered'
  | 'circuit_breaker_opened'
  | 'circuit_breaker_closed'
  | 'throttle_applied'
  | 'request_dropped'
  | 'error_spike_detected'
  | 'recovery_initiated';

export interface GuardAction {
  id: string;
  timestamp: string;
  type: GuardActionType;
  source: string;
  reason: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface TriggerCounters {
  rateLimit: number;
  circuitBreaker: number;
  throttle: number;
  requestDrop: number;
  errorSpike: number;
  recovery: number;
}

export interface ResilienceSnapshot {
  timestamp: string;
  guardActions: GuardAction[];
  triggerCounters: TriggerCounters;
  activeGuards: string[];
  systemHealth: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
  };
  recentEvents: Array<{
    timestamp: string;
    event: string;
    severity: 'info' | 'warning' | 'error';
  }>;
}

interface BackendResilienceSnapshot {
  timestamp: number;
  guards: {
    deltaBurst: { currentCooldownActive: boolean };
    flashCrash: { activeProtections: boolean };
  };
  triggerCounters: {
    antiSpoof: number;
    deltaBurst: number;
    latencySpike: number;
    flashCrash: number;
    total: number;
  };
  recentActions: Array<{
    guardType: 'anti_spoof' | 'delta_burst' | 'latency' | 'flash_crash' | 'general';
    timestamp: number;
    symbol?: string;
    action: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
    metadata?: Record<string, unknown>;
  }>;
}

function mapActionType(
  action: BackendResilienceSnapshot['recentActions'][number],
): GuardActionType {
  if (action.guardType === 'anti_spoof') return 'throttle_applied';
  if (action.guardType === 'delta_burst') return 'rate_limit_triggered';
  if (action.guardType === 'flash_crash') {
    return String(action.action || '').toUpperCase().includes('ALLOW')
      ? 'circuit_breaker_closed'
      : 'circuit_breaker_opened';
  }
  if (action.guardType === 'latency') return 'error_spike_detected';

  const reason = String(action.reason || '').toLowerCase();
  if (reason.includes('recover') || reason.includes('healthy') || reason.includes('allow')) {
    return 'recovery_initiated';
  }
  if (reason.includes('drop') || reason.includes('block') || reason.includes('no_trade')) {
    return 'request_dropped';
  }
  return 'recovery_initiated';
}

export function useResilience(): {
  data: ResilienceSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  getActionsByType: (type: GuardActionType) => GuardAction[];
  getRecentActions: (count: number) => GuardAction[];
  totalTriggers: number;
} {
  const fetchResilience = useCallback(async (): Promise<ResilienceSnapshot> => {
    const raw = await fetchApiJson<BackendResilienceSnapshot>(
      '/api/resilience/snapshot',
      withProxyApiKey({ cache: 'no-store' }),
    );

    const snapshotTs = Number(raw?.timestamp || Date.now());
    const recentWindowMs = 45_000;
    const recentActionsRaw = ((raw?.recentActions) || []).filter((action) => {
      const actionTs = Number(action?.timestamp || 0);
      if (!Number.isFinite(actionTs) || actionTs <= 0) return false;
      const ageMs = snapshotTs - actionTs;
      return ageMs >= 0 && ageMs <= recentWindowMs;
    });

    const guardActions: GuardAction[] = recentActionsRaw.map((action, index) => ({
      id: `${action.guardType}-${action.timestamp}-${index}`,
      timestamp: new Date(action.timestamp).toISOString(),
      type: mapActionType(action),
      source: action.symbol || action.guardType,
      reason: action.reason,
      duration: undefined,
      metadata: action.metadata,
    }));

    const triggerCounters: TriggerCounters = {
      rateLimit: guardActions.filter((a) => a.type === 'rate_limit_triggered').length,
      circuitBreaker: guardActions.filter((a) => a.type === 'circuit_breaker_opened').length,
      throttle: guardActions.filter((a) => a.type === 'throttle_applied').length,
      requestDrop: guardActions.filter((a) => a.type === 'request_dropped').length,
      errorSpike: guardActions.filter((a) => a.type === 'error_spike_detected').length,
      recovery: guardActions.filter((a) => a.type === 'recovery_initiated' || a.type === 'circuit_breaker_closed').length,
    };

    const activeGuards: string[] = [];
    if (raw?.guards?.deltaBurst?.currentCooldownActive) activeGuards.push('delta_burst');
    if (raw?.guards?.flashCrash?.activeProtections) activeGuards.push('flash_crash');

    const highSeverityRecent = recentActionsRaw.some((action) => action.severity === 'high');
    const mediumOrHighNonGeneral = recentActionsRaw.filter((action) => (
      action.guardType !== 'general' && action.severity !== 'low'
    )).length;
    const hasActiveProtection = Boolean(raw?.guards?.deltaBurst?.currentCooldownActive || raw?.guards?.flashCrash?.activeProtections);

    const status = raw?.guards?.flashCrash?.activeProtections
      ? 'unhealthy'
      : (hasActiveProtection || highSeverityRecent || mediumOrHighNonGeneral >= 3)
        ? 'degraded'
        : 'healthy';

    return {
      timestamp: new Date(snapshotTs).toISOString(),
      guardActions,
      triggerCounters,
      activeGuards,
      systemHealth: {
        status,
        message: status === 'healthy'
          ? 'No active resilience suppressions'
          : status === 'unhealthy'
            ? 'Critical resilience protections active'
            : 'Recent resilience suppressions detected',
      },
      recentEvents: recentActionsRaw.slice(-10).map((action) => ({
        timestamp: new Date(action.timestamp).toISOString(),
        event: action.reason,
        severity: action.severity === 'high'
          ? 'error'
          : action.severity === 'medium'
            ? 'warning'
            : 'info',
      })),
    };
  }, []);

  const polling = usePolling<ResilienceSnapshot>({
    interval: 2000,
    fetcher: fetchResilience,
    maxRetries: 2,
    retryDelay: 1000,
  });

  const getActionsByType = useCallback((type: GuardActionType): GuardAction[] => {
    return polling.data?.guardActions.filter((a) => a.type === type) ?? [];
  }, [polling.data?.guardActions]);

  const getRecentActions = useCallback((count: number): GuardAction[] => {
    const actions = polling.data?.guardActions ?? [];
    return [...actions]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, count);
  }, [polling.data?.guardActions]);

  const totalTriggers = useMemo(() => {
    const counters = polling.data?.triggerCounters;
    if (!counters) return 0;
    return Object.values(counters).reduce((sum, count) => sum + count, 0);
  }, [polling.data?.triggerCounters]);

  return useMemo(() => ({
    data: polling.data ?? null,
    isLoading: polling.isLoading,
    error: polling.error,
    lastUpdated: polling.lastUpdated ? new Date(polling.lastUpdated) : null,
    refresh: polling.refresh,
    getActionsByType,
    getRecentActions,
    totalTriggers,
  }), [polling, getActionsByType, getRecentActions, totalTriggers]);
}
