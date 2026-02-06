# Orderflow Matrix with Binance Proxy Server

## Overview

This project implements an orderflow analysis dashboard with a backend proxy server that handles all Binance API requests to avoid 418/429 rate limit errors.  It has been extended to include a real‑time telemetry layer that aggregates time‑and‑sales statistics and multi‑timeframe cumulative volume delta (CVD) for each subscribed symbol.

### Architecture

\
 Frontend (Vite/React) → Proxy Server (Express + WS) → Binance API/WS  
 Port 5173                          Port 8787

**Key Benefits:**

- No direct Binance requests from browser (avoids 418/429 anti-bot errors)
- Server‑side rate limiting and backoff
- In‑memory caching for depth snapshots
- Single WebSocket connection to Binance shared across clients
- **Orderflow Telemetry:** time‑and‑sales metrics and CVD computed in the backend and streamed to clients

---

## Quick Start (Local Development)

1. **Install dependencies**

   ```bash
   # Install all dependencies (root + server)
   npm run install:all
   ```

2. **Run both server and client**

   ```bash
   # This starts both the proxy server (port 8787) and Vite frontend (port 5173)
   npm run dev:all
   ```

3. **Open browser**

   Navigate to `http://localhost:5173`.

---

## Telemetry API

When connected to the WebSocket endpoint (`/ws?symbols=BTCUSDT,ETHUSDT`), the server forwards raw Binance messages and additionally sends metric messages of the following form.  The example below reflects the full message after the telemetry extensions:

```json
{
  "type": "metrics",
  "symbol": "BTCUSDT",
  "state": "LIVE",                  // LIVE / STALE / RESYNCING based on orderbook freshness
  "timeAndSales": {
    "aggressiveBuyVolume": 123.45,
    "aggressiveSellVolume": 98.76,
    "tradeCount": 42,
    "smallTrades": 30,
    "midTrades": 10,
    "largeTrades": 2,
    "bidHitAskLiftRatio": 0.8,
    "consecutiveBurst": { "side": "buy", "count": 5 },
    "avgLatencyMs": 12.3,       // average event→receipt latency (clamped at ≥0)
    "printsPerSecond": 0.7
  },
  "cvd": [
    { "timeframe": "1m", "cvd": 50.0, "delta": 50.0, "exhaustion": false },
    { "timeframe": "5m", "cvd": 200.0, "delta": 200.0, "exhaustion": false },
    { "timeframe": "15m", "cvd": 450.0, "delta": 450.0, "exhaustion": true }
  ],
  "absorption": 0,                  // 1 when absorption detected, otherwise 0
  "openInterest": {                 // may be null if unavailable
    "openInterest": 100000.0,
    "delta": -2500.0
  },
  "funding": {                     // may be null if unavailable
    "rate": 0.00025,
    "timeToFundingMs": 5400000,
    "trend": "up"                 // up / down / flat
  }
}
```

The client should use these messages to render charts or indicators without performing heavy computations in the browser.  The `state` field reflects the orderbook status: `LIVE` when depth updates are fresh, `STALE` if no update arrives within a few seconds, and `RESYNCING` during snapshot reloads after a sequence gap.

### Open Interest and Funding Rate sources

Open Interest and funding rate data are fetched from Binance’s public futures endpoints.  Each symbol gets its own monitor which polls the appropriate endpoint every 60 seconds.  If a network or rate‑limit error occurs the monitor backs off exponentially and continues polling.  The `openInterest` field therefore contains the absolute open interest and its delta relative to the previous polling result.  For unit tests or offline environments the monitors expose a manual `update()` method that can be called to inject mock values; in this case the data are marked as "mock" through the test harness and no network request is made.

Funding rates behave similarly: the monitor fetches the latest funding rate and next funding time every 60 seconds.  The `rate` field reflects the current funding rate, `timeToFundingMs` shows milliseconds remaining until the next funding event, and `trend` indicates whether the rate has risen (`up`), fallen (`down`) or remained unchanged (`flat`) compared to the previous poll.  When tests call `update()` directly, the values are mock; otherwise the data come from the real Binance API with automatic retry/backoff on failure.

---

## Environment Variables

### Frontend (.env or .env.local)

| Variable          | Default                 | Description                                      |
|-------------------|-------------------------|--------------------------------------------------|
| `VITE_PROXY_HTTP` | `http://localhost:8787` | HTTP proxy URL for depth snapshots               |
| `VITE_PROXY_WS`   | `ws://localhost:8787`   | WebSocket proxy URL for streams                  |

### Server

| Variable | Default | Description |
|---------:|--------:|-------------|
| `PORT`   | `8787`  | Server port |

---

## Testing

Unit tests for the telemetry layer live under `server/test`.  To run them from the project root:

```bash
npm test
```

The default test script executes a TypeScript file using `ts-node` and should complete without failures.

---

## License

MIT