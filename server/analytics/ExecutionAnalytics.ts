/**
 * Execution Analytics - Phase 4
 * 
 * Tracks slippage, flip rate, adverse selection, and time under water.
 */

import {
  FillEvent,
  PositionUpdateEvent,
  PriceTickEvent,
  SlippageMetrics,
  FlipMetrics,
  AdverseSelectionMetrics,
  TimeUnderWaterMetrics,
  TradeLifecycle,
} from './types';

interface ExpectedPrice {
  symbol: string;
  orderId: string;
  expectedPrice: number;
  side: 'BUY' | 'SELL';
  qty: number;
  timestamp: number;
}

interface PositionHistory {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'FLAT';
  timestamp: number;
  price: number;
}

export class ExecutionAnalytics {
  private expectedPrices = new Map<string, ExpectedPrice>(); // orderId -> expected price
  private positionHistory = new Map<string, PositionHistory[]>(); // symbol -> history
  private slippageRecords: SlippageMetrics[] = [];
  private flipMetrics = new Map<string, FlipMetrics>();
  private adverseSelectionRecords: AdverseSelectionMetrics[] = [];
  private timeUnderWaterRecords = new Map<string, TimeUnderWaterMetrics>();
  private price1MinAfterEntry = new Map<string, { price: number; timestamp: number }>();
  
  // Configuration
  private adverseSelectionWindowMs = 60000; // 1 minute
  private slippageThresholdBps = 5;

  /**
   * Record expected price before execution (for slippage calculation)
   */
  recordExpectedPrice(
    orderId: string,
    symbol: string,
    expectedPrice: number,
    side: 'BUY' | 'SELL',
    qty: number
  ): void {
    this.expectedPrices.set(orderId, {
      symbol,
      orderId,
      expectedPrice,
      side,
      qty,
      timestamp: Date.now(),
    });
  }

  /**
   * Process fill and calculate slippage
   */
  processFill(fill: FillEvent): SlippageMetrics | undefined {
    const expected = this.expectedPrices.get(fill.orderId);
    if (!expected) {
      return undefined;
    }

    const slippageBps = this.calculateSlippage(
      expected.expectedPrice,
      fill.price,
      fill.side
    );

    const slippage: SlippageMetrics = {
      symbol: fill.symbol,
      orderId: fill.orderId,
      expectedPrice: expected.expectedPrice,
      executedPrice: fill.price,
      slippageBps,
      slippageType: this.classifySlippage(slippageBps),
      side: fill.side,
      qty: fill.qty,
      timestamp: fill.timestamp,
    };

    this.slippageRecords.push(slippage);
    this.expectedPrices.delete(fill.orderId);

    return slippage;
  }

  /**
   * Returns whether an expected price exists for the order.
   */
  hasExpectedPrice(orderId: string): boolean {
    return this.expectedPrices.has(orderId);
  }

  /**
   * Process position update for flip tracking
   */
  processPositionUpdate(update: PositionUpdateEvent): FlipMetrics | undefined {
    const { symbol, side, timestamp } = update;
    
    // Get position history
    let history = this.positionHistory.get(symbol);
    if (!history) {
      history = [];
      this.positionHistory.set(symbol, history);
    }

    // Record position change
    history.push({
      symbol,
      side,
      timestamp,
      price: 0, // Will be filled from price tick
    });

    // Check for flip
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      const curr = history[history.length - 1];

      if (
        (prev.side === 'LONG' && curr.side === 'SHORT') ||
        (prev.side === 'SHORT' && curr.side === 'LONG')
      ) {
        // Flip detected
        let flips = this.flipMetrics.get(symbol);
        if (!flips) {
          flips = {
            symbol,
            flipCount: 0,
            totalTrades: 0,
            flipRate: 0,
            lastFlipTimestamp: null,
            flips: [],
          };
          this.flipMetrics.set(symbol, flips);
        }

        flips.flipCount++;
        flips.totalTrades++;
        flips.flipRate = (flips.flipCount / flips.totalTrades) * 100;
        flips.lastFlipTimestamp = timestamp;
        flips.flips.push({
          from: prev.side,
          to: curr.side,
          timestamp,
          price: curr.price,
        });

        return flips;
      }
    }

