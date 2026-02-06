import { useEffect, useRef, useState } from 'react';
import { MetricsMessage, MetricsState } from '../types/metrics';

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

  useEffect(() => {
    // If no symbols selected, do nothing
    if (!activeSymbols || activeSymbols.length === 0) return;
    // Close any existing socket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // Determine proxy base from Vite env or default
    const proxyWs = (import.meta as any).env?.VITE_PROXY_WS || 'ws://localhost:8787';
    const url = `${proxyWs}/ws?symbols=${activeSymbols.join(',')}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

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
    ws.onclose = () => {
      // Mark socket closed but keep last state
    };
    ws.onerror = () => {
      // Swallow errors; UI will indicate stale state via metrics
    };
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeSymbols.join(',')]);
  return state;
}