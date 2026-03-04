/**
 * PnL Calculator - Phase 4 Analytics
 * 
 * Calculates realized, unrealized PnL and fee breakdowns.
 */

import {
  FillEvent,
  PositionUpdateEvent,
  RealizedPnL,
  UnrealizedPnL,
  FeeBreakdown,
  TradeLifecycle,
} from './types';

interface PositionState {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  qty: number;
  avgEntryPrice: number;
  totalFees: number;
  realizedPnl: number;
}

export class PnLCalculator {
  private positions = new Map<string, PositionState>();
  private realizedPnL = new Map<string, RealizedPnL>();
  private unrealizedBySymbol = new Map<string, UnrealizedPnL>();
  private feeBreakdown = new Map<string, FeeBreakdown>();
  private trades = new Map<string, TradeLifecycle>();
  private tradeCounter = 0;

  /**
   * Process a fill event and update PnL calculations
   */
  processFill(fill: FillEvent): void {
    const { symbol, side, qty, price, fee, feeType } = fill;
    
    // Get or create position
    let position = this.positions.get(symbol);
    if (!position) {
      position = {
        symbol,
        side: 'FLAT',
        qty: 0,
        avgEntryPrice: 0,
        totalFees: 0,
        realizedPnl: 0,
      };
      this.positions.set(symbol, position);
    }

    // Get or create fee breakdown
    let fees = this.feeBreakdown.get(symbol);
    if (!fees) {
      fees = {
        symbol,
        totalFees: 0,
        makerFees: 0,
        takerFees: 0,
        makerVolume: 0,
        takerVolume: 0,
        makerFeeCount: 0,
        takerFeeCount: 0,
      };
      this.feeBreakdown.set(symbol, fees);
    }

    let stats = this.realizedPnL.get(symbol);
    if (!stats) {
      stats = {
        symbol,
        totalRealizedPnl: 0,
        grossPnl: 0,
        totalFees: 0,
        makerFees: 0,
        takerFees: 0,
        tradeCount: 0,
        winningTrades: 0,
        losingTrades: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
      };
      this.realizedPnL.set(symbol, stats);
    }

    // Update fees
    fees.totalFees += fee;
    if (feeType === 'maker') {
      fees.makerFees += fee;
      fees.makerVolume += qty * price;
      fees.makerFeeCount++;
    } else {
      fees.takerFees += fee;
      fees.takerVolume += qty * price;
      fees.takerFeeCount++;
    }
    stats.totalFees += fee;
    if (feeType === 'maker') {
      stats.makerFees += fee;
    } else {
      stats.takerFees += fee;
    }

    // Calculate position changes
    const isBuy = side === 'BUY';
    const isLong = position.side === 'LONG';
    const isShort = position.side === 'SHORT';
    const isFlat = position.side === 'FLAT';

    // Determine if this is opening, adding, reducing, or flipping
    const isOpening = isFlat;
    const isAdding = (isLong && isBuy) || (isShort && !isBuy);
    const isReducing = (isLong && !isBuy) || (isShort && isBuy);
    const isFlipping = isReducing && qty > position.qty;

    if (isOpening || isAdding) {
      // Opening new position or adding to existing
      const newQty = isFlat ? qty : position.qty + qty;
      const totalCost = isFlat 
        ? qty * price 
        : position.qty * position.avgEntryPrice + qty * price;
      
      position.avgEntryPrice = totalCost / newQty;
      position.qty = newQty;
      position.side = isBuy ? 'LONG' : 'SHORT';

      // Create new trade record
      this.tradeCounter++;
      const tradeId = `${symbol}-${this.tradeCounter}`;
      const trade: TradeLifecycle = {
        tradeId,
        symbol,
        side: position.side,
        entryTimestamp: fill.timestamp,
        entryPrice: price,
        entryQty: qty,
        entryOrderId: fill.orderId,
        entrySlippageBps: 0, // Will be set by ExecutionAnalytics
        exitTimestamp: null,
        exitPrice: null,
        exitQty: null,
        exitOrderId: null,
        exitSlippageBps: null,
        status: 'OPEN',
        realizedPnl: 0,
        fees: fee,
        netPnl: -fee,
        mfeMae: null,
        timeUnderWater: null,
        adverseSelection: null,
        priceHistory: [{
          timestamp: fill.timestamp,
          price,
          markPrice: price,
        }],
      };
      this.trades.set(tradeId, trade);

    } else if (isReducing) {
      // Reducing position (partial or full close, or flip)
      const closeQty = Math.min(qty, position.qty);
      const entryValue = closeQty * position.avgEntryPrice;
      const exitValue = closeQty * price;
      
      // Calculate realized PnL
      const sideMultiplier = position.side === 'LONG' ? 1 : -1;
      const tradeRealizedPnl = (exitValue - entryValue) * sideMultiplier;
      
      position.realizedPnl += tradeRealizedPnl;

      // Update realized PnL stats
      stats.totalRealizedPnl += tradeRealizedPnl;
      stats.grossPnl += tradeRealizedPnl;
      stats.tradeCount++;

      if (tradeRealizedPnl > 0) {
        stats.winningTrades++;
        stats.largestWin = Math.max(stats.largestWin, tradeRealizedPnl);
      } else {
        stats.losingTrades++;
        stats.largestLoss = Math.min(stats.largestLoss, tradeRealizedPnl);
      }

      // Recalculate averages
      if (stats.winningTrades > 0) {
        const totalWins = stats.grossPnl > 0 ? stats.grossPnl : 0;
        stats.avgWin = totalWins / stats.winningTrades;
      }
      if (stats.losingTrades > 0) {
        const totalLosses = stats.grossPnl < 0 ? Math.abs(stats.grossPnl) : 0;
        stats.avgLoss = totalLosses / stats.losingTrades;
      }

      // Update position
      if (isFlipping) {
        // Position flipped
        const remainingQty = qty - position.qty;
        position.side = isBuy ? 'LONG' : 'SHORT';
        position.qty = remainingQty;
        position.avgEntryPrice = price;
      } else if (closeQty === position.qty) {
        // Full close
        position.side = 'FLAT';
        position.qty = 0;
        position.avgEntryPrice = 0;
      } else {
        // Partial close
        position.qty -= closeQty;
      }

      // Close trade record
      const openTrade = this.findOpenTrade(symbol);
      if (openTrade) {
        openTrade.exitTimestamp = fill.timestamp;
        openTrade.exitPrice = price;
        openTrade.exitQty = closeQty;
        openTrade.exitOrderId = fill.orderId;
        openTrade.exitSlippageBps = 0;
        openTrade.status = 'CLOSED';
        openTrade.realizedPnl = tradeRealizedPnl;
        openTrade.fees += fee;
        openTrade.netPnl = tradeRealizedPnl - openTrade.fees;
      }
    }

    position.totalFees += fee;
  }

