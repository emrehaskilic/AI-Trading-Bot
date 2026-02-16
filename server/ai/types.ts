import { StrategyRegime, StrategySide } from '../types/strategy';

export type AIDryRunConfig = {
  apiKey?: string;
  model?: string;
  decisionIntervalMs: number;
  temperature: number;
  maxOutputTokens: number;
  localOnly?: boolean;
};

export type AIDryRunStatus = {
  active: boolean;
  model: string | null;
  decisionIntervalMs: number;
  temperature: number;
  maxOutputTokens: number;
  apiKeySet: boolean;
  localOnly: boolean;
  lastError: string | null;
  symbols: string[];
};

export type AIMetricsSnapshot = {
  symbol: string;
  timestampMs: number;
  decision: {
    regime: StrategyRegime;
    dfs: number;
    dfsPercentile: number;
    volLevel: number;
    gatePassed: boolean;
    thresholds: {
      longEntry: number;
      longBreak: number;
      shortEntry: number;
      shortBreak: number;
    };
  };
  market: {
    price: number;
    vwap: number;
    spreadPct: number | null;
    delta1s: number;
    delta5s: number;
    deltaZ: number;
    cvdSlope: number;
    obiWeighted: number;
    obiDeep: number;
    obiDivergence: number;
  };
  trades: {
    printsPerSecond: number;
    tradeCount: number;
    aggressiveBuyVolume: number;
    aggressiveSellVolume: number;
    burstCount: number;
    burstSide: 'buy' | 'sell' | null;
  };
  openInterest: {
    oiChangePct: number | null;
  };
  absorption: {
    value: number;
    side: 'buy' | 'sell' | null;
  };
  volatility: number;
  position: {
    side: StrategySide;
    qty: number;
    entryPrice: number;
    unrealizedPnlPct: number;
    addsUsed: number;
  } | null;
};

export type AIAction = {
  action: 'HOLD' | 'ENTRY' | 'EXIT' | 'REDUCE' | 'ADD';
  side?: 'LONG' | 'SHORT';
  sizeMultiplier?: number;
  reducePct?: number;
  reason?: string;
};
