import { DryRunEngine } from './DryRunEngine';
import { DryRunConfig, DryRunEventInput, DryRunEventLog, DryRunOrderBook, DryRunOrderRequest, DryRunStateSnapshot } from './types';

export interface DryRunSessionStartInput {
  symbols?: string[];
  symbol?: string;
  runId?: string;
  walletBalanceStartUsdt: number;
  initialMarginUsdt: number;
  leverage: number;
  takerFeeRate?: number;
  maintenanceMarginRate?: number;
  fundingRate?: number;
  fundingRates?: Record<string, number>;
  fundingIntervalMs?: number;
  heartbeatIntervalMs?: number;
  debugAggressiveEntry?: boolean;
}

export interface DryRunConsoleLog {
  seq: number;
  timestampMs: number;
  symbol: string | null;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

export interface DryRunSymbolStatus {
  symbol: string;
  metrics: {
    markPrice: number;
    totalEquity: number;
    walletBalance: number;
    unrealizedPnl: number;
    realizedPnl: number;
    feePaid: number;
    fundingPnl: number;
    marginHealth: number;
  };
  position: {
    side: 'LONG' | 'SHORT';
    qty: number;
    entryPrice: number;
    markPrice: number;
    liqPrice: null;
  } | null;
  openLimitOrders: DryRunStateSnapshot['openLimitOrders'];
  lastEventTimestampMs: number;
  eventCount: number;
}

export interface DryRunSessionStatus {
  running: boolean;
  runId: string | null;
  symbols: string[];
  config: {
    walletBalanceStartUsdt: number;
    initialMarginUsdt: number;
    leverage: number;
    takerFeeRate: number;
    maintenanceMarginRate: number;
    fundingIntervalMs: number;
    heartbeatIntervalMs: number;
    debugAggressiveEntry: boolean;
  } | null;
  summary: {
    totalEquity: number;
    walletBalance: number;
    unrealizedPnl: number;
    realizedPnl: number;
    feePaid: number;
    fundingPnl: number;
    marginHealth: number;
  };
  perSymbol: Record<string, DryRunSymbolStatus>;
  logTail: DryRunConsoleLog[];
}

type SymbolSession = {
  symbol: string;
  engine: DryRunEngine;
  fundingRate: number;
  lastEventTimestampMs: number;
  lastState: DryRunStateSnapshot;
  latestMarkPrice: number;
  lastMarkPrice: number;
  lastEntryEventTs: number;
  lastHeartbeatTs: number;
  lastDataLogTs: number;
  lastEmptyBookLogTs: number;
  realizedPnl: number;
  feePaid: number;
  fundingPnl: number;
  eventCount: number;
  manualOrders: DryRunOrderRequest[];
  logTail: DryRunEventLog[];
};

const DEFAULT_TAKER_FEE_RATE = 0.0004;
const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;
const DEFAULT_FUNDING_RATE = 0;
const DEFAULT_FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_EVENT_INTERVAL_MS = Number(process.env.DRY_RUN_EVENT_INTERVAL_MS || 250);
const DEFAULT_ORDERBOOK_DEPTH = Number(process.env.DRY_RUN_ORDERBOOK_DEPTH || 20);
const DEFAULT_TP_BPS = Number(process.env.DRY_RUN_TP_BPS || 15);
const DEFAULT_STOP_BPS = Number(process.env.DRY_RUN_STOP_BPS || 35);
const DEFAULT_ENTRY_COOLDOWN_MS = Number(process.env.DRY_RUN_ENTRY_COOLDOWN_MS || 5000);
const DEFAULT_HEARTBEAT_INTERVAL_MS = Number(process.env.DRY_RUN_HEARTBEAT_INTERVAL_MS || 10_000);
const CONSOLE_LOG_TAIL_LIMIT = Number(process.env.DRY_RUN_CONSOLE_TAIL_LIMIT || 500);
const ENGINE_LOG_TAIL_LIMIT = Number(process.env.DRY_RUN_ENGINE_TAIL_LIMIT || 120);

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

function roundTo(value: number, decimals: number): number {
  const m = Math.pow(10, Math.max(0, decimals));
  return Math.round(value * m) / m;
}

function normalizeSymbols(input: { symbols?: string[]; symbol?: string }): string[] {
  const out: string[] = [];
  if (Array.isArray(input.symbols)) {
    for (const raw of input.symbols) {
      const s = normalizeSymbol(String(raw || ''));
      if (s && !out.includes(s)) out.push(s);
    }
  }
  if (out.length === 0 && input.symbol) {
    const s = normalizeSymbol(input.symbol);
    if (s) out.push(s);
  }
  return out;
}

export class DryRunSessionService {
  private running = false;
  private runId: string | null = null;
  private runCounter = 0;
  private consoleSeq = 0;

