import React, { useEffect, useMemo, useState } from 'react';
import SymbolRow from './SymbolRow';
import MobileSymbolCard from './MobileSymbolCard';
import PairCapitalTable from './PairCapitalTable';
import { SymbolCapitalConfig } from '../api/types';
import { TelemetrySocketStatus, useTelemetrySocket } from '../services/useTelemetrySocket';
import { withProxyApiKey } from '../services/proxyAuth';
import { getProxyApiBase } from '../services/proxyBase';
import { MetricsMessage } from '../types/metrics';

interface DryRunConsoleLog {
  seq: number;
  timestampMs: number;
  symbol: string | null;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

interface DryRunStatus {
  running: boolean;
  runId: string | null;
  symbols: string[];
  config: {
    sharedWalletStartUsdt: number;
    reserveScale: number;
    totalConfiguredReserveUsdt: number;
    totalEffectiveReserveUsdt: number;
    takerFeeRate: number;
    maintenanceMarginRate: number;
    fundingIntervalMs: number;
    heartbeatIntervalMs: number;
    startupMode?: 'WAIT_MICRO_WARMUP';
    symbolConfigs: SymbolCapitalConfig[];
  } | null;
  summary: {
    totalEquity: number;
    walletBalance: number;
    unrealizedPnl: number;
    realizedPnl: number;
    feePaid: number;
    fundingPnl: number;
    marginHealth: number;
    performance?: {
      totalPnL: number;
      winCount: number;
      lossCount: number;
      totalTrades: number;
      winRate: number;
      maxDrawdown: number;
      sharpeRatio: number;
      pnlCurve: Array<{ timestamp: number; pnl: number }>;
    };
  };
  perSymbol: Record<string, {
    symbol: string;
    capital?: {
      configuredReserveUsdt: number;
      effectiveReserveUsdt: number;
      initialMarginUsdt: number;
      leverage: number;
      reserveScale: number;
    };
    warmup?: {
      bootstrapDone: boolean;
      bootstrapBars1m: number;
      htfReady: boolean;
      orderflow1mReady: boolean;
      orderflow5mReady: boolean;
      orderflow15mReady: boolean;
      tradeReady: boolean;
      addonReady: boolean;
      vetoReason: string | null;
    };
    trend?: {
      state: 'UPTREND' | 'DOWNTREND' | 'PULLBACK_UP' | 'PULLBACK_DOWN' | 'RANGE' | 'EXHAUSTION_UP' | 'EXHAUSTION_DOWN';
      confidence: number;
      bias15m: 'UP' | 'DOWN' | 'NEUTRAL';
      veto1h: 'NONE' | 'UP' | 'DOWN' | 'EXHAUSTION';
    };
    metrics: {
      markPrice: number;
      totalEquity: number;
      walletBalance: number;
      unrealizedPnl: number;
      realizedPnl: number;
      feePaid: number;
      fundingPnl: number;
      marginHealth: number;
    };
    performance?: {
      totalPnL: number;
      winCount: number;
      lossCount: number;
      totalTrades: number;
      winRate: number;
      maxDrawdown: number;
      sharpeRatio: number;
      pnlCurve: Array<{ timestamp: number; pnl: number }>;
    };
    risk?: {
      winStreak: number;
      lossStreak: number;
      dynamicLeverage: number;
      stopLossPrice: number | null;
      liquidationRisk?: {
        score: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'CRITICAL';
        timeToLiquidationMs: number | null;
        fundingRateImpact: number;
      };
    };
    position: {
      side: 'LONG' | 'SHORT';
      qty: number;
      notionalUsdt: number;
      entryPrice: number;
      breakEvenPrice: number | null;
      markPrice: number;
      unrealizedPnl: number;
      realizedPnl: number;
      netPnl: number;
      liqPrice: null;
    } | null;
    openLimitOrders: Array<{
      orderId: string;
      side: 'BUY' | 'SELL';
      price: number;
      remainingQty: number;
      reduceOnly: boolean;
      createdTsMs: number;
    }>;
    lastEventTimestampMs: number;
    eventCount: number;
    warnings?: string[];
  }>;
  logTail: DryRunConsoleLog[];
  alphaDecay: Array<{
    signalType: string;
    avgValidityMs: number;
    alphaDecayHalfLife: number;
    optimalEntryWindow: [number, number];
    optimalExitWindow: [number, number];
    sampleCount: number;
  }>;
}

const DEFAULT_STATUS: DryRunStatus = {
  running: false,
  runId: null,
  symbols: [],
  config: null,
  summary: {
    totalEquity: 0,
    walletBalance: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    feePaid: 0,
    fundingPnl: 0,
    marginHealth: 0,
    performance: {
      totalPnL: 0,
      winCount: 0,
      lossCount: 0,
      totalTrades: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      pnlCurve: [],
    },
  },
  perSymbol: {},
  logTail: [],
  alphaDecay: [],
};

const formatNum = (n: number, d = 2): string => n.toLocaleString(undefined, {
  minimumFractionDigits: d,
  maximumFractionDigits: d,
});

const formatTs = (ts: number): string => {
  if (!(ts > 0)) return '-';
  return new Date(ts).toLocaleTimeString();
};

const normalizeSymbol = (value: string): string => String(value || '').trim().toUpperCase();

const normalizeSymbolList = (values: string[]): string[] => {
  const unique = new Set<string>();
  for (const raw of values) {
    const symbol = normalizeSymbol(raw);
    if (symbol) {
      unique.add(symbol);
    }
  }
  return [...unique];
};

const buildDefaultSymbolCapitalConfig = (symbol: string, sharedWalletStartUsdt: number): SymbolCapitalConfig => ({
  symbol,
  enabled: true,
  walletReserveUsdt: Math.max(0, sharedWalletStartUsdt / 4),
  initialMarginUsdt: Math.max(25, sharedWalletStartUsdt / 20),
  leverage: 10,
});

const DryRunDashboard: React.FC = () => {
  const proxyUrl = getProxyApiBase();
  const fetchWithAuth = (url: string, init?: RequestInit) => fetch(url, withProxyApiKey(init));

  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [isLoadingPairs, setIsLoadingPairs] = useState(true);
  const [selectedPairs, setSelectedPairs] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setDropdownOpen] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<DryRunStatus>(DEFAULT_STATUS);

