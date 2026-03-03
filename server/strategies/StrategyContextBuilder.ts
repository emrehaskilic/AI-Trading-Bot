import { RiskState } from '../risk/RiskStateManager';
import { StrategyContext } from './StrategyInterface';

export interface ContextBuilderInput {
  symbol: string;
  timestamp: number;
  price: number;
  m3TrendScore: number;
  m5TrendScore: number;
  obiDeep: number;
  deltaZ: number;
  volatilityIndex: number;
  spreadPct?: number | null;
  printsPerSecond?: number | null;
  position?: {
    side: 'LONG' | 'SHORT' | null;
    qty: number;
    entryPrice: number | null;
    unrealizedPnl?: number | null;
  } | null;
}

export interface ContextBuilderConfig {
  clampTrendScore: boolean;
  clampObi: boolean;
  defaultVolatility: number;
}

export const DEFAULT_CONTEXT_BUILDER_CONFIG: ContextBuilderConfig = {
  clampTrendScore: true,
  clampObi: true,
  defaultVolatility: 0,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function resolveRiskMultiplier(riskState: RiskState): number {
  switch (riskState) {
    case RiskState.TRACKING:
      return 1;
    case RiskState.REDUCED_RISK:
      return 0.5;
    case RiskState.HALTED:
    case RiskState.KILL_SWITCH:
      return 0;
    default:
      return 0;
  }
}

export class StrategyContextBuilder {
  private readonly config: ContextBuilderConfig;

  constructor(config: Partial<ContextBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_BUILDER_CONFIG, ...config };
  }

  build(input: ContextBuilderInput, riskState: RiskState, currentTime: number): StrategyContext {
    const symbol = String(input.symbol || '').toUpperCase();
    if (!symbol) {
      throw new Error('StrategyContextBuilder: symbol is required');
    }

    const timestamp = Number.isFinite(currentTime) && currentTime > 0
      ? Number(currentTime)
      : Number(input.timestamp || 0);
    if (!(timestamp > 0)) {
      throw new Error('StrategyContextBuilder: currentTime must be a positive number');
    }

    const m3 = normalizeNumber(input.m3TrendScore, 0);
    const m5 = normalizeNumber(input.m5TrendScore, 0);
    const obi = normalizeNumber(input.obiDeep, 0);

    return {
      symbol,
      timestamp,
      m3TrendScore: this.config.clampTrendScore ? clamp(m3, -1, 1) : m3,
      m5TrendScore: this.config.clampTrendScore ? clamp(m5, -1, 1) : m5,
      obiDeep: this.config.clampObi ? clamp(obi, -1, 1) : obi,
      deltaZ: normalizeNumber(input.deltaZ, 0),
      volatilityIndex: normalizeNumber(input.volatilityIndex, this.config.defaultVolatility),
      currentPrice: normalizeNumber(input.price, 0),
      marketData: {
        spreadPct: input.spreadPct ?? null,
        printsPerSecond: input.printsPerSecond ?? null,
        riskState,
        riskMultiplier: resolveRiskMultiplier(riskState),
        hasPosition: Boolean(input.position && input.position.side),
        positionSide: input.position?.side ?? null,
        positionQty: normalizeNumber(input.position?.qty ?? 0, 0),
        entryPrice: input.position?.entryPrice ?? null,
        unrealizedPnl: input.position?.unrealizedPnl ?? null,
      },
    };
  }

  getConfig(): ContextBuilderConfig {
    return { ...this.config };
  }
}

export function createContextBuilder(config?: Partial<ContextBuilderConfig>): StrategyContextBuilder {
  return new StrategyContextBuilder(config);
}
