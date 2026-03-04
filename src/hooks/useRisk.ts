import { useCallback, useMemo } from 'react';
import { usePolling } from './usePolling';
import { withProxyApiKey } from '../services/proxyAuth';
import { fetchApiJson } from '../services/apiFetch';

export type RiskState = 'normal' | 'elevated' | 'high' | 'critical' | 'kill_switch';
export type TradingMode = 'normal' | 'reduced' | 'paused' | 'emergency_close';

export interface RiskLimits {
  maxPositionSize: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  maxLeverage: number;
}

export interface RiskExposure {
  totalPosition: number;
  marginUsed: number;
  availableMargin: number;
  leverage: number;
  concentration: number;
}

export interface RiskSnapshot {
  timestamp: string;
  state: RiskState;
  tradingMode: TradingMode;
  killSwitchActive: boolean;
  killSwitchReason?: string;
  limits: RiskLimits;
  exposure: RiskExposure;
  utilization: {
    position: number;
    dailyLoss: number;
    drawdown: number;
    leverage: number;
  };
  alerts: Array<{
    level: 'warning' | 'critical';
    message: string;
    timestamp: string;
  }>;
}

interface BackendRiskSnapshot {
  timestamp: number;
  state: {
    current: 'TRACKING' | 'REDUCED_RISK' | 'HALTED' | 'KILL_SWITCH';
    canTrade: boolean;
    canOpenPosition: boolean;
    isReducedRisk: boolean;
    positionSizeMultiplier: number;
  };
  limits: {
    maxPositionNotional: number;
    maxLeverage: number;
    maxPositionQty: number;
    dailyLossLimit: number;
    reducedRiskPositionMultiplier: number;
  };
  triggers: {
    recentTriggers: Array<{ reason: string; timestamp: number }>;
  };
  killSwitch: {
    active: boolean;
    reason: string | null;
  };
  exposure: {
    totalPositionNotional: number;
    totalMarginUsed: number;
    availableMargin: number;
    marginUtilizationPercent: number;
  };
}

function mapState(state: BackendRiskSnapshot['state']['current']): RiskState {
  if (state === 'KILL_SWITCH') return 'kill_switch';
  if (state === 'HALTED') return 'critical';
  if (state === 'REDUCED_RISK') return 'elevated';
  return 'normal';
}

function mapTradingMode(raw: BackendRiskSnapshot): TradingMode {
  if (raw?.killSwitch?.active || raw?.state?.current === 'KILL_SWITCH') return 'emergency_close';
  if (!raw?.state?.canTrade) return 'paused';
  if (raw?.state?.isReducedRisk || raw?.state?.current === 'REDUCED_RISK') return 'reduced';
  return 'normal';
}

export function useRisk(): {
  data: RiskSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  isKillSwitchActive: boolean;
  canTrade: boolean;
} {
  const fetchRisk = useCallback(async (): Promise<RiskSnapshot> => {
    const raw = await fetchApiJson<BackendRiskSnapshot>(
      '/api/risk/snapshot',
      withProxyApiKey({ cache: 'no-store' }),
    );
    const rawStateCurrent = raw?.state?.current || 'TRACKING';
    const state = mapState(rawStateCurrent as BackendRiskSnapshot['state']['current']);
    const tradingMode = mapTradingMode(raw);

    return {
      timestamp: new Date(raw.timestamp).toISOString(),
      state,
      tradingMode,
      killSwitchActive: Boolean(raw?.killSwitch?.active),
      killSwitchReason: raw?.killSwitch?.reason || undefined,
      limits: {
        maxPositionSize: Number(raw?.limits?.maxPositionNotional || 0),
        maxDailyLoss: Number(raw?.limits?.dailyLossLimit || 0),
        maxDrawdown: Number(raw?.limits?.reducedRiskPositionMultiplier || 0),
        maxLeverage: Number(raw?.limits?.maxLeverage || 0),
      },
      exposure: {
        totalPosition: Number(raw?.exposure?.totalPositionNotional || 0),
        marginUsed: Number(raw?.exposure?.totalMarginUsed || 0),
        availableMargin: Number(raw?.exposure?.availableMargin || 0),
        leverage: Number(raw?.limits?.maxLeverage || 0),
        concentration: Number(raw?.exposure?.marginUtilizationPercent || 0) / 100,
      },
      utilization: {
        position: Number(raw?.exposure?.marginUtilizationPercent || 0) / 100,
        dailyLoss: 0,
        drawdown: rawStateCurrent === 'REDUCED_RISK' ? 0.5 : rawStateCurrent === 'HALTED' ? 1 : 0,
        leverage: Number(raw?.limits?.maxLeverage || 0) > 0
          ? Number(raw?.exposure?.totalMarginUsed || 0) / Math.max(1, Number(raw?.limits?.maxLeverage || 1))
          : 0,
      },
      alerts: ((raw?.triggers?.recentTriggers) || []).slice(-5).map((trigger) => ({
        level: state === 'critical' || state === 'kill_switch' ? 'critical' : 'warning',
        message: String(trigger.reason || 'risk_triggered'),
        timestamp: new Date(trigger.timestamp || raw.timestamp).toISOString(),
      })),
    };
  }, []);

  const polling = usePolling<RiskSnapshot>({
    interval: 1000,
    fetcher: fetchRisk,
    maxRetries: 3,
    retryDelay: 500,
  });

  const isKillSwitchActive = useMemo(() => {
    return polling.data?.killSwitchActive ?? false;
  }, [polling.data?.killSwitchActive]);

  const canTrade = useMemo(() => {
    if (!polling.data) return false;
    return polling.data.tradingMode === 'normal' || polling.data.tradingMode === 'reduced';
  }, [polling.data]);

  return useMemo(() => ({
    data: polling.data ?? null,
    isLoading: polling.isLoading,
    error: polling.error,
    lastUpdated: polling.lastUpdated ? new Date(polling.lastUpdated) : null,
    refresh: polling.refresh,
    isKillSwitchActive,
    canTrade,
  }), [polling, isKillSwitchActive, canTrade]);
}
