# Binance Orderflow Messenger - VPS Deployment Guide

## Architecture Overview

This project implements a robust proxy architecture to shield your client IP from Binance Rate Limits and ensure strict control over API usage.

- **Frontend (Client):** Validates strict separation. No direct connection to `binance.com`. Connects ONLY to VPS Proxy.
- **Backend (Proxy):** Node.js/TypeScript server that:
    - Maintains a **single** multiplexed WebSocket connection to Binance.
    - Manages strict Rate Limiting for snapshots (Token Bucket / Cool-down).
    - Caches `exchangeInfo`.
    - Broadcasts "Metrics" to all connected clients (Fan-out).

## Directory Structure

```
/
├── server/                 # Backend Proxy (Node.js)
│   ├── index.ts           # Main entry point (Architecture logic)
│   ├── metrics/           # Financial mathematics (CVD, Absorption, etc.)
│   └── package.json
├── src/                    # Frontend (React/Vite)
│   ├── components/        # UI Components (Dashboard, SymbolRow)
│   ├── services/          # WebSocket Hooks (connects to Proxy)
│   └── main.tsx
└── README-VPS.md          # This file
```

## Setup & Deployment (VPS)

### 1. Prerequisites
- Node.js v18+
- Nginx (Optional but recommended for SSL/Reverse Proxy)

### 2. Backend Setup
```bash
cd server
npm install
npm run build
# Start with PM2 for production
# npm install -g pm2
# pm2 start dist/index.js --name "orderflow-proxy"
npm run start
```

### 3. Frontend Setup
```bash
# In root directory
npm install
# Build for production
npm run build
# Serve 'dist' folder via Nginx or serve
```

### 4. Environment Variables
Create a `.env` file in `server/` (optional, defaults provided in code):
```env
PORT=8787
# Minimum interval between snapshots per symbol (Spam Protection)
SNAPSHOT_MIN_INTERVAL_MS=60000 
```

### 5. Verification & Proof

#### Check Health Endpoint
```bash
curl http://localhost:8787/api/health
```
Response:
```json
{
  "ok": true,
  "wsState": "connected",
  "connectedSymbols": ["BTCUSDT", "ETHUSDT"],
  "globalBackoff": 0
}
```

#### Check Rate Limiting (Logs)
The server outputs structured JSON logs. Look for `SNAPSHOT_429` or `SNAPSHOT_SKIP_BACKOFF`.
```json
{"ts":"...","event":"SNAPSHOT_SKIP_BACKOFF","symbol":"BTCUSDT","waitMs":45000}
```

## Security Note
- The frontend **never** holds API keys.
- The backend uses only public market data endpoints (no API keys required).
- Use Nginx to restrict access to your IP or domain.
