import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiJson } from '../services/apiFetch';
import { DryRunStatus, SymbolCapitalConfig } from '../api/types';

interface BackendDryRunStatusResponse {
  ok: boolean;
  status: DryRunStatus;
}

export interface DryRunStatusSnapshot {
  running: boolean;
  runId: string | null;
  symbols: string[];
  config: DryRunStatus['config'];
  summary: {
    totalEquity: number;
    walletBalance: number;
    unrealizedPnl: number;
    realizedPnl: number;
    feePaid: number;
    fundingPnl: number;
    marginHealth: number;
  };
  perSymbol: DryRunStatus['perSymbol'];
  openPositions: number;
  activePositionSymbols: string[];
  symbolConfigs: SymbolCapitalConfig[];
}

export function useDryRunStatus(): {
  data: DryRunStatusSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
} {
  const fetchDryRunStatus = useCallback(async (): Promise<DryRunStatusSnapshot> => {
    const raw = await fetchApiJson<BackendDryRunStatusResponse>(
      '/api/dry-run/status',
      withProxyApiKey({ cache: 'no-store' }),
    );
    const status = raw?.status;
    const perSymbol = status?.perSymbol && typeof status.perSymbol === 'object' ? status.perSymbol : {};
    const activePositionSymbols = Object.entries(perSymbol)
      .filter(([, symbolStatus]) => Math.abs(Number(symbolStatus?.position?.qty || 0)) > 0)
      .map(([symbol]) => symbol);

    return {
      running: Boolean(status?.running),
      runId: status?.runId || null,
      symbols: Array.isArray(status?.symbols) ? status.symbols : [],
      config: status?.config || null,
      summary: {
        totalEquity: 0,
        walletBalance: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        feePaid: 0,
        fundingPnl: 0,
        marginHealth: 0,
        ...(status?.summary || {}),
      },
      perSymbol,
      openPositions: activePositionSymbols.length,
      activePositionSymbols,
      symbolConfigs: Array.isArray(status?.config?.symbolConfigs) ? status.config.symbolConfigs : [],
    };
  }, []);

  const polling = usePolling<DryRunStatusSnapshot>({
    interval: 1000,
    fetcher: fetchDryRunStatus,
    maxRetries: 2,
    retryDelay: 500,
  });

  return useMemo(() => ({
    data: polling.data ?? null,
    isLoading: polling.isLoading,
    error: polling.error,
    lastUpdated: polling.lastUpdated ? new Date(polling.lastUpdated) : null,
    refresh: polling.refresh,
  }), [polling]);
}
