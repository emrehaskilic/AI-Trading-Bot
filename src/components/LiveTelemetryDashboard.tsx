import React, { useEffect, useMemo, useState } from 'react';
import { TelemetrySocketStatus, useTelemetrySocket } from '../services/useTelemetrySocket';
import { MetricsState, MetricsMessage } from '../types/metrics';
import PairCapitalTable from './PairCapitalTable';
import SymbolRow from './SymbolRow';
import MobileSymbolCard from './MobileSymbolCard';
import { SymbolCapitalConfig } from '../api/types';
import { isViewerModeEnabled, withProxyApiKey } from '../services/proxyAuth';
import { getProxyApiBase } from '../services/proxyBase';

type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';

interface ExecutionStatus {
  connection: {
    state: ConnectionState;
    executionEnabled: boolean;
    hasCredentials: boolean;
    symbols: string[];
    lastError: string | null;
  };
  selectedSymbols: string[];
  settings: {
    leverage?: number;
    reserveScale?: number;
    totalConfiguredReserveUsdt?: number;
    totalEffectiveReserveUsdt?: number;
    totalMarginBudgetUsdt: number;
    symbolConfigs?: SymbolCapitalConfig[];
    pairInitialMargins: Record<string, number>;
    pairWalletReserves?: Record<string, number>;
    pairLeverageCaps?: Record<string, number>;
  };
  wallet: {
    totalWalletUsdt: number;
    availableBalanceUsdt: number;
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    lastUpdated: number;
  };
}

const defaultExecutionStatus: ExecutionStatus = {
  connection: {
    state: 'DISCONNECTED',
    executionEnabled: false,
    hasCredentials: false,
    symbols: [],
    lastError: null,
  },
  selectedSymbols: [],
  settings: {
    totalMarginBudgetUsdt: 0,
    symbolConfigs: [],
    pairInitialMargins: {},
  },
  wallet: {
    totalWalletUsdt: 0,
    availableBalanceUsdt: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    lastUpdated: 0,
  },
};

const formatNum = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const buildDefaultSymbolCapitalConfig = (symbol: string, totalWalletUsdt: number): SymbolCapitalConfig => ({
  symbol,
  enabled: true,
  walletReserveUsdt: Math.max(0, totalWalletUsdt / 4),
  initialMarginUsdt: Math.max(25, totalWalletUsdt / 20),
  leverage: 10,
});

