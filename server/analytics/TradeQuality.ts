/**
 * Trade Quality Analytics - Phase 4
 * 
 * Calculates MFE/MAE, drawdown, and trade quality scores.
 */

import {
  PriceTickEvent,
  TradeLifecycle,
  MfeMaeMetrics,
  DrawdownMetrics,
  TradeQualityScore,
  AnalyticsEngineConfig,
  DEFAULT_ANALYTICS_CONFIG,
} from './types';

interface PricePoint {
  timestamp: number;
  price: number;
}

interface TradePriceHistory {
  tradeId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  prices: PricePoint[];
  exitPrice?: number;
  exitTimestamp?: number;
}

export class TradeQuality {
  private config: AnalyticsEngineConfig;
  private tradeHistories = new Map<string, TradePriceHistory>();
  private mfeMaeMetrics = new Map<string, MfeMaeMetrics>();
  private qualityScores = new Map<string, TradeQualityScore>();
  
  // Equity curve for drawdown calculation
  private equityCurve: Array<{ timestamp: number; equity: number }> = [];
  private peakEquity = 0;
  private currentDrawdown = 0;
  private maxDrawdown = 0;
  private drawdownStart = 0;

  constructor(config: Partial<AnalyticsEngineConfig> = {}) {
    this.config = { ...DEFAULT_ANALYTICS_CONFIG, ...config };
  }

  /**
   * Start tracking a new trade
   */
  startTrade(trade: TradeLifecycle): void {
    const history: TradePriceHistory = {
      tradeId: trade.tradeId,
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      prices: [{
        timestamp: trade.entryTimestamp,
        price: trade.entryPrice,
      }],
    };

    this.tradeHistories.set(trade.tradeId, history);
  }

  /**
   * Process price tick for MFE/MAE tracking
   */
  processPriceTick(tick: PriceTickEvent): void {
    const { symbol, markPrice, timestamp } = tick;

    // Update all open trades for this symbol
    for (const history of this.tradeHistories.values()) {
      if (history.symbol === symbol && !history.exitPrice) {
        history.prices.push({
          timestamp,
          price: markPrice,
        });

        // Trim history if too long
        if (history.prices.length > this.config.priceHistoryMaxLength) {
          history.prices = history.prices.slice(-this.config.priceHistoryMaxLength);
        }
      }
    }

    // Update equity curve
    this.updateEquityCurve(timestamp);
  }

  /**
   * Close trade and calculate final metrics
   */
  closeTrade(trade: TradeLifecycle): MfeMaeMetrics | undefined {
    const history = this.tradeHistories.get(trade.tradeId);
    if (!history) return undefined;

    history.exitPrice = trade.exitPrice || undefined;
    history.exitTimestamp = trade.exitTimestamp || undefined;

    // Calculate MFE/MAE
    const mfeMae = this.calculateMfeMae(history);
    this.mfeMaeMetrics.set(trade.tradeId, mfeMae);

    // Calculate quality score
    const score = this.calculateQualityScore(trade, mfeMae);
    this.qualityScores.set(trade.tradeId, score);

    return mfeMae;
  }

  /**
   * Calculate MFE/MAE for a trade
   */
  private calculateMfeMae(history: TradePriceHistory): MfeMaeMetrics {
    const { tradeId, symbol, side, entryPrice, prices, exitPrice } = history;
    
    const sideMultiplier = side === 'LONG' ? 1 : -1;
    
    let mfePrice = entryPrice;
    let mfeValue = 0;
    let mfeTimestamp = prices[0]?.timestamp || 0;
    
    let maePrice = entryPrice;
    let maeValue = 0;
    let maeTimestamp = prices[0]?.timestamp || 0;

    for (const point of prices) {
      const price = point.price;
      const pnl = (price - entryPrice) * sideMultiplier;

      if (pnl > mfeValue) {
        mfeValue = pnl;
        mfePrice = price;
        mfeTimestamp = point.timestamp;
      }

      if (pnl < maeValue) {
        maeValue = pnl;
        maePrice = price;
        maeTimestamp = point.timestamp;
      }
    }

    const mfePercent = (mfeValue / entryPrice) * 100;
    const maePercent = (Math.abs(maeValue) / entryPrice) * 100;
    const mfeMaeRatio = maeValue !== 0 ? mfeValue / Math.abs(maeValue) : mfeValue > 0 ? Infinity : 0;

    // Calculate efficiency ratio (actual PnL / MFE)
    const actualPnl = exitPrice 
      ? (exitPrice - entryPrice) * sideMultiplier 
      : 0;
    const efficiencyRatio = mfeValue > 0 ? actualPnl / mfeValue : 0;

    return {
      symbol,
      tradeId,
      entryPrice,
      exitPrice: exitPrice || null,
      side,
      mfePrice,
      mfeValue,
      mfePercent,
      mfeTimestamp,
      maePrice,
      maeValue,
      maePercent,
      maeTimestamp,
      mfeMaeRatio,
      efficiencyRatio,
    };
  }

