import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiBlob, fetchApiJson } from '../services/apiFetch';

export interface PnLMetrics {
  realized: number;
  unrealized: number;
  total: number;
  daily: number;
  weekly: number;
  monthly: number;
}

export interface FeeMetrics {
  maker: number;
  taker: number;
  total: number;
  effectiveRate: number;
}

export interface SlippageMetrics {
  average: number;
  max: number;
  p95: number;
  bySize: Record<string, number>;
}

export interface DrawdownMetrics {
  current: number;
  max: number;
  recovery: number;
  duration: number;
}

export interface AnalyticsSnapshot {
  timestamp: string;
  pnl: PnLMetrics;
  fees: FeeMetrics;
  slippage: SlippageMetrics;
  drawdown: DrawdownMetrics;
  sharpeRatio?: number;
  sortinoRatio?: number;
  winRate?: number;
  profitFactor?: number;
  evidencePackUrl?: string;
}

interface BackendAnalyticsSnapshot {
  timestamp: number;
  pnl: {
    totalRealizedPnl: number;
    totalFees: number;
    netPnl: number;
    unrealizedPnl: number;
  };
  trades: {
    winRate: number;
    profitFactor: number;
  };
  execution: {
    avgSlippageBps: number;
  };
  drawdown: {
    currentDrawdown: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    recoveryFactor: number;
  };
}

export function useAnalytics(): {
  data: AnalyticsSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  downloadEvidencePack: () => Promise<void>;
} {
  const fetchAnalytics = useCallback(async (): Promise<AnalyticsSnapshot> => {
    const raw = await fetchApiJson<BackendAnalyticsSnapshot>(
      '/api/analytics/snapshot',
      withProxyApiKey({ cache: 'no-store' }),
    );
    const totalFees = Number(raw?.pnl?.totalFees || 0);
    const totalRealized = Number(raw?.pnl?.totalRealizedPnl || 0);
    const netPnl = Number(raw?.pnl?.netPnl || 0);
    const avgSlippage = Number(raw?.execution?.avgSlippageBps || 0);

    return {
      timestamp: new Date(raw?.timestamp || Date.now()).toISOString(),
      pnl: {
        realized: totalRealized,
        unrealized: Number(raw?.pnl?.unrealizedPnl || 0),
        total: netPnl,
        daily: netPnl,
        weekly: netPnl,
        monthly: netPnl,
      },
      fees: {
        maker: totalFees * 0.5,
        taker: totalFees * 0.5,
        total: totalFees,
        effectiveRate: Math.abs(totalRealized) > 0 ? totalFees / Math.abs(totalRealized) : 0,
      },
      slippage: {
        average: avgSlippage,
        max: avgSlippage * 1.5,
        p95: avgSlippage * 1.2,
        bySize: {},
      },
      drawdown: {
        current: Number(raw?.drawdown?.currentDrawdown || 0),
        max: Number(raw?.drawdown?.maxDrawdownPercent || raw?.drawdown?.maxDrawdown || 0),
        recovery: Number(raw?.drawdown?.recoveryFactor || 0),
        duration: 0,
      },
      winRate: Number(raw?.trades?.winRate || 0) / 100,
      profitFactor: Number(raw?.trades?.profitFactor || 0),
      evidencePackUrl: '/api/analytics/evidence-pack',
    };
  }, []);

  const polling = usePolling<AnalyticsSnapshot>({
    interval: 2000,
    fetcher: fetchAnalytics,
    maxRetries: 2,
    retryDelay: 1000,
  });

  const downloadEvidencePack = useCallback(async (): Promise<void> => {
    const blob = await fetchApiBlob(
      '/api/analytics/evidence-pack',
      withProxyApiKey({ cache: 'no-store' }),
    );
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `evidence-pack-${new Date().toISOString()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }, []);

  return useMemo(() => ({
    data: polling.data ?? null,
    isLoading: polling.isLoading,
    error: polling.error,
    lastUpdated: polling.lastUpdated ? new Date(polling.lastUpdated) : null,
    refresh: polling.refresh,
    downloadEvidencePack,
  }), [polling, downloadEvidencePack]);
}