  private config: DryRunSessionStatus['config'] = null;
  private symbols: string[] = [];
  private sessions = new Map<string, SymbolSession>();
  private logTail: DryRunConsoleLog[] = [];

  start(input: DryRunSessionStartInput): DryRunSessionStatus {
    const symbols = normalizeSymbols(input);
    if (symbols.length === 0) {
      throw new Error('symbols_required');
    }

    const walletBalanceStartUsdt = finiteOr(input.walletBalanceStartUsdt, 5000);
    const initialMarginUsdt = finiteOr(input.initialMarginUsdt, 200);
    const leverage = finiteOr(input.leverage, 10);

    if (!(walletBalanceStartUsdt > 0)) throw new Error('wallet_balance_start_must_be_positive');
    if (!(initialMarginUsdt > 0)) throw new Error('initial_margin_must_be_positive');
    if (!(leverage > 0)) throw new Error('leverage_must_be_positive');

    this.runCounter += 1;
    const runIdBase = String(input.runId || `dryrun-${this.runCounter}`);
    const takerFeeRate = finiteOr(input.takerFeeRate, DEFAULT_TAKER_FEE_RATE);
    const maintenanceMarginRate = finiteOr(input.maintenanceMarginRate, DEFAULT_MAINTENANCE_MARGIN_RATE);
    const fundingIntervalMs = Math.max(1, Math.trunc(finiteOr(input.fundingIntervalMs, DEFAULT_FUNDING_INTERVAL_MS)));
    const heartbeatIntervalMs = Math.max(1_000, Math.trunc(finiteOr(input.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS)));
    const debugAggressiveEntry = Boolean(input.debugAggressiveEntry);

    this.running = true;
    this.runId = runIdBase;
    this.symbols = [...symbols];
    this.sessions.clear();
    this.logTail = [];
    this.consoleSeq = 0;

    this.config = {
      walletBalanceStartUsdt,
      initialMarginUsdt,
      leverage,
      takerFeeRate,
      maintenanceMarginRate,
      fundingIntervalMs,
      heartbeatIntervalMs,
      debugAggressiveEntry,
    };

    for (const symbol of this.symbols) {
      const fundingRate = Number.isFinite(input.fundingRates?.[symbol] as number)
        ? Number(input.fundingRates?.[symbol])
        : finiteOr(input.fundingRate, DEFAULT_FUNDING_RATE);

      const cfg: DryRunConfig = {
        runId: `${runIdBase}-${symbol}`,
        walletBalanceStartUsdt,
        initialMarginUsdt,
        leverage,
        takerFeeRate,
        maintenanceMarginRate,
        fundingRate,
        fundingIntervalMs,
        proxy: {
          mode: 'backend-proxy',
          restBaseUrl: 'https://fapi.binance.com',
          marketWsBaseUrl: 'wss://fstream.binance.com/stream',
        },
      };

      const engine = new DryRunEngine(cfg);
      const lastState = engine.getStateSnapshot();
      this.sessions.set(symbol, {
        symbol,
        engine,
        fundingRate,
        lastEventTimestampMs: 0,
        lastState,
        latestMarkPrice: 0,
        lastMarkPrice: 0,
        lastEntryEventTs: 0,
        lastHeartbeatTs: 0,
        lastDataLogTs: 0,
        lastEmptyBookLogTs: 0,
        realizedPnl: 0,
        feePaid: 0,
        fundingPnl: 0,
        eventCount: 0,
        manualOrders: [],
        logTail: [],
      });
    }

    this.addConsoleLog('INFO', null, `Dry Run Initialized with pairs: [${this.symbols.join(', ')}]`, 0);
    for (const symbol of this.symbols) {
      this.addConsoleLog('INFO', symbol, `Session ready. Funding rate=${this.sessions.get(symbol)?.fundingRate ?? 0}`, 0);
    }

    return this.getStatus();
  }

  stop(): DryRunSessionStatus {
    if (this.running) {
      this.addConsoleLog('INFO', null, 'Dry Run stopped by user.', 0);
    }
    this.running = false;
    return this.getStatus();
  }

