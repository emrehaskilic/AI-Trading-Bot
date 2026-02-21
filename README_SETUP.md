# Tele-Codex Setup Guide

This project was set up by Antigravity.

## Prerequisites
- Node.js (v18+)
- npm

## Environment
Create `server/.env` from `server/.env.example` and set:

```bash
API_KEY_SECRET=your-strong-api-key
LOG_LEVEL=info
```

Optional notification webhooks (keep these secret, never commit to VCS):

```bash
TELEGRAM_WEBHOOK_URL=https://api.telegram.org/bot.../sendMessage
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Optional frontend env (`.env.local`):

```bash
VITE_PROXY_API_KEY=your-strong-api-key
```

`VITE_PROXY_API_KEY` must match `API_KEY_SECRET`. Frontend startup fails fast when it is missing.

Read-only external viewer (optional, recommended for public links):

```bash
# server/.env
READONLY_VIEW_TOKEN=your-long-random-view-token
EXTERNAL_READONLY_MODE=true
ALLOW_PUBLIC_MARKET_DATA=false
```

Viewer link format:

```bash
https://your-domain/#telemetry?viewer=1&viewerToken=your-long-random-view-token
```

`viewerToken` access is read-only only. POST/modify operations are blocked server-side.

Optional dev host override (`.env.development.local`):

```bash
VITE_DEV_SERVER_HOST=0.0.0.0
```

By default, Vite binds to `localhost` for safer local development.

## Start the Project
To start both the frontend and backend servers concurrently:

```bash
npm run dev:all
```

## Access the Application
- Frontend: http://localhost:5174
- Backend API: http://localhost:8787

## Project Structure
- `src/`: Frontend React application
- `server/`: Backend Express/WebSocket server
