/**
 * Binance Proxy Server with Orderflow Metrics
 *
 * This server proxies Binance REST and WebSocket APIs to avoid
 * anti‑bot rate limiting and centralises streaming connections for
 * multiple clients.  In addition to forwarding market data, it now
 * computes real‑time orderflow telemetry including time‑and‑sales
 * statistics and multi‑timeframe cumulative volume delta (CVD).
 * Clients receive both the raw Binance messages and separate
 * ``metrics`` messages containing aggregated data for the symbols
 * they have subscribed to.
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';

// -----------------------------------------------------------------------------
// Ambient declarations for Node globals.  These declarations prevent
// TypeScript compilation errors in environments where @types/node is
// unavailable.  They intentionally widen the types of process and
// Buffer to `any` so that references to them do not fail type
// checking.  When @types/node is installed these declarations are
// ignored.
declare var process: any;
declare var Buffer: any;

// -----------------------------------------------------------------------------
// Metrics imports
// -----------------------------------------------------------------------------
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
    OrderbookUiState,
} from './metrics/OrderbookManager';

// Legacy metrics calculator to replicate client‑side computations
import { LegacyCalculator } from './metrics/LegacyCalculator';

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT || '8787', 10);
const BINANCE_REST_BASE = 'https://fapi.binance.com';
const BINANCE_WS_BASE = 'wss://fstream.binance.com/stream';

// CORS origins
const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
    // Add VPS domain/IP here in production
];

// =============================================================================
// State
// =============================================================================

// Export DepthCache type so it can be used by OrderbookManager
export interface DepthCache {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
    cachedAt: number;
}

interface RateLimitState {
    lastRequest: number;
    backoffMs: number;
}

// In-memory caches
const depthCache = new Map<string, DepthCache>();
const rateLimitState = new Map<string, RateLimitState>();

// Constants
const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;
const RATE_LIMIT_INTERVAL_MS = 500; // Per-symbol request throttle
const CACHE_TTL_MS = 5000; // Cache validity duration

// WebSocket state
let binanceWs: WebSocket | null = null;
let binanceWsState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

// Track connected clients and their subscribed symbols
const wsClients = new Set<WebSocket>();
const clientSymbols = new Map<WebSocket, Set<string>>();
let currentStreamSymbols = new Set<string>();

// Server uptime
const startTime = Date.now();

// =============================================================================
// Logging
// =============================================================================

// Extend log levels to include ACTION and STATE for detailed event reporting
function log(level: 'INFO' | 'WARN' | 'ERROR' | 'ACTION' | 'STATE', message: string, data?: any) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}`;
    if (data) {
        console.log(line, data);
    } else {
        console.log(line);
    }
}

// =============================================================================
// Metrics State
// =============================================================================

// For each subscribed symbol we maintain an independent TimeAndSales
// aggregator and CVD calculator.  These are created lazily when the
// first trade arrives.  We do not persist them across server restarts.
const timeAndSalesMap = new Map<string, TimeAndSales>();
const cvdMap = new Map<string, CvdCalculator>();

// Orderbook states per symbol
const orderbookMap = new Map<string, OrderbookState>();

// Absorption detectors per symbol
const absorptionMap = new Map<string, AbsorptionDetector>();

// Last absorption result per symbol
const absorptionResult = new Map<string, number>();

// Open interest monitors per symbol
const openInterestMap = new Map<string, OpenInterestMonitor>();
const lastOpenInterest: Map<string, OpenInterestMetrics> = new Map();

// Funding rate monitors per symbol
const fundingMap = new Map<string, FundingMonitor>();
const lastFunding: Map<string, FundingMetrics> = new Map();

// Legacy calculators per symbol for original metrics
const legacyMap = new Map<string, LegacyCalculator>();

/**
 * Retrieve or create the orderbook state for a symbol.
 */
function getOrderbook(symbol: string): OrderbookState {
    let state = orderbookMap.get(symbol);
    if (!state) {
        state = createOrderbookState();
        orderbookMap.set(symbol, state);
    }
    return state;
}

/**
 * Retrieve or create the absorption detector for a symbol.
 */
function getAbsorptionDetector(symbol: string): AbsorptionDetector {
    let detector = absorptionMap.get(symbol);
    if (!detector) {
        detector = new AbsorptionDetector();
        absorptionMap.set(symbol, detector);
    }
    return detector;
}

/**
 * Retrieve or create the legacy metrics calculator for a symbol.
 */
function getLegacyCalculator(symbol: string): LegacyCalculator {
    let inst = legacyMap.get(symbol);
    if (!inst) {
        inst = new LegacyCalculator();
        legacyMap.set(symbol, inst);
    }
    return inst;
}