  reset(): DryRunSessionStatus {
    this.running = false;
    this.runId = null;
    this.symbols = [];
    this.config = null;
    this.sessions.clear();
    this.logTail = [];
    this.consoleSeq = 0;
    return this.getStatus();
  }

  getActiveSymbols(): string[] {
    return this.running ? [...this.symbols] : [];
  }

  isTrackingSymbol(symbol: string): boolean {
    const normalized = normalizeSymbol(symbol);
    return this.running && this.sessions.has(normalized);
  }

  submitManualTestOrder(symbol: string, side: 'BUY' | 'SELL' = 'BUY'): DryRunSessionStatus {
    const normalized = normalizeSymbol(symbol);
    const session = this.sessions.get(normalized);
    if (!this.running || !session || !this.config) {
      throw new Error('dry_run_not_running_for_symbol');
    }

    const referencePrice = session.latestMarkPrice > 0
      ? session.latestMarkPrice
      : (session.lastState.position?.entryPrice || 1);
    const qty = roundTo((this.config.initialMarginUsdt * this.config.leverage) / referencePrice, 6);
    if (!(qty > 0)) {
      throw new Error('manual_test_qty_invalid');
    }

    session.manualOrders.push({
      side,
      type: 'MARKET',
      qty,
      timeInForce: 'IOC',
      reduceOnly: false,
    });

    this.addConsoleLog('INFO', normalized, `Manual test order queued: ${side} ${qty}`, session.lastEventTimestampMs);
    return this.getStatus();
  }

  ingestDepthEvent(input: {
    symbol: string;
    eventTimestampMs: number;
    orderBook: DryRunOrderBook;
    markPrice?: number;
  }): DryRunSessionStatus | null {
    if (!this.running || !this.config) return null;

    const symbol = normalizeSymbol(input.symbol);
    const session = this.sessions.get(symbol);
    if (!session) return null;

    const eventTimestampMs = Number(input.eventTimestampMs);
    if (!Number.isFinite(eventTimestampMs) || eventTimestampMs <= 0) return null;
    if (session.lastEventTimestampMs > 0 && eventTimestampMs <= session.lastEventTimestampMs) return null;
    if (session.lastEventTimestampMs > 0 && (eventTimestampMs - session.lastEventTimestampMs) < DEFAULT_EVENT_INTERVAL_MS) {
      return null;
    }

    const book = this.normalizeBook(input.orderBook);
    if (book.bids.length === 0 || book.asks.length === 0) {
      if (session.lastEmptyBookLogTs === 0 || (eventTimestampMs - session.lastEmptyBookLogTs) >= this.config.heartbeatIntervalMs) {
        this.addConsoleLog('WARN', symbol, 'Orderbook empty on one side. Waiting for full depth.', eventTimestampMs);
        session.lastEmptyBookLogTs = eventTimestampMs;
      }
      return null;
    }

    const bestBid = book.bids[0].price;
    const bestAsk = book.asks[0].price;
    const resolvedMarkPriceRaw = Number.isFinite(input.markPrice as number) && Number(input.markPrice) > 0
      ? Number(input.markPrice)
      : (bestBid + bestAsk) / 2;
    const markPrice = roundTo(resolvedMarkPriceRaw, 8);
    if (!(markPrice > 0)) return null;

    const orders = this.buildDeterministicOrders(session, markPrice, eventTimestampMs);
    const event: DryRunEventInput = {
      timestampMs: eventTimestampMs,
      markPrice,
      orderBook: book,
      orders,
    };

    const out = session.engine.processEvent(event);

    const lastCheckMs = session.lastHeartbeatTs > 0 ? eventTimestampMs - session.lastHeartbeatTs : eventTimestampMs;
    session.lastEventTimestampMs = eventTimestampMs;
    session.lastState = out.state;
    session.lastMarkPrice = session.latestMarkPrice;
    session.latestMarkPrice = markPrice;
    session.realizedPnl += out.log.realizedPnl;
    session.feePaid += out.log.fee;
    session.fundingPnl += out.log.fundingImpact;
    session.eventCount += 1;
    session.logTail.push(out.log);
    if (session.logTail.length > ENGINE_LOG_TAIL_LIMIT) {
      session.logTail = session.logTail.slice(session.logTail.length - ENGINE_LOG_TAIL_LIMIT);
    }

    if (session.lastDataLogTs === 0 || (eventTimestampMs - session.lastDataLogTs) >= 2_000) {
      this.addConsoleLog('INFO', symbol, `Market Data Received: ${symbol} @ ${markPrice}`, eventTimestampMs);
      session.lastDataLogTs = eventTimestampMs;
    }

    if (session.lastHeartbeatTs === 0 || (eventTimestampMs - session.lastHeartbeatTs) >= this.config.heartbeatIntervalMs) {
      const seconds = Math.max(1, Math.floor(lastCheckMs / 1000));
      this.addConsoleLog(
        'INFO',
        symbol,
        `Running... Scanning ${symbol}. Current Price: ${markPrice}. Last Check: ${seconds}s ago.`,
        eventTimestampMs
      );
      session.lastHeartbeatTs = eventTimestampMs;
    }

    if (out.log.fundingImpact !== 0) {
      this.addConsoleLog('INFO', symbol, `Funding applied: ${roundTo(out.log.fundingImpact, 8)} USDT`, eventTimestampMs);
    }

    if (out.log.orderResults.length > 0) {
      for (const order of out.log.orderResults) {
        this.addConsoleLog(
          'INFO',
          symbol,
          `Order ${order.type}/${order.side} ${order.status} fill=${roundTo(order.filledQty, 6)}/${roundTo(order.requestedQty, 6)} avg=${roundTo(order.avgFillPrice, 4)}`,
          eventTimestampMs
        );
      }
    }

    if (out.log.liquidationTriggered) {
      this.addConsoleLog('WARN', symbol, 'Liquidation triggered. Position force-closed.', eventTimestampMs);
    }

    return this.getStatus();
  }