export const Dashboard: React.FC = () => {
  const readOnlyViewer = useMemo(() => isViewerModeEnabled(), []);
  const [selectedPairs, setSelectedPairs] = useState<string[]>(['BTCUSDT']);
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [isLoadingPairs, setIsLoadingPairs] = useState(true);

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>(defaultExecutionStatus);
  const [pairConfigs, setPairConfigs] = useState<Record<string, SymbolCapitalConfig>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSavedAt, setSettingsSavedAt] = useState(0);
  const [telemetryWsStatus, setTelemetryWsStatus] = useState<TelemetrySocketStatus>('connecting');

  const activeSymbols = useMemo(() => selectedPairs, [selectedPairs]);
  const marketData: MetricsState = useTelemetrySocket(activeSymbols, setTelemetryWsStatus);

  const proxyUrl = getProxyApiBase();
  const fetchWithAuth = (url: string, init?: RequestInit) => fetch(url, withProxyApiKey(init));

  useEffect(() => {
    const fetchPairs = async () => {
      try {
        const res = await fetchWithAuth(`${proxyUrl}/api/exchange-info`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`exchange_info_http_${res.status}`);
        }
        const data = await res.json();
        const pairs = Array.isArray(data?.symbols)
          ? data.symbols.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
          : [];
        if (pairs.length === 0) {
          throw new Error('exchange_info_empty');
        }
        try {
          window.localStorage.setItem('orderflow.symbols.cache', JSON.stringify(pairs));
        } catch {
          // Ignore storage failures (private mode/quota).
        }
        setAvailablePairs(pairs);
        if (pairs.length > 0 && selectedPairs.length === 0) {
          setSelectedPairs([pairs[0]]);
        }
      } catch {
        let fallbackPairs: string[] = [];
        try {
          const cachedRaw = window.localStorage.getItem('orderflow.symbols.cache');
          const cachedParsed = cachedRaw ? JSON.parse(cachedRaw) : [];
          if (Array.isArray(cachedParsed)) {
            fallbackPairs = cachedParsed.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0);
          }
        } catch {
          fallbackPairs = [];
        }
        if (fallbackPairs.length === 0) {
          fallbackPairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        }
        setAvailablePairs(fallbackPairs);
        if (selectedPairs.length === 0) {
          setSelectedPairs([fallbackPairs[0]]);
        }
      } finally {
        setIsLoadingPairs(false);
      }
    };

    fetchPairs();
  }, [proxyUrl]);

  useEffect(() => {
    const pollStatus = async () => {
      try {
        const res = await fetchWithAuth(`${proxyUrl}/api/execution/status`, { cache: 'no-store' });
        const data = (await res.json()) as ExecutionStatus;
        setExecutionStatus(data);

        // Sync selected symbols if server has them
        if (data.selectedSymbols && data.selectedSymbols.length > 0) {
          const serverSyms = data.selectedSymbols.filter(s => s && s.length > 0);
          if (serverSyms.length > 0) {
            // Only update if current list is empty to prevent feedback loops?
            // Actually, usually server should follow UI here.
          }
        }
      } catch {
        // no-op: keep last known state
      }
    };

    pollStatus();
    const timer = window.setInterval(pollStatus, 2000);
    return () => window.clearInterval(timer);
  }, [proxyUrl]);

  useEffect(() => {
    if (settingsDirty) return;
    const nextConfigs: Record<string, SymbolCapitalConfig> = {};
    for (const config of executionStatus.settings?.symbolConfigs || []) {
      nextConfigs[config.symbol] = config;
    }
    if (Object.keys(nextConfigs).length === 0) {
      const leverage = Number(executionStatus.settings?.leverage || 10);
      const reserves = executionStatus.settings?.pairWalletReserves || {};
      const margins = executionStatus.settings?.pairInitialMargins || {};
      for (const symbol of selectedPairs) {
        nextConfigs[symbol] = {
          symbol,
          enabled: true,
          walletReserveUsdt: Number(reserves[symbol] || margins[symbol] || 0),
          initialMarginUsdt: Number(margins[symbol] || 0),
          leverage,
        };
      }
    }
    setPairConfigs(nextConfigs);
  }, [executionStatus, selectedPairs, settingsDirty]);

  useEffect(() => {
    setPairConfigs((prev) => {
      const next = { ...prev };
      let changed = false;
      const wallet = Math.max(0, executionStatus.wallet.totalWalletUsdt || 0);
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
  }, [executionStatus.wallet.totalWalletUsdt, selectedPairs]);

  useEffect(() => {
    if (readOnlyViewer) return;
    const syncSelectedSymbols = async () => {
      try {
        await fetchWithAuth(`${proxyUrl}/api/execution/symbol`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: selectedPairs }),
        });
      } catch {
        // ignore and retry on next change
      }
    };
    const timer = setTimeout(syncSelectedSymbols, 500);
    return () => clearTimeout(timer);
  }, [proxyUrl, selectedPairs, readOnlyViewer]);

  const filteredPairs = availablePairs.filter((p) => p.includes(searchTerm.toUpperCase()));

  const togglePair = (pair: string) => {
    if (selectedPairs.includes(pair)) {
      setSelectedPairs(selectedPairs.filter(p => p !== pair));
    } else {
      setSelectedPairs([...selectedPairs, pair]);
    }
    setSettingsDirty(true);
  };

  const updatePairConfig = (symbol: string, patch: Partial<SymbolCapitalConfig>) => {
    const wallet = Math.max(0, executionStatus.wallet.totalWalletUsdt || 0);
    setPairConfigs((prev) => ({
      ...prev,
      [symbol]: {
        ...(prev[symbol] || buildDefaultSymbolCapitalConfig(symbol, wallet)),
        ...patch,
        symbol,
      },
    }));
    setSettingsDirty(true);
  };

  const connectTestnet = async () => {
    if (readOnlyViewer) return;
    setConnectionError(null);
    try {
      const res = await fetchWithAuth(`${proxyUrl}/api/execution/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'connect_failed');
      }
      setExecutionStatus(data.status as ExecutionStatus);
    } catch (e: any) {
      setConnectionError(e.message || 'connect_failed');
    }
  };

  const disconnectTestnet = async () => {
    if (readOnlyViewer) return;
    setConnectionError(null);
    try {
      const res = await fetchWithAuth(`${proxyUrl}/api/execution/disconnect`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'disconnect_failed');
      }
      setExecutionStatus(data.status as ExecutionStatus);
    } catch (e: any) {
      setConnectionError(e.message || 'disconnect_failed');
    }
  };

  const setExecutionEnabled = async (enabled: boolean) => {
    if (readOnlyViewer) return;
    setConnectionError(null);
    try {
      const res = await fetchWithAuth(`${proxyUrl}/api/execution/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'execution_toggle_failed');
      }
      setExecutionStatus(data.status as ExecutionStatus);
    } catch (e: any) {
      setConnectionError(e.message || 'execution_toggle_failed');
    }
  };

  const refreshWalletPnl = async () => {
    if (readOnlyViewer) return;
    const res = await fetchWithAuth(`${proxyUrl}/api/execution/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (res.ok) {
      setExecutionStatus(data.status as ExecutionStatus);
    }
  };

  const applyExecutionSettings = async () => {
    if (readOnlyViewer) return;
    setSettingsError(null);
    try {
      const res = await fetchWithAuth(`${proxyUrl}/api/execution/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbolConfigs: selectedPairs.map((symbol) => pairConfigs[symbol] || buildDefaultSymbolCapitalConfig(symbol, executionStatus.wallet.totalWalletUsdt)),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'settings_update_failed');
      }
      setExecutionStatus(data.status as ExecutionStatus);
      setSettingsDirty(false);
      setSettingsSavedAt(Date.now());
    } catch (e: any) {
      setSettingsError(e.message || 'settings_update_failed');
    }
  };

  const configuredRows = useMemo(() => {
    const wallet = Math.max(0, executionStatus.wallet.totalWalletUsdt || 0);
    return selectedPairs.map((symbol) => pairConfigs[symbol] || buildDefaultSymbolCapitalConfig(symbol, wallet));
  }, [executionStatus.wallet.totalWalletUsdt, pairConfigs, selectedPairs]);
  const totalMarginBudgetUsdt = executionStatus.wallet.totalWalletUsdt;
  const allocatedInitialMarginUsdt = configuredRows.reduce((sum, row) => {
    return sum + (Number.isFinite(row.initialMarginUsdt) && row.initialMarginUsdt > 0 ? row.initialMarginUsdt : 0);
  }, 0);
  const configuredReserveUsdt = configuredRows.reduce((sum, row) => sum + Math.max(0, Number(row.walletReserveUsdt || 0)), 0);
  const remainingMarginUsdt = totalMarginBudgetUsdt - configuredReserveUsdt;
  const runtimeRows = useMemo(() => {
    const next: Record<string, any> = {};
    for (const config of executionStatus.settings?.symbolConfigs || []) {
      next[config.symbol] = {
        capital: {
          configuredReserveUsdt: config.walletReserveUsdt,
          effectiveReserveUsdt: config.walletReserveUsdt * Number(executionStatus.settings?.reserveScale || 1),
          initialMarginUsdt: config.initialMarginUsdt,
          leverage: config.leverage,
          reserveScale: Number(executionStatus.settings?.reserveScale || 1),
        },
      };
    }
    return next;
  }, [executionStatus.settings]);

  const latestTelemetryTs = activeSymbols.reduce((maxTs, symbol) => {
    const msg = marketData[symbol];
    const ts = Number(msg?.event_time_ms || msg?.snapshot?.ts || 0);
    return ts > maxTs ? ts : maxTs;
  }, 0);
  const telemetryLagMs = latestTelemetryTs > 0 ? Math.max(0, Date.now() - latestTelemetryTs) : Number.POSITIVE_INFINITY;
  const symbolsWithData = activeSymbols.filter((symbol) => Boolean(marketData[symbol])).length;
  const telemetryState: ConnectionState = activeSymbols.length === 0
    ? 'DISCONNECTED'
    : telemetryWsStatus === 'connecting'
      ? 'CONNECTING'
      : telemetryWsStatus !== 'open'
        ? 'DISCONNECTED'
        : symbolsWithData === 0
          ? 'CONNECTING'
          : telemetryLagMs <= 10_000
            ? 'CONNECTED'
            : telemetryLagMs <= 30_000
              ? 'CONNECTING'
              : 'ERROR';

  const statusColor = telemetryState === 'CONNECTED'
    ? 'text-green-400'
    : telemetryState === 'ERROR'
      ? 'text-red-400'
      : telemetryState === 'CONNECTING'
        ? 'text-amber-400'
        : 'text-zinc-400';

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Orderflow Telemetry</h1>
            <p className="text-zinc-500 text-sm mt-1">DATA: MAINNET | EXCHANGE: TESTNET</p>
            {readOnlyViewer && (
              <p className="text-amber-300 text-xs mt-2 uppercase tracking-wide">Read-only external viewer mode</p>
            )}
          </div>
          <div className="text-xs rounded border border-zinc-700 px-3 py-2 bg-zinc-900">
            <div className={`font-semibold ${statusColor}`}>{telemetryState}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">WS Telemetry</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-zinc-300 text-center border-b border-zinc-800 pb-2">WALLET & PNL</h2>
            <div className="grid grid-cols-2 gap-y-3 text-sm py-2">
              <div className="text-zinc-500">Total Wallet</div>
              <div className="text-right font-mono text-white text-lg">{formatNum(executionStatus.wallet.totalWalletUsdt)} USDT</div>

              <div className="text-zinc-500">Available</div>
              <div className="text-right font-mono">{formatNum(executionStatus.wallet.availableBalanceUsdt)} USDT</div>

              <div className="text-zinc-500">Realized PnL</div>
              <div className={`text-right font-mono ${executionStatus.wallet.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {executionStatus.wallet.realizedPnl >= 0 ? '+' : ''}{formatNum(executionStatus.wallet.realizedPnl)}
              </div>

              <div className="text-zinc-500">Unrealized PnL</div>
              <div className={`text-right font-mono ${executionStatus.wallet.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {executionStatus.wallet.unrealizedPnl >= 0 ? '+' : ''}{formatNum(executionStatus.wallet.unrealizedPnl)}
              </div>

              <div className="text-zinc-500 font-bold border-t border-zinc-800 pt-2">Total PnL</div>
              <div className={`text-right font-mono font-bold border-t border-zinc-800 pt-2 ${executionStatus.wallet.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {executionStatus.wallet.totalPnl >= 0 ? '+' : ''}{formatNum(executionStatus.wallet.totalPnl)}
              </div>
            </div>

            <button
              onClick={refreshWalletPnl}
              disabled={readOnlyViewer}
              className="w-full mt-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-semibold text-zinc-300 border border-zinc-700 transition-colors"
            >
              REFRESH WALLET
            </button>
            {executionStatus.wallet.lastUpdated > 0 && (
              <p className="text-[10px] text-zinc-600 text-center">Last synced: {new Date(executionStatus.wallet.lastUpdated).toLocaleTimeString()}</p>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
            <h2 className="text-sm font-semibold text-zinc-300">Credentials & Symbols</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="password"
                placeholder="Testnet API Key"
                value={apiKey}
                disabled={readOnlyViewer}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Testnet API Secret"
                value={apiSecret}
                disabled={readOnlyViewer}
                onChange={(e) => setApiSecret(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button disabled={readOnlyViewer} onClick={connectTestnet} className="px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded text-xs font-bold text-white shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">CONNECT EXCHANGE</button>
              <button disabled={readOnlyViewer} onClick={disconnectTestnet} className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">DISCONNECT</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={readOnlyViewer}
                onClick={() => setExecutionEnabled(true)}
                className={`px-3 py-2 rounded text-xs font-bold transition-all active:scale-95 border ${executionStatus.connection.executionEnabled ? 'bg-emerald-700 border-emerald-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
              >
                ENABLE EXECUTION
              </button>
              <button
                disabled={readOnlyViewer}
                onClick={() => setExecutionEnabled(false)}
                className={`px-3 py-2 rounded text-xs font-bold transition-all active:scale-95 border ${!executionStatus.connection.executionEnabled ? 'bg-amber-700 border-amber-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
              >
                DISABLE EXECUTION
              </button>
            </div>
            <div className="text-[11px] text-zinc-500">
              Execution: <span className={executionStatus.connection.executionEnabled ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                {executionStatus.connection.executionEnabled ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
            {connectionError && (
              <div className="text-xs text-red-500 font-medium italic" role="alert" aria-live="assertive">
                {connectionError}
              </div>
            )}

            <div className="pt-2 border-t border-zinc-800">
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className="w-full flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm"
              >
                <span>{isLoadingPairs ? 'Loading Symbols...' : `${selectedPairs.length} symbols active`}</span>
                <span>▾</span>
              </button>
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedPairs.map(p => (
                  <span key={p} className="text-[10px] px-2 py-1 bg-zinc-800 text-zinc-400 rounded-full border border-zinc-700 flex items-center gap-1">
                    {p}
                    <button onClick={() => togglePair(p)} className="hover:text-white transition-colors">×</button>
                  </span>
                ))}
              </div>
              {isDropdownOpen && !isLoadingPairs && (
                <div className="absolute z-10 mt-1 w-[300px] border border-zinc-700 rounded bg-[#18181b] p-2 shadow-2xl">
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
                        className={`w-full text-left px-2 py-1 rounded text-xs flex justify-between ${selectedPairs.includes(pair) ? 'bg-zinc-700 text-white' : 'hover:bg-zinc-800 text-zinc-500'}`}
                      >
                        <span>{pair}</span>
                        {selectedPairs.includes(pair) && <span>✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-zinc-800 space-y-3">
              <h3 className="text-xs font-semibold text-zinc-300">Capital Settings</h3>

              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-zinc-500">Shared Wallet</div>
                <div className="text-right font-mono text-white">{formatNum(totalMarginBudgetUsdt)} USDT</div>
                <div className="text-zinc-500">Configured Seed Margin</div>
                <div className="text-right font-mono">{formatNum(allocatedInitialMarginUsdt)} USDT</div>
                <div className="text-zinc-500">Configured Reserve</div>
                <div className="text-right font-mono">{formatNum(configuredReserveUsdt)} USDT</div>
                <div className="text-zinc-500">Reserve Remaining</div>
                <div className={`text-right font-mono ${remainingMarginUsdt >= 0 ? 'text-zinc-300' : 'text-red-400'}`}>
                  {formatNum(remainingMarginUsdt)} USDT
                </div>
              </div>

              <div className={`rounded border px-3 py-2 text-xs ${
                configuredReserveUsdt > totalMarginBudgetUsdt
                  ? 'border-amber-800 bg-amber-950/30 text-amber-300'
                  : 'border-zinc-800 bg-zinc-950/40 text-zinc-400'
              }`}>
                <div>Runtime reserve scale: {formatNum(Number(executionStatus.settings?.reserveScale || 1), 4)}</div>
                <div>User-selected symbols only. Execution uses per-symbol leverage caps and reserves.</div>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                <div className="min-w-0">
                  <PairCapitalTable
                    rows={configuredRows}
                    runtime={runtimeRows}
                    readOnly={readOnlyViewer}
                    onChange={updatePairConfig}
                  />
                </div>
                <button
                  disabled={readOnlyViewer}
                  onClick={applyExecutionSettings}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-semibold border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  APPLY
                </button>
              </div>

              {settingsError && (
                <div className="text-xs text-red-500" role="alert" aria-live="assertive">
                  {settingsError}
                </div>
              )}
              {!settingsError && settingsSavedAt > 0 && (
                <div className="text-[10px] text-zinc-600">Settings saved: {new Date(settingsSavedAt).toLocaleTimeString()}</div>
              )}
            </div>
          </div>
        </div>

        <div className="border border-zinc-800 rounded-xl overflow-hidden bg-gradient-to-br from-zinc-900 to-zinc-950 shadow-2xl">
          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className="grid gap-0 px-5 py-4 text-[11px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-900 border-b border-zinc-800" style={{ gridTemplateColumns: 'minmax(140px, 1fr) 110px 130px 90px 90px 90px 90px 90px 120px' }}>
                <div>Symbol</div>
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
                {activeSymbols.length === 0 ? (
                  <div className="px-5 py-6 text-xs text-zinc-600 italic">
                    Select at least one symbol to start streaming telemetry.
                  </div>
                ) : (
                  activeSymbols.map((symbol) => {
                    const msg: MetricsMessage | undefined = marketData[symbol];
                    if (!msg) return (
                      <div key={symbol} className="px-5 py-4 text-xs text-zinc-600 italic">
                        Initializing {symbol}...
                      </div>
                    );
                    return <SymbolRow key={symbol} symbol={symbol} data={msg} showLatency={false} />;
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="text-[10px] text-zinc-700 text-center uppercase tracking-tighter">
          Orderflow Matrix Protocol • Mainnet Telemetry Hub • Testnet Bridge Active
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
