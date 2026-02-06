/**
 * Binance Futures Proxy Server (Strict Architecture)
 *
 * Mandates:
 * 1. Futures ONLY (fapi/fstream).
 * 2. Strict Rate Limiting (Token Bucket / 429 Backoff).
 * 3. Independent Trade Tape (works even if Orderbook is stale).
 * 4. Observability-first (Detailed /health and JSON logs).
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';

// Polyfills
declare var process: any;
declare var Buffer: any;

// Metrics Imports
import { TimeAndSales } from './metrics/TimeAndSales';
import { CvdCalculator } from './metrics/CvdCalculator';
import { AbsorptionDetector } from './metrics/AbsorptionDetector';
import { OpenInterestMonitor, OpenInterestMetrics } from './metrics/OpenInterestMonitor';
import { FundingMonitor, FundingMetrics } from './metrics/FundingMonitor';
import {
    OrderbookState,
    createOrderbookState,
    applyDepthUpdate,
    applySnapshot,
    bestBid,
    bestAsk,
    getLevelSize,
    getTopLevels,
} from './metrics/OrderbookManager';
import { LegacyCalculator } from './metrics/LegacyCalculator';

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT || '8787', 10);
const BINANCE_REST_BASE = 'https://fapi.binance.com';
const BINANCE_WS_BASE = 'wss://fstream.binance.com/stream';

const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
];

// Rate Limiting
const SNAPSHOT_MIN_INTERVAL_MS = 60000;
const MIN_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 120000;

// =============================================================================
// Logging
// =============================================================================

function log(event: string, data: any = {}) {
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...data
    }));
}

// =============================================================================
// State
// =============================================================================

interface SymbolMeta {
    lastSnapshotAttempt: number;
    lastSnapshotOk: number;
    backoffMs: number;
    consecutiveErrors: number;
    isResyncing: boolean;
    // Counters
    depthMsgCount: number;
    tradeMsgCount: number;
    desyncCount: number;
    snapshotCount: number;
}

const symbolMeta = new Map<string, SymbolMeta>();
const orderbookMap = new Map<string, OrderbookState>();

// Metrics
const timeAndSalesMap = new Map<string, TimeAndSales>();
const cvdMap = new Map<string, CvdCalculator>();
const absorptionMap = new Map<string, AbsorptionDetector>();
const absorptionResult = new Map<string, number>();
const legacyMap = new Map<string, LegacyCalculator>();

// Monitor Caches
const lastOpenInterest = new Map<string, OpenInterestMetrics>();
const lastFunding = new Map<string, FundingMetrics>();
const oiMonitors = new Map<string, OpenInterestMonitor>();
const fundingMonitors = new Map<string, FundingMonitor>();

// Cached Exchange Info
let exchangeInfoCache: { data: any; timestamp: number } | null = null;
const EXCHANGE_INFO_TTL_MS = 1000 * 60 * 60; // 1 hr

// Global Rate Limit
let globalBackoffUntil = 0; // Starts at 0 to allow fresh attempts on restart

// =============================================================================
// Helpers
// =============================================================================

function getMeta(symbol: string): SymbolMeta {
    let meta = symbolMeta.get(symbol);
    if (!meta) {
        meta = {
            lastSnapshotAttempt: 0,
            lastSnapshotOk: 0,
            backoffMs: MIN_BACKOFF_MS,
            consecutiveErrors: 0,
            isResyncing: false,
            depthMsgCount: 0,
            tradeMsgCount: 0,
            desyncCount: 0,
            snapshotCount: 0
        };
        symbolMeta.set(symbol, meta);
    }
    return meta;
}

function getOrderbook(symbol: string): OrderbookState {
    let state = orderbookMap.get(symbol);
    if (!state) {
        state = createOrderbookState();
        orderbookMap.set(symbol, state);
    }
    return state;
}

// Lazy Metric Getters
const getTaS = (s: string) => { if (!timeAndSalesMap.has(s)) timeAndSalesMap.set(s, new TimeAndSales()); return timeAndSalesMap.get(s)!; };
const getCvd = (s: string) => { if (!cvdMap.has(s)) cvdMap.set(s, new CvdCalculator()); return cvdMap.get(s)!; };
const getAbs = (s: string) => { if (!absorptionMap.has(s)) absorptionMap.set(s, new AbsorptionDetector()); return absorptionMap.get(s)!; };
const getLegacy = (s: string) => { if (!legacyMap.has(s)) legacyMap.set(s, new LegacyCalculator()); return legacyMap.get(s)!; };

function ensureMonitors(symbol: string) {
    if (!oiMonitors.has(symbol)) {
        const m = new OpenInterestMonitor(symbol);
        m.onUpdate(d => lastOpenInterest.set(symbol, d));
        m.start();
        oiMonitors.set(symbol, m);
    }
    if (!fundingMonitors.has(symbol)) {
        const m = new FundingMonitor(symbol);
        m.onUpdate(d => lastFunding.set(symbol, d));
        m.start();
        fundingMonitors.set(symbol, m);
    }
}

// =============================================================================
// Binance Interactions
// =============================================================================

async function fetchExchangeInfo() {
    if (exchangeInfoCache && (Date.now() - exchangeInfoCache.timestamp < EXCHANGE_INFO_TTL_MS)) {
        return exchangeInfoCache.data;
    }
    try {
        log('EXCHANGE_INFO_REQ', { url: `${BINANCE_REST_BASE}/fapi/v1/exchangeInfo` });
        const res = await fetch(`${BINANCE_REST_BASE}/fapi/v1/exchangeInfo`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        const symbols = data.symbols
            .filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
            .map((s: any) => s.symbol).sort();
        exchangeInfoCache = { data: { symbols }, timestamp: Date.now() };
        return exchangeInfoCache.data;
    } catch (e: any) {
        log('EXCHANGE_INFO_ERROR', { error: e.message });
        return exchangeInfoCache?.data || { symbols: [] };
    }
}

async function fetchSnapshot(symbol: string) {
    const meta = getMeta(symbol);
    const ob = getOrderbook(symbol);
    const now = Date.now();

    // 1. Global Check (Skip if UNSEEDED to force first boot, unless actually 429'd recently)
    // We assume restart means we "want" to try. But let's respect if it's huge.
    // Better strategy: If UNSEEDED, we try ONCE even if `globalBackoffUntil` is slightly future, 
    // BUT since we just restarted, `globalBackoffUntil` is 0 anyway.
    if (now < globalBackoffUntil) {
        // If UNSEEDED, we might want to prioritize this, but if we are globally blocked by 418, we MUST wait.
        log('SNAPSHOT_SKIP_GLOBAL', { symbol, wait: globalBackoffUntil - now });
        return;
    }

    // 2. Local Check
    // Allow immediate retry if UNSEEDED
    if (ob.uiState !== 'UNSEEDED') {
        if (now - meta.lastSnapshotAttempt < SNAPSHOT_MIN_INTERVAL_MS && now - meta.lastSnapshotAttempt < meta.backoffMs) {
            log('SNAPSHOT_SKIP_LOCAL', { symbol, wait: Math.max(SNAPSHOT_MIN_INTERVAL_MS, meta.backoffMs) - (now - meta.lastSnapshotAttempt) });
            return;
        }
    }

    meta.lastSnapshotAttempt = now;
    meta.isResyncing = true;
    // Don't set RESYNCING if unseeded, keep UNSEEDED until success? No, RESYNCING is fine.
    // Actually OrderbookManager handles UNSEEDED -> Buffer. RESYNCING -> also Buffer.
    ob.uiState = 'RESYNCING';

    try {
        log('SNAPSHOT_REQ', { symbol });
        const res = await fetch(`${BINANCE_REST_BASE}/fapi/v1/depth?symbol=${symbol}&limit=1000`);

        if (res.status === 429 || res.status === 418) {
            const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10) * 1000;
            globalBackoffUntil = Date.now() + retryAfter;
            meta.backoffMs = Math.min(meta.backoffMs * 2, MAX_BACKOFF_MS);
            log('SNAPSHOT_429', { symbol, retryAfter, backoff: meta.backoffMs });
            ob.uiState = 'STALE';
            return;
        }

        if (!res.ok) {
            log('SNAPSHOT_FAIL', { symbol, status: res.status });
            meta.backoffMs = Math.min(meta.backoffMs * 2, MAX_BACKOFF_MS);
            meta.consecutiveErrors++;
            ob.uiState = meta.consecutiveErrors > 3 ? 'STALE' : 'RESYNCING';
            return;
        }

        const data: any = await res.json();

        // Success
        applySnapshot(ob, data);
        meta.lastSnapshotOk = now;
        meta.backoffMs = MIN_BACKOFF_MS;
        meta.consecutiveErrors = 0;
        meta.isResyncing = false;
        meta.snapshotCount++;

        log('SNAPSHOT_OK', { symbol, lastUpdateId: data.lastUpdateId });

    } catch (e: any) {
        log('SNAPSHOT_ERR', { symbol, err: e.message });
        meta.backoffMs = Math.min(meta.backoffMs * 2, MAX_BACKOFF_MS);
    }
}

// =============================================================================
// WebSocket Multiplexer
// =============================================================================

let ws: WebSocket | null = null;
let wsState = 'disconnected';
let activeSymbols = new Set<string>();
const clients = new Set<WebSocket>();
const clientSubs = new Map<WebSocket, Set<string>>();

function updateStreams() {
    const required = new Set<string>();
    clients.forEach(c => {
        const subs = clientSubs.get(c);
        if (subs) subs.forEach(s => required.add(s));
    });

    // Simple diff check
    if (required.size === activeSymbols.size && [...required].every(s => activeSymbols.has(s))) {
        if (ws && ws.readyState === WebSocket.OPEN) return;
    }

    if (required.size === 0) {
        if (ws) ws.close();
        ws = null;
        wsState = 'disconnected';
        activeSymbols.clear();
        return;
    }

    if (ws) ws.close();

    activeSymbols = new Set(required);
    const streams = [...activeSymbols].flatMap(s => {
        const l = s.toLowerCase();
        return [`${l}@depth@100ms`, `${l}@trade`]; // Using @trade for tape, @depth for OB
    });

    const url = `${BINANCE_WS_BASE}?streams=${streams.join('/')}`;
    log('WS_CONNECT', { count: activeSymbols.size, url });

    wsState = 'connecting';
    ws = new WebSocket(url);

    ws.on('open', () => {
        wsState = 'connected';
        log('WS_OPEN', {});
    });

    ws.on('message', (raw: Buffer) => handleMsg(raw));

    ws.on('close', () => {
        wsState = 'disconnected';
        log('WS_CLOSE', {});
        setTimeout(updateStreams, 5000);
    });

    ws.on('error', (e) => log('WS_ERROR', { msg: e.message }));
}

function handleMsg(raw: Buffer) {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg.data) return;

    const d = msg.data;
    const e = d.e;
    const s = d.s;
    if (!s) return;

    if (e === 'depthUpdate') {
        const meta = getMeta(s);
        meta.depthMsgCount++;
        const ob = getOrderbook(s);

        // Ensure Monitors are running
        ensureMonitors(s);
        ob.lastDepthTime = Date.now();

        // Core Logic: Apply or Buffer
        const success = applyDepthUpdate(ob, d);

        if (!success) {
            // Desync detected by OrderbookManager
            meta.desyncCount++;
            log('DEPTH_DESYNC', { symbol: s, u: d.u, U: d.U });
            // Only trigger snapshot if not already trying
            if (!meta.isResyncing) fetchSnapshot(s);
        } else {
            // Ideally we check if we were UNSEEDED and now need snapshot?
            // OrderbookManager handles buffering if UNSEEDED.
            // But we must eventually trigger a seed!
            if (ob.uiState === 'UNSEEDED' && !meta.isResyncing) {
                fetchSnapshot(s);
            }
        }
    } else if (e === 'trade') {
        // Trade Tape - Independent of Orderbook State
        const meta = getMeta(s);
        meta.tradeMsgCount++;
        const p = parseFloat(d.p);
        const q = parseFloat(d.q);
        const t = d.T;
        const side = d.m ? 'sell' : 'buy'; // Maker=Buyer => Seller is Taker (Sell)

        const tas = getTaS(s);
        const cvd = getCvd(s);
        const abs = getAbs(s);
        const leg = getLegacy(s);
        const ob = getOrderbook(s);

        tas.addTrade({ price: p, quantity: q, side, timestamp: t });
        cvd.addTrade({ price: p, quantity: q, side, timestamp: t });
        leg.addTrade({ price: p, quantity: q, side, timestamp: t });

        const levelSize = getLevelSize(ob, p) || 0;
        const absVal = abs.addTrade(s, p, side, t, levelSize);
        absorptionResult.set(s, absVal);

        // Broadcast
        broadcastMetrics(s, ob, tas, cvd, absVal, leg);
    }
}

function broadcastMetrics(
    s: string,
    ob: OrderbookState,
    tas: TimeAndSales,
    cvd: CvdCalculator,
    absVal: number,
    leg: LegacyCalculator
) {
    const cvdM = cvd.computeMetrics();
    // Only calculate OBI/Legacy if Orderbook is usable
    const legacyM = (ob.uiState === 'LIVE' || ob.uiState === 'STALE') ? leg.computeMetrics(ob) : null;

    // Top of book
    const { bids, asks } = getTopLevels(ob, 20);
    const mid = (bestBid(ob) && bestAsk(ob)) ? (bestBid(ob)! + bestAsk(ob)!) / 2 : null;

    const payload = {
        type: 'metrics',
        symbol: s,
        state: ob.uiState,
        timeAndSales: tas.computeMetrics(),
        cvd: {
            tf1m: cvdM.find(x => x.timeframe === '1m') || { cvd: 0, delta: 0 },
            tf5m: cvdM.find(x => x.timeframe === '5m') || { cvd: 0, delta: 0 },
            tf15m: cvdM.find(x => x.timeframe === '15m') || { cvd: 0, delta: 0 },
        },
        absorption: absVal,
        openInterest: lastOpenInterest.get(s) || null,
        funding: lastFunding.get(s) || null,
        legacyMetrics: legacyM, // Null if unseeded
        bids, asks, midPrice: mid,
        lastUpdateId: ob.lastUpdateId
    };

    const str = JSON.stringify(payload);
    clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && clientSubs.get(c)?.has(s)) c.send(str);
    });
}


// =============================================================================
// Server
// =============================================================================

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.get('/api/health', (req, res) => {
    const now = Date.now();
    const result: any = {
        ok: true,
        uptime: Math.floor(process.uptime()),
        ws: { state: wsState, count: activeSymbols.size },
        globalBackoff: Math.max(0, globalBackoffUntil - now),
        symbols: {}
    };

    activeSymbols.forEach(s => {
        const meta = getMeta(s);
        const ob = getOrderbook(s);
        result.symbols[s] = {
            status: ob.uiState,
            lastSnapshot: meta.lastSnapshotOk ? Math.floor((now - meta.lastSnapshotOk) / 1000) + 's ago' : 'never',
            buffer: ob.stats.buffered,
            drops: ob.stats.dropped,
            applied: ob.stats.applied,
            desyncs: meta.desyncCount,
            backoff: meta.backoffMs,
            trades: meta.tradeMsgCount
        };
    });
    res.json(result);
});

app.get('/api/exchange-info', async (req, res) => {
    res.json(await fetchExchangeInfo());
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (wc, req) => {
    const p = new URL(req.url || '', 'http://l').searchParams.get('symbols') || '';
    const syms = p.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    clients.add(wc);
    clientSubs.set(wc, new Set(syms));
    log('CLIENT_JOIN', { symbols: syms });

    syms.forEach(s => {
        // Trigger initial seed if needed
        const ob = getOrderbook(s);
        if (ob.uiState === 'UNSEEDED') fetchSnapshot(s);
    });

    updateStreams();

    wc.on('close', () => {
        clients.delete(wc);
        clientSubs.delete(wc);
        updateStreams();
    });
});

server.listen(PORT, '0.0.0.0', () => log('SERVER_UP', { port: PORT }));