  getStatus(): DryRunSessionStatus {
    const perSymbol: Record<string, DryRunSymbolStatus> = {};

    let totalEquity = 0;
    let walletBalance = 0;
    let unrealizedPnl = 0;
    let realizedPnl = 0;
    let feePaid = 0;
    let fundingPnl = 0;
    let marginHealth = 0;
    let marginHealthInit = false;

    for (const symbol of this.symbols) {
      const session = this.sessions.get(symbol);
      if (!session) continue;

      const symbolWallet = session.lastState.walletBalance;
      const symbolUnrealized = this.computeUnrealizedPnl(session);
      const symbolEquity = symbolWallet + symbolUnrealized;
      const symbolMarginHealth = session.lastState.marginHealth;

      totalEquity += symbolEquity;
      walletBalance += symbolWallet;
      unrealizedPnl += symbolUnrealized;
      realizedPnl += session.realizedPnl;
      feePaid += session.feePaid;
      fundingPnl += session.fundingPnl;
      if (!marginHealthInit) {
        marginHealth = symbolMarginHealth;
        marginHealthInit = true;
      } else {
        marginHealth = Math.min(marginHealth, symbolMarginHealth);
      }

      perSymbol[symbol] = {
        symbol,
        metrics: {
          markPrice: session.latestMarkPrice,
          totalEquity: roundTo(symbolEquity, 8),
          walletBalance: roundTo(symbolWallet, 8),
          unrealizedPnl: roundTo(symbolUnrealized, 8),
          realizedPnl: roundTo(session.realizedPnl, 8),
          feePaid: roundTo(session.feePaid, 8),
          fundingPnl: roundTo(session.fundingPnl, 8),
          marginHealth: roundTo(symbolMarginHealth, 8),
        },
        position: session.lastState.position
          ? {
              side: session.lastState.position.side,
              qty: session.lastState.position.qty,
              entryPrice: session.lastState.position.entryPrice,
              markPrice: session.latestMarkPrice,
              liqPrice: null,
            }
          : null,
        openLimitOrders: session.lastState.openLimitOrders,
        lastEventTimestampMs: session.lastEventTimestampMs,
        eventCount: session.eventCount,
      };
    }

    return {
      running: this.running,
      runId: this.runId,
      symbols: [...this.symbols],
      config: this.config,
      summary: {
        totalEquity: roundTo(totalEquity, 8),
        walletBalance: roundTo(walletBalance, 8),
        unrealizedPnl: roundTo(unrealizedPnl, 8),
        realizedPnl: roundTo(realizedPnl, 8),
        feePaid: roundTo(feePaid, 8),
        fundingPnl: roundTo(fundingPnl, 8),
        marginHealth: roundTo(marginHealthInit ? marginHealth : 0, 8),
      },
      perSymbol,
      logTail: [...this.logTail],
    };
  }

