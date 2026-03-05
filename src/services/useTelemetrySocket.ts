import { useEffect, useRef, useState } from 'react';
import { MetricsMessage, MetricsState } from '../types/metrics';
import { getViewerToken, proxyWebSocketProtocols } from './proxyAuth';
import { getProxyWsBase, getProxyWsCandidates } from './proxyBase';

export type TelemetrySocketStatus = 'connecting' | 'open' | 'closed';

function normalizeSymbol(value: string): string {
  return String(value || '').trim().toUpperCase();
}

/**
 * Hook that connects to the backend telemetry WebSocket and
 * accumulates per‑symbol metrics.  The server emits both raw Binance
 * messages and separate ``metrics`` messages.  We listen only for
 * ``metrics`` messages and update local state accordingly.  A new
 * WebSocket connection is opened whenever the list of active symbols
 * changes.
 *
 * The hook returns a map keyed by symbol.  Each entry holds the
 * latest ``MetricsMessage`` for that symbol.  The UI should treat
 * this object as immutable and re-render when it changes.
 */
export function useTelemetrySocket(
  activeSymbols: string[],
  onStatusChange?: (status: TelemetrySocketStatus) => void,
): MetricsState {
  const [state, setState] = useState<MetricsState>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);
  const normalizedSymbols = [...new Set(activeSymbols.map(normalizeSymbol).filter(Boolean))].sort();
  const symbolsKey = normalizedSymbols.join(',');

  useEffect(() => {
    let disposed = false;
    let wsCandidateIndex = 0;
    let noMetricsTimer: number | null = null;
    const maxDelayMs = 30_000;
    const noMetricsTimeoutMs = 10_000;
    reconnectAttempts.current = 0;
    const wsCandidates = getProxyWsCandidates();

    const clearReconnectTimer = () => {
      if (reconnectTimeoutRef.current != null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const clearNoMetricsTimer = () => {
      if (noMetricsTimer != null) {
        clearTimeout(noMetricsTimer);
        noMetricsTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || normalizedSymbols.length === 0) {
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), maxDelayMs);
      reconnectAttempts.current += 1;
      console.log(`[Telemetry] Reconnecting in ${delay}ms...`);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, delay);
    };

    const closeActiveSocket = (reason: string) => {
      const current = wsRef.current;
      if (!current) {
        return;
      }
      wsRef.current = null;
      try {
        if (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING) {
          current.close(1000, reason);
        }
      } catch {
        // Ignore close failures on teardown.
      }
    };

    const connect = () => {
      if (disposed || normalizedSymbols.length === 0) {
        onStatusChange?.('closed');
        return;
      }

      clearReconnectTimer();
      closeActiveSocket('reconnect');

      const proxyWs = wsCandidates.length > 0
        ? wsCandidates[wsCandidateIndex % wsCandidates.length]
        : getProxyWsBase();
      const params = new URLSearchParams();
      params.set('symbols', normalizedSymbols.join(','));
      const viewerToken = getViewerToken();
      if (viewerToken) {
        params.set('viewerToken', viewerToken);
      }
      const url = `${proxyWs}/ws?${params.toString()}`;
      console.log(`[Telemetry] Connecting to WS: ${url} (attempt ${reconnectAttempts.current + 1}, candidate ${wsCandidateIndex + 1}/${Math.max(1, wsCandidates.length)})`);

      try {
        onStatusChange?.('connecting');
        const ws = new WebSocket(url, proxyWebSocketProtocols());
        wsRef.current = ws;
        let receivedMetrics = false;

        ws.onopen = () => {
          if (disposed || wsRef.current !== ws) {
            return;
          }
          console.log('[Telemetry] WebSocket connected');
          onStatusChange?.('open');
          reconnectAttempts.current = 0;
          clearNoMetricsTimer();
          noMetricsTimer = window.setTimeout(() => {
            if (disposed || wsRef.current !== ws || receivedMetrics) {
              return;
            }
            if (wsCandidates.length > 1) {
              wsCandidateIndex = (wsCandidateIndex + 1) % wsCandidates.length;
            }
            console.warn('[Telemetry] No metrics received in time, rotating WS candidate');
            try {
              ws.close(4000, 'no_metrics_timeout');
            } catch {
              // Ignore close failures.
            }
          }, noMetricsTimeoutMs);
        };

        ws.onmessage = (event) => {
          if (disposed || wsRef.current !== ws) {
            return;
          }
          if (typeof event.data !== 'string') {
            return;
          }
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'metrics' && msg.symbol) {
              const receivedAt = Date.now();
              const serverSent = Number(msg?.server_sent_ms || 0);
              const metricsMsg = {
                ...(msg as MetricsMessage),
                client_received_ms: receivedAt,
                ws_latency_client_ms: Number.isFinite(serverSent) && serverSent > 0
                  ? Math.max(0, receivedAt - serverSent)
                  : undefined,
              } as MetricsMessage;
              const symbol = normalizeSymbol(metricsMsg.symbol);
              if (!symbol) {
                return;
              }
              if (!receivedMetrics) {
                receivedMetrics = true;
                clearNoMetricsTimer();
              }
              setState(prev => ({ ...prev, [symbol]: { ...metricsMsg, symbol } }));
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = (event) => {
          const isCurrentSocket = wsRef.current === ws;
          if (isCurrentSocket) {
            wsRef.current = null;
          }
          clearNoMetricsTimer();
          // Ignore lifecycle events from stale sockets that were intentionally replaced.
          if (disposed || !isCurrentSocket) {
            return;
          }
          console.log(`[Telemetry] WebSocket closed (code: ${event.code})`);
          if (!receivedMetrics && wsCandidates.length > 1) {
            wsCandidateIndex = (wsCandidateIndex + 1) % wsCandidates.length;
          }
          onStatusChange?.('closed');
          scheduleReconnect();
        };

        ws.onerror = (error) => {
          if (disposed || wsRef.current !== ws) {
            return;
          }
          console.error('[Telemetry] WebSocket error:', error);
          onStatusChange?.('closed');
          // onclose handles reconnect.
        };
      } catch (error) {
        if (disposed) {
          return;
        }
        console.error('[Telemetry] Failed to create WebSocket:', error);
        onStatusChange?.('closed');
        scheduleReconnect();
      }
    };

    // Keep state aligned with current subscriptions and avoid key mismatches.
    setState(prev => {
      if (normalizedSymbols.length === 0) {
        return {};
      }
      const next: MetricsState = {};
      for (const symbol of normalizedSymbols) {
        if (prev[symbol]) {
          next[symbol] = prev[symbol];
        }
      }
      return next;
    });

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearNoMetricsTimer();
      closeActiveSocket('effect_cleanup');
      onStatusChange?.('closed');
    };
  }, [symbolsKey, onStatusChange]);

  return state;
}
