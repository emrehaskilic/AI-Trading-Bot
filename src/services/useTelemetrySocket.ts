import { useEffect, useRef, useState, useCallback } from 'react';
import { MetricsMessage, MetricsState } from '../types/metrics';
import { proxyWebSocketProtocols } from './proxyAuth';
import { getProxyWsBase } from './proxyBase';

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
export function useTelemetrySocket(activeSymbols: string[]): MetricsState {
  const [state, setState] = useState<MetricsState>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;
  const symbolsKey = activeSymbols.join(',');

  const connect = useCallback(() => {
    if (!activeSymbols || activeSymbols.length === 0) return;

    // Close any existing socket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const proxyWs = getProxyWsBase();
    const url = `${proxyWs}/ws?symbols=${activeSymbols.join(',')}`;

    console.log(`[Telemetry] Connecting to WS: ${url} (attempt ${reconnectAttempts.current + 1})`);

    try {
      const ws = new WebSocket(url, proxyWebSocketProtocols());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Telemetry] WebSocket connected');
        reconnectAttempts.current = 0; // Reset on successful connection
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'metrics' && msg.symbol) {
            const metricsMsg = msg as MetricsMessage;
            setState(prev => ({ ...prev, [metricsMsg.symbol]: metricsMsg }));
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = (event) => {
        console.log(`[Telemetry] WebSocket closed (code: ${event.code})`);
        wsRef.current = null;

        // Attempt reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`[Telemetry] Reconnecting in ${delay}ms...`);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('[Telemetry] WebSocket error:', error);
        // Error will trigger onclose, which handles reconnection
      };
    } catch (error) {
      console.error('[Telemetry] Failed to create WebSocket:', error);
      // Attempt reconnect
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimeoutRef.current = window.setTimeout(connect, delay);
      }
    }
  }, [symbolsKey]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return state;
}