  /**
   * Process position update for unrealized PnL
   */
  processPositionUpdate(update: PositionUpdateEvent): UnrealizedPnL {
    const { symbol, side, qty, entryPrice, markPrice, unrealizedPnl } = update;
    const normalizedQty = Math.max(0, Number(qty || 0));
    const normalizedEntry = Math.max(0, Number(entryPrice || 0));
    const normalizedMark = Math.max(0, Number(markPrice || 0));
    const normalizedUnrealized = Number.isFinite(Number(unrealizedPnl))
      ? Number(unrealizedPnl)
      : 0;
    const effectiveSide: 'LONG' | 'SHORT' | 'FLAT' = normalizedQty > 0 ? side : 'FLAT';

    const notionalValue = normalizedQty * normalizedMark;
    const unrealizedPnlPercent = normalizedEntry > 0 && normalizedQty > 0
      ? (normalizedUnrealized / (normalizedQty * normalizedEntry)) * 100 
      : 0;

    const snapshot: UnrealizedPnL = {
      symbol,
      side: effectiveSide,
      qty: normalizedQty,
      entryPrice: normalizedEntry,
      markPrice: normalizedMark,
      unrealizedPnl: normalizedUnrealized,
      unrealizedPnlPercent,
      notionalValue,
    };

    if (effectiveSide === 'FLAT' || normalizedQty <= 0) {
      this.unrealizedBySymbol.delete(symbol);
    } else {
      this.unrealizedBySymbol.set(symbol, snapshot);
    }

    let position = this.positions.get(symbol);
    if (!position) {
      position = {
        symbol,
        side: 'FLAT',
        qty: 0,
        avgEntryPrice: 0,
        totalFees: 0,
        realizedPnl: 0,
      };
      this.positions.set(symbol, position);
    }

    if (effectiveSide === 'FLAT' || normalizedQty <= 0) {
      position.side = 'FLAT';
      position.qty = 0;
      position.avgEntryPrice = 0;
    } else {
      position.side = effectiveSide;
      position.qty = normalizedQty;
      position.avgEntryPrice = normalizedEntry;
    }

    return snapshot;
  }

  /**
   * Get realized PnL for a symbol
   */
  getRealizedPnL(symbol: string): RealizedPnL | undefined {
    return this.realizedPnL.get(symbol);
  }

  /**
   * Get all realized PnL
   */
  getAllRealizedPnL(): RealizedPnL[] {
    return Array.from(this.realizedPnL.values());
  }

  /**
   * Get unrealized PnL for a symbol
   */
  getUnrealizedPnL(symbol: string): UnrealizedPnL | undefined {
    return this.unrealizedBySymbol.get(symbol);
  }

  /**
   * Get all unrealized PnL snapshots
   */
  getAllUnrealizedPnL(): UnrealizedPnL[] {
    return Array.from(this.unrealizedBySymbol.values());
  }

  /**
   * Get fee breakdown for a symbol
   */
  getFeeBreakdown(symbol: string): FeeBreakdown | undefined {
    return this.feeBreakdown.get(symbol);
  }

  /**
   * Get all fee breakdowns
   */
  getAllFeeBreakdowns(): FeeBreakdown[] {
    return Array.from(this.feeBreakdown.values());
  }

  /**
   * Get all trades
   */
  getAllTrades(): TradeLifecycle[] {
    return Array.from(this.trades.values());
  }

  /**
   * Get open trades for a symbol
   */
  getOpenTrades(symbol?: string): TradeLifecycle[] {
    const trades = Array.from(this.trades.values());
    if (symbol) {
      return trades.filter(t => t.symbol === symbol && t.status === 'OPEN');
    }
    return trades.filter(t => t.status === 'OPEN');
  }

  /**
   * Get closed trades for a symbol
   */
  getClosedTrades(symbol?: string): TradeLifecycle[] {
    const trades = Array.from(this.trades.values());
    if (symbol) {
      return trades.filter(t => t.symbol === symbol && t.status === 'CLOSED');
    }
    return trades.filter(t => t.status === 'CLOSED');
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.positions.clear();
    this.realizedPnL.clear();
    this.unrealizedBySymbol.clear();
    this.feeBreakdown.clear();
    this.trades.clear();
    this.tradeCounter = 0;
  }

  private findOpenTrade(symbol: string): TradeLifecycle | undefined {
    const trades = Array.from(this.trades.values());
    return trades.find(t => t.symbol === symbol && t.status === 'OPEN');
  }
}
