export interface SymbolCapitalConfig {
  symbol: string;
  enabled: boolean;
  walletReserveUsdt: number;
  initialMarginUsdt: number;
  leverage: number;
}

export interface MaterializedSymbolCapitalConfig extends SymbolCapitalConfig {
  reserveScale: number;
  effectiveReserveUsdt: number;
  effectiveInitialMarginUsdt: number;
}

function normalizeSymbol(raw: string): string {
  return String(raw || '').trim().toUpperCase();
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function computeReserveScale(totalWalletUsdt: number, totalConfiguredReserveUsdt: number): number {
  if (!(totalWalletUsdt > 0) || !(totalConfiguredReserveUsdt > 0)) {
    return 1;
  }
  if (totalConfiguredReserveUsdt <= totalWalletUsdt) {
    return 1;
  }
  return totalWalletUsdt / totalConfiguredReserveUsdt;
}

export function normalizeSymbolCapitalConfigs(input: {
  symbols?: string[];
  symbolConfigs?: unknown;
  defaultInitialMarginUsdt: number;
  defaultLeverage: number;
  defaultReserveUsdt?: number;
}): SymbolCapitalConfig[] {
  const rawConfigs = Array.isArray(input.symbolConfigs) ? input.symbolConfigs : [];
  const normalized = new Map<string, SymbolCapitalConfig>();

  for (const raw of rawConfigs) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const symbol = normalizeSymbol(String(row.symbol || ''));
    if (!symbol) continue;

    const enabled = row.enabled == null ? true : Boolean(row.enabled);
    const walletReserveUsdt = Math.max(0, toFiniteNumber(row.walletReserveUsdt, input.defaultReserveUsdt ?? input.defaultInitialMarginUsdt));
    const initialMarginUsdt = Math.max(0, toFiniteNumber(row.initialMarginUsdt, input.defaultInitialMarginUsdt));
    const leverage = Math.max(1, Math.trunc(toFiniteNumber(row.leverage, input.defaultLeverage)));

    normalized.set(symbol, {
      symbol,
      enabled,
      walletReserveUsdt,
      initialMarginUsdt,
      leverage,
    });
  }

  if (normalized.size === 0 && Array.isArray(input.symbols)) {
    const fallbackReserve = Math.max(0, input.defaultReserveUsdt ?? input.defaultInitialMarginUsdt);
    for (const rawSymbol of input.symbols) {
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol || normalized.has(symbol)) continue;
      normalized.set(symbol, {
        symbol,
        enabled: true,
        walletReserveUsdt: fallbackReserve,
        initialMarginUsdt: Math.max(0, input.defaultInitialMarginUsdt),
        leverage: Math.max(1, Math.trunc(input.defaultLeverage)),
      });
    }
  }

  return Array.from(normalized.values()).filter((row) => row.enabled);
}

export function materializeSymbolCapitalConfigs(input: {
  configs: SymbolCapitalConfig[];
  totalWalletUsdt: number;
}): {
  reserveScale: number;
  totalConfiguredReserveUsdt: number;
  totalEffectiveReserveUsdt: number;
  symbolConfigs: MaterializedSymbolCapitalConfig[];
} {
  const totalConfiguredReserveUsdt = input.configs.reduce((sum, row) => sum + Math.max(0, Number(row.walletReserveUsdt || 0)), 0);
  const reserveScale = computeReserveScale(input.totalWalletUsdt, totalConfiguredReserveUsdt);

  const symbolConfigs = input.configs.map((row) => {
    const configuredReserve = Math.max(0, Number(row.walletReserveUsdt || 0));
    const effectiveReserveUsdt = configuredReserve * reserveScale;
    return {
      ...row,
      reserveScale,
      effectiveReserveUsdt,
      effectiveInitialMarginUsdt: Math.min(
        Math.max(0, Number(row.initialMarginUsdt || 0)),
        effectiveReserveUsdt > 0 ? effectiveReserveUsdt : Math.max(0, Number(row.initialMarginUsdt || 0)),
      ),
    };
  });

  return {
    reserveScale,
    totalConfiguredReserveUsdt,
    totalEffectiveReserveUsdt: symbolConfigs.reduce((sum, row) => sum + Math.max(0, row.effectiveReserveUsdt), 0),
    symbolConfigs,
  };
}
