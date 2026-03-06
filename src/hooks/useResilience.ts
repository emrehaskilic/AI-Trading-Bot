import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiJson } from '../services/apiFetch';

export type GuardActionType = 'anti_spoof' | 'delta_burst' | 'latency' | 'flash_crash' | 'general';

export interface GuardAction {
  id: string;
  timestamp: string;
  type: GuardActionType;
  source: string;
  action: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
}

export interface TriggerCounters {
  antiSpoof: number;
  deltaBurst: number;
  latencySpike: number;
  flashCrash: number;
  total: number;
}

export interface ResilienceSnapshot {
  timestamp: string;
  guardActions: GuardAction[];
  triggerCounters: TriggerCounters;
  activeGuards: string[];
  guards: {
    antiSpoof: {
      totalDetections: number;
      activeSuspectedLevels: number;
      totalLevelsTracked: number;
      avgSpoofScore: number;
      lastDetectionAt: number | null;
    };
    deltaBurst: {
      totalBurstsDetected: number;
      currentCooldownActive: boolean;
      cooldownRemainingMs: number;
      meanDelta: number;
      stdDelta: number;
      lastBurstAt: number | null;
    };
    latency: {
      totalSamples: number;
    };
    flashCrash: {
      totalDetections: number;
      lastDetectionAt: number | null;
      activeProtections: boolean;
    };
  };
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
  guards: ResilienceSnapshot['guards'] & {
    latency: {
      stages: Record<string, {
        avgMs: number;
        p95Ms: number;
        maxMs: number;
        samples: number;
      }>;
      totalSamples: number;
    };
  };
  triggerCounters: TriggerCounters;
  recentActions: Array<{
    guardType: GuardActionType;
    timestamp: number;
    symbol?: string;
    action: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
    metadata?: Record<string, unknown>;
  }>;
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
    const guardActions: GuardAction[] = ((raw?.recentActions) || []).map((action, index) => ({
      id: `${action.guardType}-${action.timestamp}-${index}`,
      timestamp: new Date(action.timestamp).toISOString(),
      type: action.guardType,
      source: action.symbol || action.guardType,
      action: action.action,
      reason: action.reason,
      severity: action.severity,
      metadata: action.metadata,
    }));

    const activeGuards: string[] = [];
    if (raw?.guards?.antiSpoof?.activeSuspectedLevels > 0) activeGuards.push('anti_spoof');
    if (raw?.guards?.deltaBurst?.currentCooldownActive) activeGuards.push('delta_burst');
    if (raw?.guards?.flashCrash?.activeProtections) activeGuards.push('flash_crash');

    const status = raw?.guards?.flashCrash?.activeProtections
      ? 'unhealthy'
      : activeGuards.length > 0
        ? 'degraded'
        : 'healthy';

    return {
      timestamp: new Date(snapshotTs).toISOString(),
      guardActions,
      triggerCounters: raw?.triggerCounters || {
        antiSpoof: 0,
        deltaBurst: 0,
        latencySpike: 0,
        flashCrash: 0,
        total: 0,
      },
      activeGuards,
      guards: {
        antiSpoof: raw?.guards?.antiSpoof || {
          totalDetections: 0,
          activeSuspectedLevels: 0,
          totalLevelsTracked: 0,
          avgSpoofScore: 0,
          lastDetectionAt: null,
        },
        deltaBurst: raw?.guards?.deltaBurst || {
          totalBurstsDetected: 0,
          currentCooldownActive: false,
          cooldownRemainingMs: 0,
          meanDelta: 0,
          stdDelta: 0,
          lastBurstAt: null,
        },
        latency: {
          totalSamples: Number(raw?.guards?.latency?.totalSamples || 0),
        },
        flashCrash: raw?.guards?.flashCrash || {
          totalDetections: 0,
          lastDetectionAt: null,
          activeProtections: false,
        },
      },
      systemHealth: {
        status,
        message: status === 'healthy'
          ? 'No active resilience suppressions'
          : status === 'unhealthy'
            ? 'Flash-crash protections active'
            : 'Resilience guards recently active',
      },
      recentEvents: guardActions.slice(-10).map((action) => ({
        timestamp: action.timestamp,
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
    return Number(polling.data?.triggerCounters.total || 0);
  }, [polling.data?.triggerCounters.total]);

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