/**
 * Retrieve or create the open interest monitor for a symbol.  The monitor
 * will immediately start polling; the latest values are stored in
 * lastOpenInterest.
 */
function getOpenInterestMonitor(symbol: string): OpenInterestMonitor {
    let monitor = openInterestMap.get(symbol);
    if (!monitor) {
        monitor = new OpenInterestMonitor(symbol);
        monitor.onUpdate(metrics => {
            lastOpenInterest.set(symbol, metrics);
        });
        // Start polling; network failures are silently ignored
        monitor.start();
        openInterestMap.set(symbol, monitor);
    }
    return monitor;
}

/**
 * Retrieve or create the funding monitor for a symbol.  Similar to
 * open interest monitors, latest metrics are stored in lastFunding.
 */
function getFundingMonitor(symbol: string): FundingMonitor {
    let monitor = fundingMap.get(symbol);
    if (!monitor) {
        monitor = new FundingMonitor(symbol);
        monitor.onUpdate(metrics => {
            lastFunding.set(symbol, metrics);
        });
        monitor.start();
        fundingMap.set(symbol, monitor);
    }
    return monitor;
}

function getTimeAndSales(symbol: string): TimeAndSales {
    let inst = timeAndSalesMap.get(symbol);
    if (!inst) {
        inst = new TimeAndSales();
        timeAndSalesMap.set(symbol, inst);
    }
    return inst;
}

function getCvdCalculator(symbol: string): CvdCalculator {
    let inst = cvdMap.get(symbol);
    if (!inst) {
        inst = new CvdCalculator();
        cvdMap.set(symbol, inst);
    }
    return inst;
}

// =============================================================================
// Binance REST API - Depth Snapshot
// =============================================================================

