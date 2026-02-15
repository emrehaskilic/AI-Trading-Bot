import { decimalToNumber, mulDecimal, parseDecimal, parseDecimalSafe } from '../utils/decimal';
import { ExecutionDecision, ExecutionResult } from '../execution/types';
import { IPositionManager, OpenTrade } from './types';

export class PositionManager implements IPositionManager {
  private readonly openTrades = new Map<string, OpenTrade>();
  private readonly symbolPositions = new Map<string, bigint>();
  private currentAccountBalance: bigint;
  private readonly initialCapital: bigint;

  constructor(initialCapital: number) {
    this.initialCapital = parseDecimal(String(initialCapital));
    this.currentAccountBalance = this.initialCapital;
  }

  recordExecution(decision: ExecutionDecision, result: ExecutionResult): void {
    if (!result.ok || !result.orderId) return;
    const executedQty = result.executedQuantity || decision.quantity;
    const executedPrice = result.executedPrice || decision.price;
    const fee = result.fee || '0';

    const trade: OpenTrade = {
      orderId: result.orderId,
      symbol: decision.symbol,
      side: decision.side,
      quantity: executedQty,
      entryPrice: executedPrice,
      timestamp: Date.now(),
      fees: fee,
      feeAsset: result.feeAsset || 'USDT',
    };

    this.openTrades.set(result.orderId, trade);

    const qtyFp = parseDecimal(executedQty);
    const signedQty = decision.side === 'BUY' ? qtyFp : -qtyFp;
    const currentPosition = this.symbolPositions.get(decision.symbol) || 0n;
    this.symbolPositions.set(decision.symbol, currentPosition + signedQty);

    const feeFp = parseDecimalSafe(fee);
    this.currentAccountBalance -= feeFp;
  }

  getPosition(symbol: string): number {
    const qty = this.symbolPositions.get(symbol) || 0n;
    return decimalToNumber(qty);
  }

  getOpenTrades(symbol: string): OpenTrade[] {
    return Array.from(this.openTrades.values()).filter((trade) => trade.symbol === symbol);
  }

  closeTrade(orderId: string, closePrice: string, fees: string): void {
    const trade = this.openTrades.get(orderId);
    if (!trade) return;

    const entryPriceFp = parseDecimal(trade.entryPrice);
    const closePriceFp = parseDecimal(closePrice);
    const qtyFp = parseDecimal(trade.quantity);

    const priceDelta = closePriceFp - entryPriceFp;
    const grossPnl = mulDecimal(priceDelta, qtyFp);
    const signedPnl = trade.side === 'BUY' ? grossPnl : -grossPnl;

    const openFee = parseDecimalSafe(trade.fees);
    const closeFee = parseDecimalSafe(fees);
    const netPnl = signedPnl - openFee - closeFee;

    this.currentAccountBalance += netPnl;
    this.openTrades.delete(orderId);

    const currentPosition = this.symbolPositions.get(trade.symbol) || 0n;
    const signedQty = trade.side === 'BUY' ? qtyFp : -qtyFp;
    this.symbolPositions.set(trade.symbol, currentPosition - signedQty);
  }

  getAccountBalance(): number {
    return decimalToNumber(this.currentAccountBalance);
  }

  getInitialCapital(): number {
    return decimalToNumber(this.initialCapital);
  }
}
