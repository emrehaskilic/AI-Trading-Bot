/**
 * Lightweight API client wrappers for dashboard hooks.
 */

import { proxyWebSocketProtocols, withProxyApiKey } from '../services/proxyAuth';
import { getProxyApiBase, getProxyWsBase } from '../services/proxyBase';

export interface RequestOptions {
  skipRetry?: boolean;
  timeout?: number;
  headers?: Record<string, string>;
}

async function request<T>(method: string, url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const apiBase = getProxyApiBase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 30000);
  try {
    const init = withProxyApiKey({
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    const response = await fetch(`${apiBase}${url}`, init);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = {
  get: <T>(url: string, options?: RequestOptions) => request<T>('GET', url, undefined, options),
  post: <T>(url: string, body?: unknown, options?: RequestOptions) => request<T>('POST', url, body, options),
  put: <T>(url: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', url, body, options),
  delete: <T>(url: string, options?: RequestOptions) => request<T>('DELETE', url, undefined, options),
};

export const get = <T>(url: string, options?: RequestOptions) => apiClient.get<T>(url, options);
export const post = <T>(url: string, body?: unknown, options?: RequestOptions) => apiClient.post<T>(url, body, options);
export const put = <T>(url: string, body?: unknown, options?: RequestOptions) => apiClient.put<T>(url, body, options);
export const del = <T>(url: string, options?: RequestOptions) => apiClient.delete<T>(url, options);

export const healthApi = {
  getHealth: () => get('/health'),
  getReady: () => get('/ready'),
  getMetrics: () => get('/metrics'),
  getSystemStatus: () => get('/api/health'),
  getStatus: () => get('/api/status'),
};

export const riskApi = {
  getStatus: () => get('/api/risk/status'),
  toggleKillSwitch: (enabled: boolean) => post('/api/kill-switch', { enabled }),
};

export const dryRunApi = {
  getStatus: () => get('/api/dry-run/status'),
  getSymbols: () => get('/api/dry-run/symbols'),
  getSessions: () => get('/api/dry-run/sessions'),
  start: (params: unknown) => post('/api/dry-run/start', params),
  stop: () => post('/api/dry-run/stop'),
  reset: () => post('/api/dry-run/reset'),
  save: (sessionId?: string) => post('/api/dry-run/save', { sessionId }),
  load: (sessionId: string) => post('/api/dry-run/load', { sessionId }),
  testOrder: (symbol: string, side: 'BUY' | 'SELL') => post('/api/dry-run/test-order', { symbol, side }),
};

export const executionApi = {
  getStatus: () => get('/api/execution/status'),
  connect: (apiKey: string, apiSecret: string) => post('/api/execution/connect', { apiKey, apiSecret }),
  disconnect: () => post('/api/execution/disconnect'),
  setEnabled: (enabled: boolean) => post('/api/execution/enabled', { enabled }),
  setSymbol: (symbol: string) => post('/api/execution/symbol', { symbol }),
  setSymbols: (symbols: string[]) => post('/api/execution/symbol', { symbols }),
  updateSettings: (settings: unknown) => post('/api/execution/settings', settings),
  refresh: () => post('/api/execution/refresh'),
};

export const analyticsApi = {
  getSnapshot: () => get('/api/analytics/snapshot'),
  getEvidencePack: () => get('/api/analytics/evidence-pack'),
  validateEdge: (params: unknown) => post('/api/analytics/edge-validation', params),
  analyzeRegime: (params: unknown) => post('/api/analytics/regime-analysis', params),
  getRiskProfile: (params: unknown) => post('/api/analytics/risk-profile', params),
  getExecutionImpact: (params: unknown) => post('/api/analytics/execution-impact', params),
  getTradeMetrics: (params: unknown) => post('/api/analytics/trade-metrics', params),
};

export const backtestApi = {
  monteCarlo: (params: unknown) => post('/api/backtest/monte-carlo', params),
  walkForward: (params: unknown) => post('/api/backtest/walk-forward', params),
};

export const abTestApi = {
  getStatus: () => get('/api/abtest/status'),
  getResults: () => get('/api/abtest/results'),
  start: (params: unknown) => post('/api/abtest/start', params),
  stop: () => post('/api/abtest/stop'),
};

export const portfolioApi = {
  getStatus: () => get('/api/portfolio/status'),
};

export const latencyApi = {
  getSnapshot: () => get('/api/latency'),
};

export const exchangeApi = {
  getInfo: () => get('/api/exchange-info'),
  getTestnetInfo: () => get('/api/testnet/exchange-info'),
};

export const backfillApi = {
  getStatus: () => get('/api/backfill/status'),
  replay: (symbol: string, params?: { fromMs?: number; toMs?: number; limit?: number }) => post('/api/backfill/replay', { symbol, ...(params || {}) }),
};

export interface WebSocketClientOptions {
  onMessage?: (data: unknown) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function createWebSocketClient(
  symbols: string[],
  options: WebSocketClientOptions = {},
): WebSocket {
  const wsBase = getProxyWsBase();
  const query = symbols.length > 0 ? `?symbols=${encodeURIComponent(symbols.join(','))}` : '';
  const ws = new WebSocket(`${wsBase}/ws${query}`, proxyWebSocketProtocols());
  ws.onopen = () => options.onConnect?.();
  ws.onclose = () => options.onDisconnect?.();
  ws.onerror = (error) => options.onError?.(error);
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      options.onMessage?.(data);
    } catch {
      options.onMessage?.(event.data);
    }
  };
  return ws;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function getErrorStatus(_error: unknown): number | null {
  return null;
}

export function isNetworkError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes('network') || msg.includes('failed to fetch') || msg.includes('abort');
}

export function isServerError(_error: unknown): boolean {
  return false;
}

export function isClientError(_error: unknown): boolean {
  return false;
}