  private normalizeBook(orderBook: DryRunOrderBook): DryRunOrderBook {
    const depth = Math.max(1, Math.trunc(DEFAULT_ORDERBOOK_DEPTH));
    const normalize = (levels: Array<{ price: number; qty: number }>, asc: boolean) => {
      const sorted = levels
        .filter((l) => Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.qty) && l.qty > 0)
        .map((l) => ({ price: Number(l.price), qty: Number(l.qty) }))
        .sort((a, b) => asc ? a.price - b.price : b.price - a.price);
      return sorted.slice(0, depth);
    };

    return {
      bids: normalize(orderBook.bids || [], false),
      asks: normalize(orderBook.asks || [], true),
    };
  }

  private buildDeterministicOrders(session: SymbolSession, markPrice: number, eventTimestampMs: number): DryRunOrderRequest[] {
    if (!this.config) {
      return [];
    }

    if (session.manualOrders.length > 0) {
      return [session.manualOrders.shift() as DryRunOrderRequest];
    }

    const state = session.lastState;
    const orders: DryRunOrderRequest[] = [];
    const entryCooldownMs = this.config.debugAggressiveEntry
      ? Math.max(500, Math.trunc(DEFAULT_ENTRY_COOLDOWN_MS / 2))
      : Math.max(0, Math.trunc(DEFAULT_ENTRY_COOLDOWN_MS));
    const hasOpenLimits = state.openLimitOrders.length > 0;

    if (!state.position && !hasOpenLimits) {
      if (session.lastEntryEventTs === 0 || (eventTimestampMs - session.lastEntryEventTs) >= entryCooldownMs) {
        const side: 'BUY' | 'SELL' = this.resolveEntrySide(session, markPrice);
        const targetNotional = this.config.initialMarginUsdt * this.config.leverage;
        const qtyRaw = targetNotional / markPrice;
        const qty = roundTo(Math.max(0, qtyRaw), 6);
        if (qty > 0) {
          orders.push({ side, type: 'MARKET', qty, timeInForce: 'IOC', reduceOnly: false });
          session.lastEntryEventTs = eventTimestampMs;
        }
      }
      return orders;
    }

    if (!state.position) {
      return orders;
    }

    const position = state.position;
    if (!hasOpenLimits) {
      const tpBps = Math.max(1, DEFAULT_TP_BPS);
      const isLong = position.side === 'LONG';
      const multiplier = isLong ? (1 + (tpBps / 10000)) : (1 - (tpBps / 10000));
      const tpPrice = roundTo(position.entryPrice * multiplier, 8);
      const closeSide: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
      orders.push({
        side: closeSide,
        type: 'LIMIT',
        qty: roundTo(position.qty, 6),
        price: tpPrice,
        timeInForce: 'GTC',
        reduceOnly: true,
      });
      return orders;
    }

    const stopBps = Math.max(1, DEFAULT_STOP_BPS);
    const isLong = position.side === 'LONG';
    const pnlBps = isLong
      ? ((markPrice - position.entryPrice) / position.entryPrice) * 10000
      : ((position.entryPrice - markPrice) / position.entryPrice) * 10000;
    if (pnlBps <= -stopBps) {
      const closeSide: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
      orders.push({
        side: closeSide,
        type: 'MARKET',
        qty: roundTo(position.qty, 6),
        timeInForce: 'IOC',
        reduceOnly: true,
      });
    }

    return orders;
  }

  private resolveEntrySide(session: SymbolSession, markPrice: number): 'BUY' | 'SELL' {
    if (session.lastMarkPrice <= 0) {
      return 'BUY';
    }
    return markPrice >= session.lastMarkPrice ? 'BUY' : 'SELL';
  }

  private computeUnrealizedPnl(session: SymbolSession): number {
    if (!session.lastState.position || !(session.latestMarkPrice > 0)) {
      return 0;
    }
    const pos = session.lastState.position;
    if (pos.side === 'LONG') {
      return (session.latestMarkPrice - pos.entryPrice) * pos.qty;
    }
    return (pos.entryPrice - session.latestMarkPrice) * pos.qty;
  }

  private addConsoleLog(
    level: 'INFO' | 'WARN' | 'ERROR',
    symbol: string | null,
    message: string,
    timestampMs: number
  ): void {
    this.consoleSeq += 1;
    const logItem: DryRunConsoleLog = {
      seq: this.consoleSeq,
      timestampMs: timestampMs > 0 ? timestampMs : Date.now(),
      symbol,
      level,
      message,
    };
    this.logTail.push(logItem);
    if (this.logTail.length > CONSOLE_LOG_TAIL_LIMIT) {
      this.logTail = this.logTail.slice(this.logTail.length - CONSOLE_LOG_TAIL_LIMIT);
    }
  }
}
