import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiJson } from '../services/apiFetch';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version?: string;
  uptime?: number;
  checks?: Record<string, { status: string; message?: string }>;
}

export interface ReadyStatus {
  ready: boolean;
  timestamp: string;
  dependencies?: Record<string, boolean>;
  reasons?: string[];
}

export interface HealthState {
  health: HealthStatus | null;
  ready: ReadyStatus | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
}

function toIso(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date().toISOString();
}

export function useHealth(): HealthState & { refresh: () => Promise<void> } {
  const fetchHealth = useCallback(async (): Promise<HealthStatus> => {
    const raw = await fetchApiJson<any>(
      '/health',
      withProxyApiKey({ cache: 'no-store' }),
    );
    const statusRaw = String(raw?.status || '').toUpperCase();
    const status = statusRaw === 'HEALTHY'
      ? 'healthy'
      : statusRaw === 'UNHEALTHY'
        ? 'unhealthy'
        : 'degraded';

    return {
      status,
      timestamp: toIso(raw?.timestamp),
      version: raw?.version ? String(raw.version) : undefined,
      uptime: Number(raw?.uptimeMs || 0),
    };
  }, []);

  const fetchReady = useCallback(async (): Promise<ReadyStatus> => {
    const raw = await fetchApiJson<any>(
      '/ready',
      withProxyApiKey({ cache: 'no-store' }),
    );
    const dependencies = raw?.dependencies || raw?.checks || {};
    const ready = String(raw?.status || '').toUpperCase() === 'READY' || Boolean(raw?.ready);

    return {
      ready,
      timestamp: toIso(raw?.timestamp),
      dependencies,
      reasons: ready ? [] : [String(raw?.message || 'not_ready')],
    };
  }, []);

  const healthPolling = usePolling<HealthStatus>({
    interval: 1000,
    fetcher: fetchHealth,
    maxRetries: 3,
    retryDelay: 500,
  });

  const readyPolling = usePolling<ReadyStatus>({
    interval: 1000,
    fetcher: fetchReady,
    maxRetries: 3,
    retryDelay: 500,
  });

  const refresh = useCallback(async () => {
    await Promise.all([healthPolling.refresh(), readyPolling.refresh()]);
  }, [healthPolling.refresh, readyPolling.refresh]);

  return useMemo(() => {
    const lastUpdatedMs = healthPolling.lastUpdated ?? readyPolling.lastUpdated;
    return {
      health: healthPolling.data ?? null,
      ready: readyPolling.data ?? null,
      isLoading: healthPolling.isLoading || readyPolling.isLoading,
      error: healthPolling.error || readyPolling.error,
      lastUpdated: lastUpdatedMs ? new Date(lastUpdatedMs) : null,
      refresh,
    };
  }, [healthPolling, readyPolling, refresh]);
}