  /**
   * Calculate trade quality score
   */
  private calculateQualityScore(
    trade: TradeLifecycle,
    mfeMae: MfeMaeMetrics
  ): TradeQualityScore {
    const weights = this.config.scoringWeights;
    const explanations: string[] = [];

    // MFE/MAE Score (0-100)
    let mfeMaeScore = 50;
    if (mfeMae.mfeMaeRatio >= 3) {
      mfeMaeScore = 100;
      explanations.push('Excellent MFE/MAE ratio (>= 3:1)');
    } else if (mfeMae.mfeMaeRatio >= 2) {
      mfeMaeScore = 80;
      explanations.push('Good MFE/MAE ratio (>= 2:1)');
    } else if (mfeMae.mfeMaeRatio >= 1) {
      mfeMaeScore = 60;
      explanations.push('Acceptable MFE/MAE ratio (>= 1:1)');
    } else {
      mfeMaeScore = 30;
      explanations.push('Poor MFE/MAE ratio (< 1:1)');
    }

    // Timing Score (based on efficiency ratio)
    let timingScore = 50;
    if (mfeMae.efficiencyRatio >= 0.8) {
      timingScore = 100;
      explanations.push('Excellent exit timing (captured 80%+ of MFE)');
    } else if (mfeMae.efficiencyRatio >= 0.5) {
      timingScore = 70;
      explanations.push('Good exit timing (captured 50%+ of MFE)');
    } else if (mfeMae.efficiencyRatio > 0) {
      timingScore = 40;
      explanations.push('Suboptimal exit timing (< 50% of MFE)');
    } else {
      timingScore = 20;
      explanations.push('Poor exit timing (negative efficiency)');
    }

    // Execution Score (based on slippage)
    let executionScore = 70;
    const entrySlippage = Math.abs(trade.entrySlippageBps);
    if (entrySlippage < 5) {
      executionScore = 100;
      explanations.push('Excellent execution (slippage < 5 bps)');
    } else if (entrySlippage < 15) {
      executionScore = 80;
      explanations.push('Good execution (slippage < 15 bps)');
    } else if (entrySlippage < 30) {
      executionScore = 50;
      explanations.push('Fair execution (slippage < 30 bps)');
    } else {
      executionScore = 30;
      explanations.push('Poor execution (slippage >= 30 bps)');
    }

    // Risk-Adjusted Score (based on MAE)
    let riskAdjustedScore = 50;
    if (mfeMae.maePercent < 0.5) {
      riskAdjustedScore = 100;
      explanations.push('Excellent risk control (MAE < 0.5%)');
    } else if (mfeMae.maePercent < 1.0) {
      riskAdjustedScore = 75;
      explanations.push('Good risk control (MAE < 1%)');
    } else if (mfeMae.maePercent < 2.0) {
      riskAdjustedScore = 50;
      explanations.push('Acceptable risk (MAE < 2%)');
    } else {
      riskAdjustedScore = 25;
      explanations.push('High risk (MAE >= 2%)');
    }

    // Calculate weighted overall score
    const overallScore = Math.round(
      mfeMaeScore * weights.mfeMae +
      timingScore * weights.timing +
      executionScore * weights.execution +
      riskAdjustedScore * weights.riskAdjusted
    );

    return {
      symbol: trade.symbol,
      tradeId: trade.tradeId,
      overallScore,
      mfeMaeScore,
      timingScore,
      executionScore,
      riskAdjustedScore,
      weights,
      explanations,
    };
  }

