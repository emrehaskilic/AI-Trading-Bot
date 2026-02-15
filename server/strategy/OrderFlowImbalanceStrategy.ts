import { ExecutionDecision, IExecutor } from '../execution/types';
import { IPositionManager, OpenTrade } from '../position/types';
import { IMetricsCollector } from '../metrics/types';
import { OrderBook, Trade, IStrategy } from './types';

const toDecimalString = (value: number, decimals = 8): string => {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(decimals);
};

export class OrderFlowImbalanceStrategy implements IStrategy {
  private readonly symbol: string;
  private readonly executor: IExecutor;
  private readonly positionManager: IPositionManager;
  private readonly metricsCollector: IMetricsCollector;
  private lastOrderBook: OrderBook | null = null;

  private imbalanceThreshold = 0.6;
  private quantityPerTradeRatio = 0.001;
  private maxPositionQuantity = 0.05;
  private profitTargetRatio = 0.0005;
  private stopLossRatio = 0.0002;

  constructor(
    symbol: string,
    executor: IExecutor,
    positionManager: IPositionManager,
    metricsCollector: IMetricsCollector,
    config?: {
      imbalanceThreshold?: number;
      quantityPerTradeRatio?: number;
      maxPositionQuantity?: number;
      profitTargetRatio?: number;
      stopLossRatio?: number;
    }
  ) {
    this.symbol = symbol;
    this.executor = executor;
    this.positionManager = positionManager;
    this.metricsCollector = metricsCollector;
    if (config) {
      Object.assign(this, config);
    }
  }

  onOrderBookUpdate(orderBook: OrderBook): void {
    this.lastOrderBook = orderBook;
    this.evaluateSignal();
    this.manageOpenPositions();
  }

  onTradeUpdate(_trade: Trade): void {
    // Trade updates can be incorporated later.
  }

  private evaluateSignal(): void {
    if (!this.lastOrderBook) return;
    const { bids, asks } = this.lastOrderBook;
    if (bids.length === 0 || asks.length === 0) return;

    const bestBid = bids[0];
    const bestAsk = asks[0];
    const bidVolume = bestBid.quantity;
    const askVolume = bestAsk.quantity;
    const totalVolume = bidVolume + askVolume;
    if (totalVolume <= 0) return;

    const imbalance = bidVolume / totalVolume;
    const currentPosition = this.positionManager.getPosition(this.symbol);
    const quantityToTrade = this.calculateQuantityPerTrade(bestAsk.price);
    if (quantityToTrade <= 0) return;

    if (imbalance > this.imbalanceThreshold && currentPosition < this.maxPositionQuantity) {
      const decision: ExecutionDecision = {
        symbol: this.symbol,
        side: 'BUY',
        price: toDecimalString(bestAsk.price),
        quantity: toDecimalString(quantityToTrade),
        type: 'LIMIT',
        timeInForce: 'POST_ONLY',
      };
      this.executor.execute(decision).then((result) => {
        if (result.ok) {
          this.positionManager.recordExecution(decision, result);
          this.metricsCollector.recordExecution(decision, result);
        }
      });
    } else if (imbalance < (1 - this.imbalanceThreshold) && currentPosition > -this.maxPositionQuantity) {
      const decision: ExecutionDecision = {
        symbol: this.symbol,
        side: 'SELL',
        price: toDecimalString(bestBid.price),
        quantity: toDecimalString(quantityToTrade),
        type: 'LIMIT',
        timeInForce: 'POST_ONLY',
      };
      this.executor.execute(decision).then((result) => {
        if (result.ok) {
          this.positionManager.recordExecution(decision, result);
          this.metricsCollector.recordExecution(decision, result);
        }
      });
    }
  }

  private calculateQuantityPerTrade(currentPrice: number): number {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;
    const accountBalance = this.positionManager.getAccountBalance();
    const quantityBasedOnBalance = (accountBalance * this.quantityPerTradeRatio) / currentPrice;
    return Math.min(quantityBasedOnBalance, this.maxPositionQuantity);
  }

  private manageOpenPositions(): void {
    const openTrades = this.positionManager.getOpenTrades(this.symbol);
    if (!openTrades.length || !this.lastOrderBook) return;

    const currentMidPrice = (this.lastOrderBook.bids[0].price + this.lastOrderBook.asks[0].price) / 2;
    if (!Number.isFinite(currentMidPrice) || currentMidPrice <= 0) return;

    openTrades.forEach((trade) => {
      const entryPrice = Number(trade.entryPrice);
      const qty = Number(trade.quantity);
      if (!Number.isFinite(entryPrice) || !Number.isFinite(qty) || qty <= 0) return;
      const pnl = (currentMidPrice - entryPrice) * qty * (trade.side === 'BUY' ? 1 : -1);
      const pnlRatio = pnl / (entryPrice * qty);

      if (pnlRatio >= this.profitTargetRatio) {
        this.closePosition(trade, currentMidPrice);
      } else if (pnlRatio <= -this.stopLossRatio) {
        this.closePosition(trade, currentMidPrice);
      }
    });
  }

  private closePosition(trade: OpenTrade, closePrice: number): void {
    const decision: ExecutionDecision = {
      symbol: trade.symbol,
      side: trade.side === 'BUY' ? 'SELL' : 'BUY',
      price: toDecimalString(closePrice),
      quantity: trade.quantity,
      type: 'MARKET',
      reduceOnly: true,
    };
    this.executor.execute(decision).then((result) => {
      if (result.ok) {
        this.positionManager.closeTrade(trade.orderId, decision.price, result.fee || '0');
        const entryPrice = Number(trade.entryPrice);
        const qty = Number(trade.quantity);
        const pnl = (closePrice - entryPrice) * qty * (trade.side === 'BUY' ? 1 : -1);
        this.metricsCollector.recordPnL(pnl);
      }
    });
  }
}
