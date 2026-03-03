import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { withProxyApiKey } from '../services/proxyAuth';

export type SignalDirection = 'buy' | 'sell' | 'neutral';
export type SignalStrength = 'strong' | 'moderate' | 'weak';

export interface StrategySignal {
  id: string;
  timestamp: string;
  strategy: string;
  direction: SignalDirection;
  strength: SignalStrength;
  confidence: number;
  symbol: string;
  price: number;
  metadata?: Record<string, unknown>;
}

export interface ConsensusDecision {
  timestamp: string;
  direction: SignalDirection;
  confidence: number;
  agreementRatio: number;
  participatingStrategies: string[];
  conflictingStrategies: string[];
  weightedScore: number;
  executionRecommended: boolean;
}

export interface StrategySnapshot {
  timestamp: string;
  consensus: ConsensusDecision;
  signals: StrategySignal[];
  activeStrategies: string[];
  strategyHealth: Record<string, { healthy: boolean; lastSignal: string }>;
}

interface BackendStrategySnapshot {
  timestamp: number;
  consensus: {
    side: 'LONG' | 'SHORT' | 'FLAT';
    confidence: number;
    quorumMet: boolean;
    riskGatePassed: boolean;
    contributingStrategies: number;
    totalStrategies: number;
    strategyIds: string[];
  } | null;
  signals: Array<{
    strategyId: string;
    side: 'LONG' | 'SHORT' | 'FLAT';
    confidence: number;
    timestamp: number;
    metadata?: Record<string, unknown>;
  }>;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function toDirection(side: 'LONG' | 'SHORT' | 'FLAT'): SignalDirection {
  if (side === 'LONG') return 'buy';
  if (side === 'SHORT') return 'sell';
  return 'neutral';
}

function toStrength(confidence: number): SignalStrength {
  if (confidence >= 0.75) return 'strong';
  if (confidence >= 0.45) return 'moderate';
  return 'weak';
}

export function useStrategy(): {
  data: StrategySnapshot | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  getSignalsByStrategy: (strategy: string) => StrategySignal[];
  getSignalsByDirection: (direction: SignalDirection) => StrategySignal[];
} {
  const fetchStrategy = useCallback(async (): Promise<StrategySnapshot> => {
    const response = await fetch(
      `${API_BASE_URL}/api/strategy/snapshot`,
      withProxyApiKey({ cache: 'no-store' }),
    );
    if (!response.ok) {
      throw new Error(`Strategy fetch failed: ${response.status} ${response.statusText}`);
    }

    const raw = (await response.json()) as BackendStrategySnapshot;
    const signals: StrategySignal[] = (raw.signals || []).map((signal) => {
      const direction = toDirection(signal.side);
      const metadata = signal.metadata || {};
      const symbol = typeof metadata.symbol === 'string' ? String(metadata.symbol) : 'N/A';
      const price = Number(metadata.price ?? metadata.markPrice ?? 0);
      return {
        id: `${signal.strategyId}-${signal.timestamp}`,
        timestamp: new Date(signal.timestamp).toISOString(),
        strategy: signal.strategyId,
        direction,
        strength: toStrength(Number(signal.confidence || 0)),
        confidence: Number(signal.confidence || 0),
        symbol,
        price: Number.isFinite(price) ? price : 0,
        metadata,
      };
    });

    const consensus = raw.consensus;
    const consensusDirection = consensus ? toDirection(consensus.side) : 'neutral';
    const agreementRatio = consensus && consensus.totalStrategies > 0
      ? consensus.contributingStrategies / consensus.totalStrategies
      : 0;

    const activeStrategies = Array.from(new Set(signals.map((s) => s.strategy)));
    const strategyHealth: Record<string, { healthy: boolean; lastSignal: string }> = {};
    for (const strategyId of activeStrategies) {
      const latest = signals
        .filter((signal) => signal.strategy === strategyId)
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
      strategyHealth[strategyId] = {
        healthy: Boolean(latest),
        lastSignal: latest?.timestamp || new Date(0).toISOString(),
      };
    }

    return {
      timestamp: new Date(raw.timestamp).toISOString(),
      consensus: {
        timestamp: new Date(raw.timestamp).toISOString(),
        direction: consensusDirection,
        confidence: Number(consensus?.confidence || 0),
        agreementRatio,
        participatingStrategies: consensus?.strategyIds || activeStrategies,
        conflictingStrategies: [],
        weightedScore: Number(consensus?.confidence || 0),
        executionRecommended: Boolean(consensus?.quorumMet && consensus?.riskGatePassed && consensus?.side !== 'FLAT'),
      },
      signals,
      activeStrategies,
      strategyHealth,
    };
  }, []);

  const polling = usePolling<StrategySnapshot>({
    interval: 2000,
    fetcher: fetchStrategy,
    maxRetries: 2,
    retryDelay: 1000,
  });

  const getSignalsByStrategy = useCallback((strategy: string): StrategySignal[] => {
    return polling.data?.signals.filter((s) => s.strategy === strategy) ?? [];
  }, [polling.data?.signals]);

  const getSignalsByDirection = useCallback((direction: SignalDirection): StrategySignal[] => {
    return polling.data?.signals.filter((s) => s.direction === direction) ?? [];
  }, [polling.data?.signals]);

  return useMemo(() => ({
    data: polling.data ?? null,
    isLoading: polling.isLoading,
    error: polling.error,
    lastUpdated: polling.lastUpdated ? new Date(polling.lastUpdated) : null,
    refresh: polling.refresh,
    getSignalsByStrategy,
    getSignalsByDirection,
  }), [polling, getSignalsByStrategy, getSignalsByDirection]);
}