  /**
   * Update equity curve for drawdown calculation
   */
  private updateEquityCurve(timestamp: number): void {
    // Calculate current equity from all closed trades
    let currentEquity = 0;
    for (const score of this.qualityScores.values()) {
      // This is simplified - would need actual PnL data
    }

    this.equityCurve.push({ timestamp, equity: currentEquity });

    // Update peak and drawdown
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
      this.currentDrawdown = 0;
    } else {
      this.currentDrawdown = this.peakEquity - currentEquity;
      if (this.currentDrawdown > this.maxDrawdown) {
        this.maxDrawdown = this.currentDrawdown;
      }
    }
  }

  /**
   * Get MFE/MAE metrics for a trade
   */
  getMfeMae(tradeId: string): MfeMaeMetrics | undefined {
    return this.mfeMaeMetrics.get(tradeId);
  }

  /**
   * Get all MFE/MAE metrics
   */
  getAllMfeMae(): MfeMaeMetrics[] {
    return Array.from(this.mfeMaeMetrics.values());
  }

  /**
   * Get quality score for a trade
   */
  getQualityScore(tradeId: string): TradeQualityScore | undefined {
    return this.qualityScores.get(tradeId);
  }

  /**
   * Get all quality scores
   */
  getAllQualityScores(): TradeQualityScore[] {
    return Array.from(this.qualityScores.values());
  }

  /**
   * Get drawdown metrics
   */
  getDrawdownMetrics(): DrawdownMetrics {
    const currentEquity = this.equityCurve.length > 0 
      ? this.equityCurve[this.equityCurve.length - 1].equity 
      : 0;

    return {
      currentDrawdown: this.currentDrawdown,
      maxDrawdown: this.maxDrawdown,
      maxDrawdownPercent: this.peakEquity > 0 
        ? (this.maxDrawdown / this.peakEquity) * 100 
        : 0,
      peakEquity: this.peakEquity,
      troughEquity: this.peakEquity - this.maxDrawdown,
      drawdownStart: this.drawdownStart,
      drawdownEnd: this.currentDrawdown === 0 ? Date.now() : null,
      recoveryTimeMs: null, // Would calculate from timestamps
    };
  }

  /**
   * Get average MFE/MAE ratio
   */
  getAverageMfeMaeRatio(): number {
    const metrics = Array.from(this.mfeMaeMetrics.values());
    if (metrics.length === 0) return 0;

    const total = metrics.reduce((sum, m) => sum + m.mfeMaeRatio, 0);
    return total / metrics.length;
  }

  /**
   * Get average quality score
   */
  getAverageQualityScore(): number {
    const scores = Array.from(this.qualityScores.values());
    if (scores.length === 0) return 0;

    const total = scores.reduce((sum, s) => sum + s.overallScore, 0);
    return total / scores.length;
  }

  /**
   * Get trade score distribution
   */
  getScoreDistribution(): {
    excellent: number; // >= 80
    good: number;      // 60-79
    average: number;   // 40-59
    poor: number;      // < 40
  } {
    const scores = Array.from(this.qualityScores.values());
    
    return {
      excellent: scores.filter(s => s.overallScore >= 80).length,
      good: scores.filter(s => s.overallScore >= 60 && s.overallScore < 80).length,
      average: scores.filter(s => s.overallScore >= 40 && s.overallScore < 60).length,
      poor: scores.filter(s => s.overallScore < 40).length,
    };
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.tradeHistories.clear();
    this.mfeMaeMetrics.clear();
    this.qualityScores.clear();
    this.equityCurve = [];
    this.peakEquity = 0;
    this.currentDrawdown = 0;
    this.maxDrawdown = 0;
    this.drawdownStart = 0;
  }
}