async function fetchBinanceDepth(symbol: string, limit: number = 1000): Promise<DepthCache | null> {
    const cleanSymbol = symbol.trim().toUpperCase();
    const url = `${BINANCE_REST_BASE}/fapi/v1/depth?symbol=${cleanSymbol}&limit=${limit}`;

    try {
        log('INFO', `Fetching depth: ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const status = response.status;
            const errorText = await response.text();

            log('ERROR', `Binance depth fetch failed: ${status} for ${cleanSymbol}. Body: ${errorText}`);

            if (status === 429 || status === 418) {
                // Rate limited - increase backoff
                const state = rateLimitState.get(cleanSymbol) || { lastRequest: 0, backoffMs: MIN_BACKOFF_MS };
                state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
                rateLimitState.set(cleanSymbol, state);
                log('WARN', `Rate limited (${status}) for ${cleanSymbol}, backoff: ${state.backoffMs}ms`);
                return null;
            }

            return null;
        }

        const data: any = await response.json();

        if (!data || !data.lastUpdateId || !Array.isArray(data.bids) || !Array.isArray(data.asks)) {
            log('ERROR', `Invalid depth data structure for ${symbol}`);
            return null;
        }

        // Reset backoff on success
        const state = rateLimitState.get(symbol) || { lastRequest: 0, backoffMs: MIN_BACKOFF_MS };
        state.backoffMs = MIN_BACKOFF_MS;
        state.lastRequest = Date.now();
        rateLimitState.set(symbol, state);

        // Update cache
        const cached: DepthCache = {
            lastUpdateId: data.lastUpdateId,
            bids: data.bids,
            asks: data.asks,
            cachedAt: Date.now()
        };
        depthCache.set(symbol, cached);

        return cached;

    } catch (error) {
        log('ERROR', `Network error fetching depth for ${symbol}`, error);
        return null;
    }
}

// =============================================================================
// Express App
// =============================================================================

const app = express();

// CORS middleware
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        if (ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
            return callback(null, true);
        }

        // Allow any origin in development (can be restricted in production)
        return callback(null, true);
    },
    credentials: true
}));

app.use(express.json());

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
    res.json({
        ok: true,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        wsClients: wsClients.size,
        binanceWsState,
        cacheSize: depthCache.size,
        activeSymbols: Array.from(currentStreamSymbols)
    });
});

// Depth snapshot endpoint
app.get('/api/depth/:symbol', async (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();
    let limit = Math.min(parseInt(req.query.limit as string) || 1000, 1000);

    // Binance Futures valid limits: 5, 10, 20, 50, 100, 500, 1000
    const validLimits = [5, 10, 20, 50, 100, 500, 1000];
    if (!validLimits.includes(limit)) {
        // Map to nearest valid limit >= requested
        limit = validLimits.find(l => l >= limit) || 1000;
    }

    // Rate limit check per symbol
    const state = rateLimitState.get(symbol) || { lastRequest: 0, backoffMs: MIN_BACKOFF_MS };
    const now = Date.now();
    const timeSinceLastRequest = now - state.lastRequest;

    // Check if we have a valid cache
    const cached = depthCache.get(symbol);
    const cacheAge = cached ? now - cached.cachedAt : Infinity;

    // If rate limited or request too soon, return cache if available
    if (timeSinceLastRequest < RATE_LIMIT_INTERVAL_MS || timeSinceLastRequest < state.backoffMs) {
        if (cached && cacheAge < CACHE_TTL_MS * 2) {
            log('INFO', `Serving cached depth for ${symbol} (throttled, age: ${cacheAge}ms)`);
            return res.json({
                lastUpdateId: cached.lastUpdateId,
                bids: cached.bids.slice(0, limit),
                asks: cached.asks.slice(0, limit),
                cachedAt: cached.cachedAt,
                source: 'cache'
            });
        }
    }

    // Try to fetch fresh data
    const freshData = await fetchBinanceDepth(symbol, limit);

    if (freshData) {
        return res.json({
            lastUpdateId: freshData.lastUpdateId,
            bids: freshData.bids.slice(0, limit),
            asks: freshData.asks.slice(0, limit),
            cachedAt: freshData.cachedAt,
            source: 'binance'
        });
    }

    // Fallback to cache
    if (cached) {
        log('WARN', `Serving stale cache for ${symbol} (fetch failed, age: ${cacheAge}ms)`);
        return res.json({
            lastUpdateId: cached.lastUpdateId,
            bids: cached.bids.slice(0, limit),
            asks: cached.asks.slice(0, limit),
            cachedAt: cached.cachedAt,
            source: 'cache'
        });
    }

    // No data available
    return res.status(503).json({
        error: 'Depth data unavailable',
        symbol,
        retryAfter: state.backoffMs
    });
});

// =============================================================================
// WebSocket Proxy
// =============================================================================

function buildStreamUrl(symbols: Set<string>): string {
    if (symbols.size === 0) return '';

    const streams = Array.from(symbols).flatMap(s => {
        const lower = s.toLowerCase();
        return [`${lower}@depth@100ms`, `${lower}@aggTrade`, `${lower}@miniTicker`];
    });

    return `${BINANCE_WS_BASE}?streams=${streams.join('/')}`;
}

function connectToBinance() {
    const allSymbols = new Set<string>();
    clientSymbols.forEach(symbols => {
        symbols.forEach(s => allSymbols.add(s));
    });

    if (allSymbols.size === 0) {
        log('INFO', 'No symbols to subscribe, closing Binance WS');
        if (binanceWs) {
            binanceWs.close();
            binanceWs = null;
        }
        binanceWsState = 'disconnected';
        currentStreamSymbols.clear();
        return;
    }

    // Check if symbols changed
    const symbolsChanged = allSymbols.size !== currentStreamSymbols.size ||
        Array.from(allSymbols).some(s => !currentStreamSymbols.has(s));

    if (!symbolsChanged && binanceWs && binanceWs.readyState === WebSocket.OPEN) {
        return; // No change needed
    }

    // Close existing connection
    if (binanceWs) {
        binanceWs.close();
        binanceWs = null;
    }

    currentStreamSymbols = allSymbols;
    binanceWsState = 'connecting';

    const url = buildStreamUrl(allSymbols);
    log('INFO', `Connecting to Binance: ${Array.from(allSymbols).join(', ')}`);

    binanceWs = new WebSocket(url);

    binanceWs.on('open', () => {
        binanceWsState = 'connected';
        reconnectAttempts = 0;
        log('INFO', `Binance WS connected: ${Array.from(allSymbols).join(', ')}`);
    });

    binanceWs.on('message', (data: Buffer) => {
        const msgStr = data.toString();
        let msg: any;
        try {
            msg = JSON.parse(msgStr);
        } catch {
            // Forward raw message to clients without metrics
            wsClients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(msgStr);
                }
            });
            return;
        }

        // If this is an aggregated trade message, update metrics
        const eventType = msg?.data?.e;
        const symbol = msg?.data?.s;
        if (eventType === 'aggTrade' && symbol) {
            const price = parseFloat(msg.data.p);
            const qty = parseFloat(msg.data.q);
            const eventTime = msg.data.T;

            // Determine aggressive side based on current orderbook best bid/ask.
            const ob = getOrderbook(symbol);
            const bid = bestBid(ob);
            const ask = bestAsk(ob);
            let side: 'buy' | 'sell' | null = null;
            if (ask !== null && price >= ask) {
                side = 'buy';
            } else if (bid !== null && price <= bid) {
                side = 'sell';
            }
            // Only aggregate metrics when side is known (aggressive) and quantity > 0
            if (side && qty > 0) {
                const tas = getTimeAndSales(symbol);
                tas.addTrade({ price, quantity: qty, side, timestamp: eventTime });
                const tasMetrics = tas.computeMetrics();
                const cvd = getCvdCalculator(symbol);
                cvd.addTrade({ price, quantity: qty, side, timestamp: eventTime });
                const cvdMetrics = cvd.computeMetrics();
                // Absorption detection requires orderbook size at price
                const levelSize = getLevelSize(ob, price) ?? 0;
                const detector = getAbsorptionDetector(symbol);
                const result = detector.addTrade(symbol, price, side, eventTime, levelSize);
                absorptionResult.set(symbol, result);
                // Update legacy metrics with this trade
                const legacy = getLegacyCalculator(symbol);
                legacy.addTrade({ price, quantity: qty, side, timestamp: eventTime });
                // Ensure monitors are created
                getOpenInterestMonitor(symbol);
                getFundingMonitor(symbol);

                // Determine UI state: if resyncing we keep RESYNCING; else stale if no depth update
                let uiState: OrderbookUiState = ob.uiState;
                const nowTs = Date.now();
                // Mark stale if no depth update in last 3 seconds and not resyncing
                if (uiState !== 'RESYNCING') {
                    if (nowTs - ob.lastDepthTime > 3000) {
                        uiState = 'STALE';
                    } else {
                        uiState = 'LIVE';
                    }
                    ob.uiState = uiState;
                }

                // Compose metrics message
                const legacyMetrics = legacy.computeMetrics(ob);
                // Compute top of book depth ladder (20 levels) and mid price
                const { bids: ladderBids, asks: ladderAsks } = getTopLevels(ob, 20);
                const bestBidPx = bestBid(ob);
                const bestAskPx = bestAsk(ob);
                const midPrice = bestBidPx !== null && bestAskPx !== null ? (bestBidPx + bestAskPx) / 2 : null;
                const metricsMsg = {
                    type: 'metrics',
                    symbol,
                    state: uiState,
                    timeAndSales: tasMetrics,
                    cvd: cvdMetrics,
                    absorption: result,
                    openInterest: lastOpenInterest.get(symbol) || null,
                    funding: lastFunding.get(symbol) || null,
                    legacyMetrics,
                    // Expose depth ladder and meta information for the UI
                    bids: ladderBids,
                    asks: ladderAsks,
                    midPrice,
                    lastUpdateId: ob.lastUpdateId
                };

                const metricsStr = JSON.stringify(metricsMsg);
                // Broadcast raw trade and metrics to subscribed clients
                wsClients.forEach(client => {
                    if (client.readyState !== WebSocket.OPEN) return;
                    const clientSubs = clientSymbols.get(client);
                    if (clientSubs && clientSubs.has(symbol)) {
                        // Raw trade
                        client.send(msgStr);
                        // Metrics
                        client.send(metricsStr);
                    }
                });
            } else {
                // If side unknown, broadcast raw trade only
                wsClients.forEach(client => {
                    if (client.readyState !== WebSocket.OPEN) return;
                    const clientSubs = clientSymbols.get(client);
                    if (clientSubs && clientSubs.has(symbol)) {
                        client.send(msgStr);
                    }
                });
            }
            return;
        }

        // Depth update handling: maintain orderbook and detect sequence gaps
        if (eventType === 'depthUpdate' && symbol) {
            const ob = getOrderbook(symbol);
            // Mark time of update for stale detection
            ob.lastDepthTime = Date.now();
            const update = msg.data;
            // Attempt to apply incremental update
            const ok = applyDepthUpdate(ob, update);
            if (!ok) {
                // Sequence gap detected; need to resync
                log('WARN', 'Sequence gap detected', { symbol, lastUpdateId: ob.lastUpdateId, updateU: update.U, updateu: update.u });
                log('ACTION', 'Incremental discard', { symbol });
                // If already resyncing, skip another fetch
                if (!ob.resyncPromise) {
                    ob.uiState = 'RESYNCING';
                    log('STATE', 'RESYNCING', { symbol });
                    // Determine backoff from rateLimitState (if set) for logging
                    const state = rateLimitState.get(symbol) || { backoffMs: MIN_BACKOFF_MS };
                    log('ACTION', 'Snapshot retry', { symbol, backoff: state.backoffMs });
                    ob.resyncPromise = fetchBinanceDepth(symbol).then(snapshot => {
                        if (snapshot) {
                            applySnapshot(ob, snapshot);
                            log('INFO', 'Snapshot success', { symbol });
                            ob.uiState = 'LIVE';
                            log('STATE', 'LIVE', { symbol });
                        }
                        ob.resyncPromise = null;
                    });
                }
            }
            // Do not broadcast depth updates directly; clients may fetch snapshots via HTTP
            return;
        }

        // For non-trade and non-depth messages, forward only to clients subscribed to the symbol
        wsClients.forEach(client => {
            if (client.readyState !== WebSocket.OPEN) return;
            try {
                // Attempt to parse and filter by symbol if present
                const symbolInMsg = msg?.data?.s;
                const clientSubs = clientSymbols.get(client);
                if (symbolInMsg && clientSubs && clientSubs.has(symbolInMsg)) {
                    client.send(msgStr);
                } else if (!symbolInMsg) {
                    // If no symbol, broadcast to all
                    client.send(msgStr);
                }
            } catch {
                // On parse error forward raw message
                client.send(msgStr);
            }
        });
    });

    binanceWs.on('error', (error) => {
        log('ERROR', 'Binance WS error', error);
    });

    binanceWs.on('close', (code, reason) => {
        binanceWsState = 'disconnected';
        log('WARN', `Binance WS closed: code=${code}, reason=${reason.toString() || 'none'}`);

        // Reconnect with jitter if clients still connected
        if (wsClients.size > 0) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
            const jitter = Math.random() * 1000;
            log('INFO', `Reconnecting in ${delay + jitter}ms (attempt ${reconnectAttempts})`);
            setTimeout(connectToBinance, delay + jitter);
        }
    });
}

// =============================================================================
// HTTP Server + WebSocket Server
// =============================================================================

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
    // Parse symbols from query string
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const symbolsParam = url.searchParams.get('symbols') || '';
    const symbols = new Set(
        symbolsParam.split(',')
            .map(s => s.trim().toUpperCase())
            .filter(s => s.length > 0)
    );

    log('INFO', `Client connected, symbols: ${Array.from(symbols).join(', ') || 'none'}`);

    wsClients.add(ws);
    clientSymbols.set(ws, symbols);

    // Trigger Binance connection update
    connectToBinance();

    ws.on('message', (data: Buffer) => {
        // Handle client messages (e.g., subscribe/unsubscribe)
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
                const clientSubs = clientSymbols.get(ws) || new Set();
                msg.symbols.forEach((s: string) => clientSubs.add(s.toUpperCase()));
                clientSymbols.set(ws, clientSubs);
                connectToBinance();
                log('INFO', `Client subscribed to: ${msg.symbols.join(', ')}`);
            }

            if (msg.type === 'unsubscribe' && Array.isArray(msg.symbols)) {
                const clientSubs = clientSymbols.get(ws);
                if (clientSubs) {
                    msg.symbols.forEach((s: string) => clientSubs.delete(s.toUpperCase()));
                    connectToBinance();
                    log('INFO', `Client unsubscribed from: ${msg.symbols.join(', ')}`);
                }
            }
        } catch {
            // Ignore invalid messages
        }
    });

    ws.on('close', () => {
        log('INFO', 'Client disconnected');
        wsClients.delete(ws);
        clientSymbols.delete(ws);
        connectToBinance();
    });

    ws.on('error', (error) => {
        log('ERROR', 'Client WS error', error);
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({
        type: 'connected',
        symbols: Array.from(symbols),
        timestamp: Date.now()
    }));
});

// =============================================================================
// Start Server
// =============================================================================

server.listen(PORT, '0.0.0.0', () => {
    log('INFO', `Binance Proxy Server running on port ${PORT} (0.0.0.0)`);
    log('INFO', `Health endpoint: http://localhost:${PORT}/health`);
    log('INFO', `Depth endpoint: http://localhost:${PORT}/api/depth/:symbol`);
    log('INFO', `WebSocket endpoint: ws://localhost:${PORT}/ws?symbols=BTCUSDT,ETHUSDT`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down...');
    if (binanceWs) binanceWs.close();
    wsClients.forEach(client => client.close());
    server.close(() => {
        log('INFO', 'Server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    log('INFO', 'SIGTERM received, shutting down...');
    if (binanceWs) binanceWs.close();
    wsClients.forEach(client => client.close());
    server.close(() => process.exit(0));
});