    return undefined;
  }

  /**
   * Process price tick for adverse selection and MFE/MAE
   */
  processPriceTick(tick: PriceTickEvent): void {
    const { symbol, markPrice, timestamp } = tick;

    // Check for adverse selection (1 minute after entry)
    this.checkAdverseSelection(symbol, markPrice, timestamp);

    // Update time under water for open trades
    this.updateTimeUnderWater(symbol, markPrice, timestamp);
  }

  /**
   * Check for adverse selection on recent entries
   */
  private checkAdverseSelection(
    symbol: string,
    currentPrice: number,
    timestamp: number
  ): void {
    const entry = this.price1MinAfterEntry.get(symbol);
    if (!entry) return;

    const timeSinceEntry = timestamp - entry.timestamp;
    if (timeSinceEntry >= this.adverseSelectionWindowMs) {
      // Calculate adverse selection
      const entryPrice = entry.price;
      const priceChange = ((currentPrice - entryPrice) / entryPrice) * 10000; // bps

      // Determine if adverse (price moved against hypothetical position)
      // For simplicity, we track both directions and let consumer decide
      const adverseSelection: AdverseSelectionMetrics = {
        symbol,
        tradeId: '', // Would be linked to actual trade
        entryPrice,
        entrySide: 'LONG', // Placeholder
        price1MinLater: currentPrice,
        priceChangeBps: priceChange,
        isAdverse: false, // Will be determined based on actual position
        severity: this.classifySeverity(Math.abs(priceChange)),
      };

      this.adverseSelectionRecords.push(adverseSelection);
      this.price1MinAfterEntry.delete(symbol);
    }
  }

  /**
   * Record entry for adverse selection tracking
   */
  recordEntry(symbol: string, entryPrice: number, timestamp: number): void {
    this.price1MinAfterEntry.set(symbol, { price: entryPrice, timestamp });
  }

  /**
   * Update time under water metrics
   */
  private updateTimeUnderWater(
    symbol: string,
    markPrice: number,
    timestamp: number
  ): void {
    // This would track open trades and mark when they go profitable
    // Implementation depends on trade lifecycle integration
  }

  /**
   * Get slippage metrics for a symbol
   */
  getSlippageMetrics(symbol?: string): SlippageMetrics[] {
    if (symbol) {
      return this.slippageRecords.filter(s => s.symbol === symbol);
    }
    return this.slippageRecords;
  }

  /**
   * Get average slippage in bps
   */
  getAverageSlippage(symbol?: string): number {
    const records = symbol 
      ? this.slippageRecords.filter(s => s.symbol === symbol)
      : this.slippageRecords;

    if (records.length === 0) return 0;

    const total = records.reduce((sum, s) => sum + s.slippageBps, 0);
    return total / records.length;
  }

  /**
   * Get slippage statistics (avg/p95/max and distribution counts).
   */
  getSlippageStats(symbol?: string): {
    avg: number;
    p95: number;
    max: number;
    samples: number;
    positive: number;
    negative: number;
    neutral: number;
  } {
    const records = symbol
      ? this.slippageRecords.filter(s => s.symbol === symbol)
      : this.slippageRecords;
    if (records.length === 0) {
      return { avg: 0, p95: 0, max: 0, samples: 0, positive: 0, negative: 0, neutral: 0 };
    }
    const values = records.map((record) => Number(record.slippageBps || 0)).sort((a, b) => a - b);
    const percentile = (p: number): number => {
      if (values.length === 0) return 0;
      const idx = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
      return values[idx];
    };
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const distribution = this.getSlippageDistribution(symbol);
    return {
      avg,
      p95: percentile(0.95),
      max: values[values.length - 1],
      samples: values.length,
      positive: distribution.positive,
      negative: distribution.negative,
      neutral: distribution.neutral,
    };
  }

  /**
   * Get slippage distribution
   */
  getSlippageDistribution(symbol?: string): {
    positive: number;
    negative: number;
    neutral: number;
  } {
    const records = symbol 
      ? this.slippageRecords.filter(s => s.symbol === symbol)
      : this.slippageRecords;

    return {
      positive: records.filter(s => s.slippageType === 'positive').length,
      negative: records.filter(s => s.slippageType === 'negative').length,
      neutral: records.filter(s => s.slippageType === 'neutral').length,
    };
  }

  /**
   * Get flip metrics for a symbol
   */
  getFlipMetrics(symbol: string): FlipMetrics | undefined {
    return this.flipMetrics.get(symbol);
  }

  /**
   * Get all flip metrics
   */
  getAllFlipMetrics(): FlipMetrics[] {
    return Array.from(this.flipMetrics.values());
  }

  /**
   * Get adverse selection metrics
   */
  getAdverseSelectionMetrics(symbol?: string): AdverseSelectionMetrics[] {
    if (symbol) {
      return this.adverseSelectionRecords.filter(a => a.symbol === symbol);
    }
    return this.adverseSelectionRecords;
  }

  /**
   * Get time under water metrics
   */
  getTimeUnderWaterMetrics(symbol?: string): TimeUnderWaterMetrics[] {
    const records = Array.from(this.timeUnderWaterRecords.values());
    if (symbol) {
      return records.filter(t => t.symbol === symbol);
    }
    return records;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalSlippageRecords: number;
    avgSlippageBps: number;
    totalFlips: number;
    avgFlipRate: number;
    adverseSelectionCount: number;
    adverseSelectionRate: number;
  } {
    const totalFlips = Array.from(this.flipMetrics.values())
      .reduce((sum, f) => sum + f.flipCount, 0);
    
    const totalTrades = Array.from(this.flipMetrics.values())
      .reduce((sum, f) => sum + f.totalTrades, 0);

    const adverseCount = this.adverseSelectionRecords.filter(a => a.isAdverse).length;

    return {
      totalSlippageRecords: this.slippageRecords.length,
      avgSlippageBps: this.getAverageSlippage(),
      totalFlips,
      avgFlipRate: totalTrades > 0 ? (totalFlips / totalTrades) * 100 : 0,
      adverseSelectionCount: adverseCount,
      adverseSelectionRate: this.adverseSelectionRecords.length > 0 
        ? (adverseCount / this.adverseSelectionRecords.length) * 100 
        : 0,
    };
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.expectedPrices.clear();
    this.positionHistory.clear();
    this.slippageRecords = [];
    this.flipMetrics.clear();
    this.adverseSelectionRecords = [];
    this.timeUnderWaterRecords.clear();
    this.price1MinAfterEntry.clear();
  }

  private calculateSlippage(
    expectedPrice: number,
    executedPrice: number,
    side: 'BUY' | 'SELL'
  ): number {
    const diff = executedPrice - expectedPrice;
    const slippage = (diff / expectedPrice) * 10000; // Convert to bps
    
    // For buys, positive slippage means worse price (paid more)
    // For sells, negative slippage means worse price (received less)
    if (side === 'SELL') {
      return -slippage;
    }
    return slippage;
  }

  private classifySlippage(slippageBps: number): 'positive' | 'negative' | 'neutral' {
    if (Math.abs(slippageBps) < this.slippageThresholdBps) {
      return 'neutral';
    }
    return slippageBps > 0 ? 'positive' : 'negative';
  }

  private classifySeverity(bps: number): 'low' | 'medium' | 'high' {
    if (bps < 10) return 'low';
    if (bps < 50) return 'medium';
    return 'high';
  }
}
