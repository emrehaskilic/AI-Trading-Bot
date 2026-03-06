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
  currentPercent: number;
  maxPercent: number;
  recovery: number;
  duration: number;
}

export interface OpenPositionSummary {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  qty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  notionalValue: number;
}

export interface AnalyticsSnapshot {
  timestamp: string;
  source: 'analytics' | 'dry_run_fallback';
  pnl: PnLMetrics;
  fees: FeeMetrics;
  slippage: SlippageMetrics;
  drawdown: DrawdownMetrics;
  totalTrades?: number;
  openPositions?: number;
  avgReturnPerTradePct?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  winRate?: number;
  profitFactor?: number;
  positions?: OpenPositionSummary[];
  evidencePackUrl?: string;
}

interface BackendAnalyticsSnapshot {
  timestamp: number;
  source?: 'analytics' | 'dry_run_fallback';
  pnl: {
    totalRealizedPnl: number;
    totalFees: number;
    netPnl: number;
    unrealizedPnl: number;
  };
  fees?: {
    makerFees: number;
    takerFees: number;
    totalFees: number;
    effectiveRate: number;
  };
  trades: {
    totalTrades: number;
    openPositions: number;
    avgTradePnl: number;
    avgReturnPerTradePct: number;
    winRate: number;
    profitFactor: number;
  };
  execution: {
    avgSlippageBps: number;
    p95SlippageBps: number;
    maxSlippageBps: number;
    slippageSamples: number;
  };
  drawdown: {
    currentDrawdown: number;
    currentDrawdownPercent: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    recoveryFactor: number;
  };
  performance?: {
    sharpeRatio: number;
    sortinoRatio: number;
    expectancy: number;
  };
  positions?: OpenPositionSummary[];
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
    const makerFees = Number(raw?.fees?.makerFees ?? totalFees * 0.5);
    const takerFees = Number(raw?.fees?.takerFees ?? totalFees * 0.5);

    return {
      timestamp: new Date(raw?.timestamp || Date.now()).toISOString(),
      source: raw?.source === 'dry_run_fallback' ? 'dry_run_fallback' : 'analytics',
      pnl: {
        realized: totalRealized,
        unrealized: Number(raw?.pnl?.unrealizedPnl || 0),
        total: netPnl,
        daily: netPnl,
        weekly: netPnl,
        monthly: netPnl,
      },
      fees: {
        maker: makerFees,
        taker: takerFees,
        total: totalFees,
        effectiveRate: Number(raw?.fees?.effectiveRate ?? (Math.abs(totalRealized) > 0 ? totalFees / Math.abs(totalRealized) : 0)),
      },
      slippage: {
        average: avgSlippage,
        max: Number(raw?.execution?.maxSlippageBps || 0),
        p95: Number(raw?.execution?.p95SlippageBps || 0),
        bySize: {},
      },
      drawdown: {
        current: Number(raw?.drawdown?.currentDrawdown || 0),
        max: Number(raw?.drawdown?.maxDrawdown || 0),
        currentPercent: Number(raw?.drawdown?.currentDrawdownPercent || 0),
        maxPercent: Number(raw?.drawdown?.maxDrawdownPercent || 0),
        recovery: Number(raw?.drawdown?.recoveryFactor || 0),
        duration: 0,
      },
      totalTrades: Number(raw?.trades?.totalTrades || 0),
      openPositions: Number(raw?.trades?.openPositions || 0),
      avgReturnPerTradePct: Number(raw?.trades?.avgReturnPerTradePct || 0),
      winRate: Number(raw?.trades?.winRate || 0) / 100,
      profitFactor: Number(raw?.trades?.profitFactor || 0),
      sharpeRatio: Number(raw?.performance?.sharpeRatio || 0),
      sortinoRatio: Number(raw?.performance?.sortinoRatio || 0),
      positions: Array.isArray(raw?.positions) ? raw.positions : [],
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