  const [sharedWalletStart, setSharedWalletStart] = useState('5000');
  const [pairConfigs, setPairConfigs] = useState<Record<string, SymbolCapitalConfig>>({});
  const [heartbeatSec, setHeartbeatSec] = useState('10');
  const [isRefreshingPositions, setIsRefreshingPositions] = useState(false);
  const [telemetryWsStatus, setTelemetryWsStatus] = useState<TelemetrySocketStatus>('connecting');

  const [testOrderSymbol, setTestOrderSymbol] = useState('BTCUSDT');

  const activeMetricSymbols = useMemo(() => {
    const source = status.running && status.symbols.length > 0 ? status.symbols : selectedPairs;
    return normalizeSymbolList(source);
  }, [status.running, status.symbols, selectedPairs]);
  const configuredRows = useMemo(() => {
    const wallet = Math.max(0, Number(sharedWalletStart) || 0);
    return selectedPairs.map((symbol) => pairConfigs[symbol] || buildDefaultSymbolCapitalConfig(symbol, wallet));
  }, [pairConfigs, selectedPairs, sharedWalletStart]);
  const marketData = useTelemetrySocket(activeMetricSymbols, setTelemetryWsStatus);

  useEffect(() => {
    const loadPairs = async () => {
      setIsLoadingPairs(true);
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetchWithAuth(`${proxyUrl}/api/dry-run/symbols`, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`symbols_http_${res.status}`);
        }
        const data = await res.json();
        const pairs = Array.isArray(data?.symbols)
          ? normalizeSymbolList(data.symbols.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0))
          : [];
        if (pairs.length === 0) {
          throw new Error('symbols_empty');
        }
        try {
          window.localStorage.setItem('orderflow.symbols.cache', JSON.stringify(pairs));
        } catch {
          // Ignore storage failures (private mode/quota).
        }
        setAvailablePairs(pairs);
        if (pairs.length > 0) {
          setSelectedPairs((prev) => {
            const valid = prev.filter((s) => pairs.includes(s));
            if (valid.length > 0) return valid;
            return [pairs[0]];
          });
        }
      } catch {
        let fallbackPairs: string[] = [];
        try {
          const cachedRaw = window.localStorage.getItem('orderflow.symbols.cache');
          const cachedParsed = cachedRaw ? JSON.parse(cachedRaw) : [];
          if (Array.isArray(cachedParsed)) {
            fallbackPairs = normalizeSymbolList(cachedParsed.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0));
          }
        } catch {
          fallbackPairs = [];
        }
        if (fallbackPairs.length === 0) {
          fallbackPairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        }
        setAvailablePairs(fallbackPairs);
        setSelectedPairs((prev) => {
          const valid = prev.filter((s) => fallbackPairs.includes(s));
          if (valid.length > 0) return valid;
          return [fallbackPairs[0]];
        });
      } finally {
        window.clearTimeout(timer);
        setIsLoadingPairs(false);
      }
    };

    loadPairs();
  }, [proxyUrl]);

  useEffect(() => {
    const wallet = Math.max(0, Number(sharedWalletStart) || 0);
    setPairConfigs((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const symbol of selectedPairs) {
        if (!next[symbol]) {
          next[symbol] = buildDefaultSymbolCapitalConfig(symbol, wallet);
          changed = true;
        }
      }
      for (const symbol of Object.keys(next)) {
        if (!selectedPairs.includes(symbol)) {
          delete next[symbol];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedPairs, sharedWalletStart]);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await fetchWithAuth(`${proxyUrl}/api/dry-run/status`, { cache: 'no-store' });
        const data = await res.json();
        if (!active) return;
        if (res.ok && data?.status) {
          const next = data.status as DryRunStatus;
          setStatus(next);
          if (next.running && next.symbols.length > 0) {
            const normalized = normalizeSymbolList(next.symbols);
            setSelectedPairs(normalized);
            setTestOrderSymbol(normalized[0]);
          } else if (!next.running && next.config) {
            setSharedWalletStart(String(next.config.sharedWalletStartUsdt));
            setHeartbeatSec(String(Math.max(1, Math.round(next.config.heartbeatIntervalMs / 1000))));
            const nextConfigs: Record<string, SymbolCapitalConfig> = {};
            for (const config of next.config.symbolConfigs || []) {
              nextConfigs[config.symbol] = config;
            }
            if (Object.keys(nextConfigs).length > 0) {
              setPairConfigs(nextConfigs);
              setSelectedPairs(Object.keys(nextConfigs));
            }
          }
        }
      } catch {
        // keep last known state
      }
    };

    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [proxyUrl]);

  useEffect(() => {
    if (activeMetricSymbols.length > 0 && !activeMetricSymbols.includes(testOrderSymbol)) {
      setTestOrderSymbol(activeMetricSymbols[0]);
    }
  }, [activeMetricSymbols, testOrderSymbol]);

  const filteredPairs = useMemo(
    () => availablePairs.filter((p) => p.includes(searchTerm.toUpperCase())),
    [availablePairs, searchTerm]
  );

  const togglePair = (pair: string) => {
    const normalizedPair = normalizeSymbol(pair);
    if (!normalizedPair) return;
    setSelectedPairs((prev) => {
      if (prev.includes(normalizedPair)) {
        return prev.filter((p) => p !== normalizedPair);
      }
      return [...prev, normalizedPair];
    });
  };

  const updatePairConfig = (symbol: string, patch: Partial<SymbolCapitalConfig>) => {
    const wallet = Math.max(0, Number(sharedWalletStart) || 0);
    setPairConfigs((prev) => ({
      ...prev,
      [symbol]: {
        ...(prev[symbol] || buildDefaultSymbolCapitalConfig(symbol, wallet)),
        ...patch,
        symbol,
      },
    }));
  };

  const startDryRun = async () => {
    setActionError(null);
    try {
      if (selectedPairs.length === 0) {
        throw new Error('at_least_one_pair_required');
      }
      const res = await fetchWithAuth(`${proxyUrl}/api/dry-run/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: selectedPairs,
          sharedWalletStartUsdt: Number(sharedWalletStart),
          symbolConfigs: configuredRows,
          heartbeatIntervalMs: Math.max(1000, Number(heartbeatSec) * 1000),
          startupMode: 'WAIT_MICRO_WARMUP',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'dry_run_start_failed');
      }
      setStatus((data?.status || DEFAULT_STATUS) as DryRunStatus);
    } catch (e: any) {
      setActionError(e?.message || 'dry_run_start_failed');
    }
  };

  const stopDryRun = async () => {
    setActionError(null);
    try {
      const res = await fetchWithAuth(`${proxyUrl}/api/dry-run/stop`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'dry_run_stop_failed');
      setStatus((data?.status || DEFAULT_STATUS) as DryRunStatus);
    } catch (e: any) {
      setActionError(e?.message || 'dry_run_stop_failed');
    }
  };

  const resetDryRun = async () => {
    setActionError(null);
    try {
      const res = await fetchWithAuth(`${proxyUrl}/api/dry-run/reset`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'dry_run_reset_failed');
      setStatus((data?.status || DEFAULT_STATUS) as DryRunStatus);
    } catch (e: any) {
      setActionError(e?.message || 'dry_run_reset_failed');
    }
  };

  const refreshPositions = async () => {
    setActionError(null);
    setIsRefreshingPositions(true);
    try {
      const res = await fetchWithAuth(`${proxyUrl}/api/dry-run/status`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data?.status) {
        throw new Error(data?.error || 'dry_run_status_failed');
      }
      setStatus(data.status as DryRunStatus);
    } catch (e: any) {
      setActionError(e?.message || 'dry_run_status_failed');
    } finally {
      setIsRefreshingPositions(false);
    }
  };

  const sendTestOrder = async (side: 'BUY' | 'SELL') => {
    setActionError(null);
    try {
      if (!status.running) {
        throw new Error('dry_run_not_running');
      }
      const symbol = testOrderSymbol || status.symbols[0];
      if (!symbol) {
        throw new Error('symbol_required');
      }
      const res = await fetchWithAuth(`${proxyUrl}/api/dry-run/test-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, side }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'dry_run_test_order_failed');
      setStatus((data?.status || DEFAULT_STATUS) as DryRunStatus);
    } catch (e: any) {
      setActionError(e?.message || 'dry_run_test_order_failed');
    }
  };

  const summary = status.summary;
  const perf = summary.performance || DEFAULT_STATUS.summary.performance!;
  const marginHealthPct = summary.marginHealth * 100;
  const symbolRows = useMemo(() => Object.values(status.perSymbol), [status.perSymbol]);
  const configuredReserveTotal = useMemo(
    () => configuredRows.reduce((sum, row) => sum + Math.max(0, Number(row.walletReserveUsdt || 0)), 0),
    [configuredRows],
  );
  const sharedWalletNumeric = Math.max(0, Number(sharedWalletStart) || 0);
  const reserveScalePreview = configuredReserveTotal > 0 && configuredReserveTotal > sharedWalletNumeric
    ? sharedWalletNumeric / configuredReserveTotal
    : 1;
  const pairRuntime = useMemo(() => {
    const next: Record<string, {
      capital?: DryRunStatus['perSymbol'][string]['capital'];
      warmup?: DryRunStatus['perSymbol'][string]['warmup'];
      trend?: DryRunStatus['perSymbol'][string]['trend'];
      warnings?: string[];
    }> = {};
    Object.entries(status.perSymbol).forEach(([symbol, row]) => {
      next[symbol] = {
        capital: row.capital,
        warmup: row.warmup,
        trend: row.trend,
        warnings: row.warnings,
      };
    });
    return next;
  }, [status.perSymbol]);
  const resolvedMarketData = useMemo(() => {
    const next: Record<string, MetricsMessage> = {};

    for (const rawSymbol of activeMetricSymbols) {
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol) continue;

      const live = marketData[symbol] || marketData[rawSymbol];
      if (live) {
        next[symbol] = live;
        continue;
      }

      const row = status.perSymbol[symbol] || status.perSymbol[rawSymbol];
      if (!row) {
        continue;
      }

      const markPrice = Number(row.metrics?.markPrice || row.position?.markPrice || 0);
      const side = row.position?.side;
      const eventTs = Number(row.lastEventTimestampMs || 0) || Date.now();
      const eventCount = Number(row.eventCount || 0);

      next[symbol] = {
        type: 'metrics',
        symbol,
        state: markPrice > 0 ? 'LIVE' : 'UNKNOWN',
        event_time_ms: eventTs,
        snapshot: {
          eventId: eventCount,
          stateHash: `dryrun-fallback-${status.runId || 'local'}-${symbol}-${eventCount}`,
          ts: eventTs,
        },
        timeAndSales: {
          aggressiveBuyVolume: 0,
          aggressiveSellVolume: 0,
          tradeCount: eventCount,
          smallTrades: 0,
          midTrades: 0,
          largeTrades: 0,
          bidHitAskLiftRatio: 0,
          consecutiveBurst: { side: 'buy', count: 0 },
          printsPerSecond: 0,
        },
        cvd: {
          tf1m: { cvd: 0, delta: 0, state: 'Normal' },
          tf5m: { cvd: 0, delta: 0, state: 'Normal' },
          tf15m: { cvd: 0, delta: 0, state: 'Normal' },
        },
        absorption: null,
        openInterest: null,
        funding: null,
        legacyMetrics: {
          price: markPrice,
          obiWeighted: 0,
          obiDeep: 0,
          obiDivergence: 0,
          delta1s: 0,
          delta5s: 0,
          deltaZ: 0,
          cvdSession: 0,
          cvdSlope: 0,
          vwap: markPrice,
          totalVolume: 0,
          totalNotional: 0,
          tradeCount: eventCount,
        },
        signalDisplay: {
          signal: side === 'LONG' ? 'POSITION_LONG' : side === 'SHORT' ? 'POSITION_SHORT' : 'NONE',
          score: side ? 100 : 0,
          confidence: side ? 'HIGH' : 'LOW',
          vetoReason: side ? null : 'DRYRUN_WS_FALLBACK',
          candidate: null,
        },
        strategyPosition: side && row.position
          ? {
              side,
              qty: Number(row.position.qty || 0),
              entryPrice: Number(row.position.entryPrice || 0),
              unrealizedPnlPct: Number(row.position.entryPrice || 0) > 0
                ? (Number(row.position.unrealizedPnl || 0) / Math.max(1e-9, Number(row.position.entryPrice || 0) * Math.max(1e-9, Number(row.position.qty || 0)))) * 100
                : 0,
              addsUsed: 0,
              timeInPositionMs: 0,
            }
          : null,
        advancedMetrics: {
          sweepFadeScore: 0,
          breakoutScore: 0,
          volatilityIndex: 0,
        },
        bids: [],
        asks: [],
        midPrice: markPrice > 0 ? markPrice : null,
      };
    }

    return next;
  }, [activeMetricSymbols, marketData, status.perSymbol, status.runId]);

  const logLines = useMemo(() => {
    return status.logTail.slice(-200).map((item) => {
      const prefix = `[${formatTs(item.timestampMs)}]${item.symbol ? ` [${item.symbol}]` : ''} [${item.level}]`;
      return `${prefix} ${item.message}`;
    });
  }, [status.logTail]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Dry Run Simulation</h1>
            <p className="text-zinc-500 text-sm mt-1">DATA: MAINNET | MODE: PAPER EXECUTION | MULTI-PAIR</p>
          </div>
          <div className="text-xs rounded border border-zinc-700 px-3 py-2 bg-zinc-900">
            <span className={status.running ? 'text-emerald-400' : 'text-zinc-400'}>
              {status.running ? 'RUNNING' : 'STOPPED'}
            </span>
            {status.runId && <span className="text-zinc-500 ml-2">{status.runId}</span>}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-300">Control Panel</h2>

          <div className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              disabled={status.running || isLoadingPairs}
              className="w-full flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm disabled:opacity-60"
            >
              <span>{isLoadingPairs ? 'Loading pairs...' : `${selectedPairs.length} pairs selected`}</span>
              <span>▾</span>
            </button>
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedPairs.map((pair) => (
                <span key={pair} className="text-[10px] px-2 py-1 bg-zinc-800 text-zinc-300 rounded-full border border-zinc-700 flex items-center gap-1">
                  {pair}
                  {!status.running && (
                    <button onClick={() => togglePair(pair)} className="hover:text-white transition-colors">×</button>
                  )}
                </span>
              ))}
            </div>
            {isDropdownOpen && !isLoadingPairs && !status.running && (
              <div className="absolute z-10 mt-1 w-full border border-zinc-700 rounded bg-[#18181b] p-2 shadow-2xl">
                <input
                  type="text"
                  placeholder="Filter symbols..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-black border border-zinc-800 rounded px-2 py-1 text-xs mb-2"
                />
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {filteredPairs.map((pair) => (
                    <button
                      key={pair}
                      onClick={() => togglePair(pair)}
                      className={`w-full text-left px-2 py-1 rounded text-xs flex justify-between ${selectedPairs.includes(pair) ? 'bg-zinc-700 text-white' : 'hover:bg-zinc-800 text-zinc-400'}`}
                    >
                      <span>{pair}</span>
                      {selectedPairs.includes(pair) && <span>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-zinc-500">
              Shared Wallet Start (USDT)
              <input
                type="number"
                min={1}
                value={sharedWalletStart}
                disabled={status.running}
                onChange={(e) => setSharedWalletStart(e.target.value)}
                className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-sm font-mono"
              />
            </label>

            <label className="text-xs text-zinc-500">
              Heartbeat (sec)
              <input
                type="number"
                min={1}
                value={heartbeatSec}
                disabled={status.running}
                onChange={(e) => setHeartbeatSec(e.target.value)}
                className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-sm font-mono"
              />
            </label>
          </div>

          <div className={`rounded border px-3 py-2 text-xs ${
            configuredReserveTotal > sharedWalletNumeric
              ? 'border-amber-800 bg-amber-950/30 text-amber-300'
              : 'border-zinc-800 bg-zinc-950/40 text-zinc-400'
          }`}>
            <div>Configured reserve: {formatNum(configuredReserveTotal, 2)} USDT</div>
            <div>Preview reserve scale: {formatNum(reserveScalePreview, 4)}</div>
            <div>Startup mode: WAIT_MICRO_WARMUP</div>
          </div>

          <PairCapitalTable
            rows={configuredRows}
            runtime={pairRuntime}
            readOnly={status.running}
            onChange={updatePairConfig}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <button
              onClick={startDryRun}
              disabled={status.running}
              className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-bold text-white"
            >
              START DRY RUN
            </button>
            <button
              onClick={stopDryRun}
              disabled={!status.running}
              className="px-3 py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-bold text-white"
            >
              STOP
            </button>
            <button
              onClick={resetDryRun}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-bold text-zinc-200 border border-zinc-700"
            >
              RESET
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
            <label className="text-xs text-zinc-500">
              Test Order Symbol
              <select
                value={testOrderSymbol}
                onChange={(e) => setTestOrderSymbol(e.target.value)}
                disabled={!status.running || activeMetricSymbols.length === 0}
                className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-sm"
              >
                {activeMetricSymbols.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button
              onClick={() => sendTestOrder('BUY')}
              disabled={!status.running}
              className="px-3 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-bold text-white"
            >
              TEST BUY
            </button>
            <button
              onClick={() => sendTestOrder('SELL')}
              disabled={!status.running}
              className="px-3 py-2 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-bold text-white"
            >
              TEST SELL
            </button>
          </div>

          {actionError && (
            <div className="text-xs text-red-500" role="alert" aria-live="assertive">
              {actionError}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500 uppercase tracking-wider">Total Equity</div>
            <div className="text-3xl font-bold text-white mt-2 font-mono">{formatNum(summary.totalEquity, 4)} USDT</div>
            <div className="text-[11px] text-zinc-500 mt-2">Symbols: {status.symbols.length}</div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500">Wallet Balance</div>
            <div className="text-lg font-mono text-white mt-1">{formatNum(summary.walletBalance, 4)}</div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500">Unrealized PnL</div>
            <div className={`text-lg font-mono mt-1 ${summary.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.unrealizedPnl >= 0 ? '+' : ''}{formatNum(summary.unrealizedPnl, 4)}
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500">Realized PnL</div>
            <div className={`text-lg font-mono mt-1 ${summary.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.realizedPnl >= 0 ? '+' : ''}{formatNum(summary.realizedPnl, 4)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500">Total PnL</div>
            <div className={`text-lg font-mono mt-1 ${perf.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {perf.totalPnL >= 0 ? '+' : ''}{formatNum(perf.totalPnL, 4)}
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500">Win Rate</div>
            <div className={`text-lg font-mono mt-1 ${perf.winRate >= 55 ? 'text-emerald-400' : 'text-amber-300'}`}>
              {formatNum(perf.winRate, 2)}%
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500">Max Drawdown</div>
            <div className="text-lg font-mono mt-1 text-red-400">
              {formatNum(perf.maxDrawdown, 4)}
            </div>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-xs text-zinc-500">Sharpe</div>
            <div className={`text-lg font-mono mt-1 ${perf.sharpeRatio >= 1.8 ? 'text-emerald-400' : 'text-amber-300'}`}>
              {formatNum(perf.sharpeRatio, 2)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-300">Per-Symbol Positions</h2>
              <button
                onClick={refreshPositions}
                disabled={isRefreshingPositions}
                className="px-2 py-1 text-[11px] font-semibold rounded border border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
              >
                {isRefreshingPositions ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <table className="w-full text-xs min-w-[1320px]">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-2">Symbol</th>
                  <th className="text-left py-2">Side</th>
                  <th className="text-right py-2">Entry</th>
                  <th className="text-right py-2">Breakeven</th>
                  <th className="text-right py-2">Notional (USDT)</th>
                  <th className="text-right py-2">Mark</th>
                  <th className="text-right py-2">uPnL</th>
                  <th className="text-right py-2">rPnL</th>
                  <th className="text-right py-2">Net</th>
                  <th className="text-right py-2">Eq</th>
                  <th className="text-right py-2">Margin Health</th>
                  <th className="text-right py-2">Streak</th>
                  <th className="text-right py-2">Lev</th>
                  <th className="text-right py-2">Stop</th>
                  <th className="text-right py-2">Liq</th>
                  <th className="text-right py-2">Events</th>
                </tr>
              </thead>
              <tbody>
                {symbolRows.length === 0 && (
                  <tr>
                    <td colSpan={16} className="py-4 text-center text-zinc-600 italic">No active symbol session</td>
                  </tr>
                )}
                {symbolRows.map((row) => (
                  <tr key={row.symbol} className="border-b border-zinc-900">
                    <td className="py-2 font-mono text-zinc-200">{row.symbol}</td>
                    <td className={`py-2 ${row.position?.side === 'LONG' ? 'text-emerald-400' : row.position?.side === 'SHORT' ? 'text-red-400' : 'text-zinc-600'}`}>
                      {row.position?.side || '-'}
                    </td>
                    <td className="py-2 text-right font-mono">{row.position ? formatNum(row.position.entryPrice, 4) : '-'}</td>
                    <td className="py-2 text-right font-mono">{row.position?.breakEvenPrice != null ? formatNum(row.position.breakEvenPrice, 4) : '-'}</td>
                    <td className="py-2 text-right font-mono">{row.position ? formatNum(row.position.notionalUsdt, 2) : '-'}</td>
                    <td className="py-2 text-right font-mono">{formatNum(row.metrics.markPrice, 4)}</td>
                    <td className={`py-2 text-right font-mono ${(row.position?.unrealizedPnl ?? row.metrics.unrealizedPnl) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(row.position?.unrealizedPnl ?? row.metrics.unrealizedPnl) >= 0 ? '+' : ''}
                      {formatNum(row.position?.unrealizedPnl ?? row.metrics.unrealizedPnl, 4)}
                    </td>
                    <td className={`py-2 text-right font-mono ${(row.position?.realizedPnl ?? row.metrics.realizedPnl) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(row.position?.realizedPnl ?? row.metrics.realizedPnl) >= 0 ? '+' : ''}
                      {formatNum(row.position?.realizedPnl ?? row.metrics.realizedPnl, 4)}
                    </td>
                    <td className={`py-2 text-right font-mono ${(row.position?.netPnl ?? (row.metrics.unrealizedPnl + row.metrics.realizedPnl - row.metrics.feePaid + row.metrics.fundingPnl)) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {(row.position?.netPnl ?? (row.metrics.unrealizedPnl + row.metrics.realizedPnl - row.metrics.feePaid + row.metrics.fundingPnl)) >= 0 ? '+' : ''}
                      {formatNum(row.position?.netPnl ?? (row.metrics.unrealizedPnl + row.metrics.realizedPnl - row.metrics.feePaid + row.metrics.fundingPnl), 4)}
                    </td>
                    <td className="py-2 text-right font-mono">{formatNum(row.metrics.totalEquity, 4)}</td>
                    <td className="py-2 text-right font-mono">{formatNum(row.metrics.marginHealth * 100, 2)}%</td>
                    <td className="py-2 text-right font-mono">
                      {row.risk ? `${row.risk.winStreak}/${row.risk.lossStreak}` : '-'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {row.risk ? formatNum(row.risk.dynamicLeverage, 2) : '-'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {row.risk?.stopLossPrice ? formatNum(row.risk.stopLossPrice, 4) : '-'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {row.risk?.liquidationRisk?.score || '-'}
                    </td>
                    <td className="py-2 text-right font-mono text-zinc-500">{row.eventCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 text-[11px] text-zinc-500 grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>Fees: {formatNum(summary.feePaid, 4)} USDT</div>
              <div>Funding: {formatNum(summary.fundingPnl, 4)} USDT</div>
              <div>Margin Health: {formatNum(marginHealthPct, 2)}%</div>
              <div>Pairs: {status.symbols.join(', ') || '-'}</div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-zinc-300 mb-3">Event Console</h2>
            <div className="bg-black border border-zinc-800 rounded p-3 h-[360px] overflow-auto font-mono text-[11px] text-zinc-300 whitespace-pre-wrap">
              {logLines.length === 0 ? 'Dry Run not started.' : logLines.join('\n')}
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">Alpha Decay Summary</h2>
          {status.alphaDecay.length === 0 ? (
            <div className="text-xs text-zinc-500">No alpha decay samples yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-2">Signal</th>
                  <th className="text-right py-2">Avg Validity (ms)</th>
                  <th className="text-right py-2">Half-Life (ms)</th>
                  <th className="text-right py-2">Entry Window</th>
                  <th className="text-right py-2">Exit Window</th>
                  <th className="text-right py-2">Samples</th>
                </tr>
              </thead>
              <tbody>
                {status.alphaDecay.map((item) => (
                  <tr key={item.signalType} className="border-b border-zinc-800/40">
                    <td className="py-2 font-mono text-zinc-200">{item.signalType}</td>
                    <td className="py-2 text-right font-mono">{formatNum(item.avgValidityMs, 0)}</td>
                    <td className="py-2 text-right font-mono">{formatNum(item.alphaDecayHalfLife, 0)}</td>
                    <td className="py-2 text-right font-mono">{item.optimalEntryWindow[0]}-{item.optimalEntryWindow[1]}</td>
                    <td className="py-2 text-right font-mono">{item.optimalExitWindow[0]}-{item.optimalExitWindow[1]}</td>
                    <td className="py-2 text-right font-mono text-zinc-500">{item.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-lg overflow-hidden shadow-2xl">
          <div className="px-4 py-3 flex items-center justify-between text-xs uppercase tracking-wider text-zinc-400 border-b border-zinc-800 bg-zinc-900/70">
            <span>Live Orderflow Metrics (Selected Pairs)</span>
            <span className="text-[10px] normal-case tracking-normal text-zinc-500">
              {telemetryWsStatus === 'open'
                ? 'Click any row to expand details'
                : telemetryWsStatus === 'connecting'
                  ? 'Telemetry connecting...'
                  : 'Telemetry reconnecting...'}
            </span>
          </div>
          <div className="hidden md:block overflow-x-auto">
            <div className="min-w-[1100px]">
              <div
                className="grid gap-0 px-5 py-4 text-[11px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-900 border-b border-zinc-800"
                style={{ gridTemplateColumns: 'minmax(140px, 1fr) 110px 130px 90px 90px 90px 90px 90px 120px' }}
              >
                <div>Symbol / Trend</div>
                <div className="text-right">Price</div>
                <div className="text-right">OI / Change</div>
                <div className="text-center">OBI (10L)</div>
                <div className="text-center">OBI (50L)</div>
                <div className="text-center">OBI Div</div>
                <div className="text-center">Delta Z</div>
                <div className="text-center">CVD Slope</div>
                <div className="text-center">Signal</div>
              </div>
              <div className="bg-black/30 divide-y divide-zinc-900">
                {activeMetricSymbols.map((symbol) => {
                  const normalizedSymbol = normalizeSymbol(symbol);
                  const msg: MetricsMessage | undefined =
                    resolvedMarketData[normalizedSymbol] || resolvedMarketData[symbol];
                  if (!msg) {
                    const waitingText = telemetryWsStatus === 'open'
                      ? `Waiting metrics for ${symbol}...`
                      : telemetryWsStatus === 'connecting'
                        ? `Connecting telemetry for ${symbol}...`
                        : `Telemetry disconnected for ${symbol}, reconnecting...`;
                    return (
                      <div key={symbol} className="px-5 py-4 text-xs text-zinc-600 italic">
                        {waitingText}
                      </div>
                    );
                  }
                  return <SymbolRow key={symbol} symbol={symbol} data={msg} showLatency={false} />;
                })}
              </div>
            </div>
          </div>

          <div className="md:hidden p-3 space-y-3">
            {activeMetricSymbols.map((symbol) => (
              <MobileSymbolCard
                key={symbol}
                symbol={symbol}
                metrics={resolvedMarketData[normalizeSymbol(symbol)] || resolvedMarketData[symbol]}
                showLatency={false}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DryRunDashboard;
