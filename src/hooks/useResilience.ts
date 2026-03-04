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
    guardType: 'anti_spoof' | 'delta_burst' | 'latency' | 'flash_crash';
    timestamp: number;
    symbol?: string;
    action: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
    metadata?: Record<string, unknown>;
  }>;
}

function mapActionType(guardType: BackendResilienceSnapshot['recentActions'][number]['guardType']): GuardActionType {
  if (guardType === 'anti_spoof') return 'throttle_applied';
  if (guardType === 'delta_burst') return 'rate_limit_triggered';
  if (guardType === 'flash_crash') return 'circuit_breaker_opened';
  return 'error_spike_detected';
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
    const recentWindowMs = 60_000;
    const recentActionsRaw = ((raw?.recentActions) || []).filter((action) => {
      const actionTs = Number(action?.timestamp || 0);
      if (!Number.isFinite(actionTs) || actionTs <= 0) return false;
      const ageMs = snapshotTs - actionTs;
      return ageMs >= 0 && ageMs <= recentWindowMs;
    });

    const recentByGuard = recentActionsRaw.reduce((acc, action) => {
      acc[action.guardType] = (acc[action.guardType] || 0) + 1;
      return acc;
    }, {
      anti_spoof: 0,
      delta_burst: 0,
      latency: 0,
      flash_crash: 0,
    } as Record<BackendResilienceSnapshot['recentActions'][number]['guardType'], number>);

    const triggerCounters: TriggerCounters = {
      rateLimit: recentByGuard.anti_spoof,
      circuitBreaker: recentByGuard.flash_crash,
      throttle: recentByGuard.delta_burst,
      requestDrop: 0,
      errorSpike: recentByGuard.latency,
      recovery: 0,
    };

    const guardActions: GuardAction[] = recentActionsRaw.map((action, index) => ({
      id: `${action.guardType}-${action.timestamp}-${index}`,
      timestamp: new Date(action.timestamp).toISOString(),
      type: mapActionType(action.guardType),
      source: action.symbol || action.guardType,
      reason: action.reason,
      duration: undefined,
      metadata: action.metadata,
    }));

    const activeGuards: string[] = [];
    if (raw?.guards?.deltaBurst?.currentCooldownActive) activeGuards.push('delta_burst');
    if (raw?.guards?.flashCrash?.activeProtections) activeGuards.push('flash_crash');

    const hasActiveProtection = raw?.guards?.deltaBurst?.currentCooldownActive || raw?.guards?.flashCrash?.activeProtections;
    const hasRecentCritical = recentActionsRaw.some((action) => action.severity === 'high');
    const status = raw?.guards?.flashCrash?.activeProtections
      ? 'unhealthy'
      : (hasActiveProtection || hasRecentCritical || recentActionsRaw.length > 0)
        ? 'degraded'
        : 'healthy';

    return {
      timestamp: new Date(raw?.timestamp || Date.now()).toISOString(),
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
      recentEvents: guardActions.slice(-10).map((action) => ({
        timestamp: action.timestamp,
        event: action.reason,
        severity: action.type === 'circuit_breaker_opened' ? 'error' : 'warning',
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
