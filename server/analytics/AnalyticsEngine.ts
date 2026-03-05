/**
 * Analytics Engine - Phase 4
 * 
 * Main coordinator for all analytics modules.
 * Processes events and generates evidence packs.
 */

import {
  FillEvent,
  PositionUpdateEvent,
  PriceTickEvent,
  FundingEvent,
  AnalyticsEvent,
  EvidencePack,
  SessionSummary,
  AnalyticsEngineConfig,
  DEFAULT_ANALYTICS_CONFIG,
  DrawdownMetrics,
} from './types';
import { PnLCalculator } from './PnLCalculator';
import { ExecutionAnalytics } from './ExecutionAnalytics';
import { TradeQuality } from './TradeQuality';
import * as fs from 'fs';
import * as path from 'path';

export class AnalyticsEngine {
  private config: AnalyticsEngineConfig;
  private pnlCalculator: PnLCalculator;
  private executionAnalytics: ExecutionAnalytics;
  private tradeQuality: TradeQuality;
  
  private sessionStartTime: number;
  private sessionId: string;
  private lastSnapshotTime = 0;
  private snapshotIntervalMs: number;
  private lastMarkPriceBySymbol = new Map<string, number>();
  private equitySeries: Array<{ timestamp: number; equity: number }> = [];
  private lastEquityPointTs = 0;

  constructor(config: Partial<AnalyticsEngineConfig> = {}) {
    this.config = { ...DEFAULT_ANALYTICS_CONFIG, ...config };
    this.snapshotIntervalMs = this.config.snapshotIntervalMs;
    
    this.pnlCalculator = new PnLCalculator();
    this.executionAnalytics = new ExecutionAnalytics();
    this.tradeQuality = new TradeQuality(this.config);
    
    this.sessionStartTime = Date.now();
    this.sessionId = this.generateSessionId();
    this.equitySeries = [{ timestamp: this.sessionStartTime, equity: 0 }];
    this.lastEquityPointTs = this.sessionStartTime;

    // Ensure output directory exists
    if (this.config.persistToDisk) {
      this.ensureOutputDir();
    }
  }

  // ============================================================================
  // EVENT INGESTION
  // ============================================================================

  /**
   * Process a fill event
   */
  ingestFill(fill: FillEvent): void {
    const fallbackExpectedPrice = this.lastMarkPriceBySymbol.get(fill.symbol);
    if (
      fill.orderId
      && !this.executionAnalytics.hasExpectedPrice(fill.orderId)
      && Number.isFinite(Number(fallbackExpectedPrice))
      && Number(fallbackExpectedPrice) > 0
    ) {
      this.executionAnalytics.recordExpectedPrice(
        fill.orderId,
        fill.symbol,
        Number(fallbackExpectedPrice),
        fill.side,
        fill.qty
      );
    }

    // Update PnL
    this.pnlCalculator.processFill(fill);

    // Update execution analytics (slippage)
    this.executionAnalytics.processFill(fill);
    this.executionAnalytics.recordEntry(fill.symbol, fill.price, fill.timestamp);
    this.recordEquityPoint(fill.timestamp);

    // Check if we should generate a snapshot
    this.checkSnapshot();
  }

  /**
   * Record expected order price for accurate slippage calculations.
   */
  recordExpectedFill(
    orderId: string,
    symbol: string,
    expectedPrice: number,
    side: 'BUY' | 'SELL',
    qty: number,
  ): void {
    if (!orderId || !(expectedPrice > 0) || !(qty > 0)) {
      return;
    }
    this.executionAnalytics.recordExpectedPrice(orderId, symbol, expectedPrice, side, qty);
  }

  /**
   * Process a position update
   */
  ingestPosition(update: PositionUpdateEvent): void {
    if (Number.isFinite(Number(update.markPrice)) && Number(update.markPrice) > 0) {
      this.lastMarkPriceBySymbol.set(update.symbol, Number(update.markPrice));
    }

    // Update PnL
    this.pnlCalculator.processPositionUpdate(update);

    // Update execution analytics (flip tracking)
    this.executionAnalytics.processPositionUpdate(update);
    this.recordEquityPoint(update.timestamp);
    this.checkSnapshot();
  }

  /**
   * Process a price tick
   */
  ingestPrice(tick: PriceTickEvent): void {
    if (Number.isFinite(Number(tick.markPrice)) && Number(tick.markPrice) > 0) {
      this.lastMarkPriceBySymbol.set(tick.symbol, Number(tick.markPrice));
    }

    // Update trade quality (MFE/MAE tracking)
    this.tradeQuality.processPriceTick(tick);

    // Update execution analytics (adverse selection)
    this.executionAnalytics.processPriceTick(tick);
    this.recordEquityPoint(tick.timestamp);
  }

  /**
   * Process a funding event
   */
  ingestFunding(funding: FundingEvent): void {
    // Funding events affect PnL
    // Implementation depends on how funding is tracked
  }

  /**
   * Process any analytics event
   */
  ingestEvent(event: AnalyticsEvent): void {
    switch (event.type) {
      case 'FILL':
        this.ingestFill(event);
        break;
      case 'POSITION_UPDATE':
        this.ingestPosition(event);
        break;
      case 'PRICE_TICK':
        this.ingestPrice(event);
        break;
      case 'FUNDING':
        this.ingestFunding(event);
        break;
    }
  }

  // ============================================================================
  // SNAPSHOT GENERATION
  // ============================================================================

  /**
   * Get current analytics snapshot
   */
  getSnapshot(): SessionSummary {
    const now = Date.now();
    this.recordEquityPoint(now, true);

    const allTrades = this.pnlCalculator.getAllTrades();
    const closedTrades = allTrades.filter((trade) => trade.status === 'CLOSED');
    const unrealizedPnL = this.pnlCalculator.getAllUnrealizedPnL()
      .filter((position) => position.side !== 'FLAT' && Number(position.qty || 0) > 0);

    const realizedPnL = this.pnlCalculator.getAllRealizedPnL();
    const feeBreakdowns = this.pnlCalculator.getAllFeeBreakdowns();

    const totalRealizedPnl = realizedPnL.reduce((sum, item) => sum + Number(item.totalRealizedPnl || 0), 0);
    const totalUnrealizedPnl = unrealizedPnL.reduce((sum, item) => sum + Number(item.unrealizedPnl || 0), 0);
    const openPositions = unrealizedPnL.length;
    const totalFees = feeBreakdowns.reduce((sum, fee) => sum + Number(fee.totalFees || 0), 0);
    const netPnl = totalRealizedPnl - totalFees + totalUnrealizedPnl;

    const winningTrades = closedTrades.filter((trade) => Number(trade.netPnl || 0) > 0).length;
    const losingTrades = closedTrades.filter((trade) => Number(trade.netPnl || 0) < 0).length;
    const totalTrades = closedTrades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const winningPnls = closedTrades
      .map((trade) => Number(trade.netPnl || 0))
      .filter((value) => value > 0);
    const losingPnls = closedTrades
      .map((trade) => Number(trade.netPnl || 0))
      .filter((value) => value < 0);
    const avgWin = winningPnls.length > 0
      ? winningPnls.reduce((sum, value) => sum + value, 0) / winningPnls.length
      : 0;
    const avgLoss = losingPnls.length > 0
      ? Math.abs(losingPnls.reduce((sum, value) => sum + value, 0) / losingPnls.length)
      : 0;

    const grossProfit = winningPnls.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losingPnls.reduce((sum, value) => sum + value, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const notionalReturns = closedTrades
      .map((trade) => {
        const notional = Math.abs(Number(trade.entryPrice || 0) * Number(trade.entryQty || 0));
        if (!(notional > 0)) return null;
        return Number(trade.netPnl || 0) / notional;
      })
      .filter((value): value is number => value != null && Number.isFinite(value));
    const openPositionReturns = unrealizedPnL
      .map((position) => {
        const notional = Math.abs(Number(position.entryPrice || 0) * Number(position.qty || 0));
        if (!(notional > 0)) return null;
        return Number(position.unrealizedPnl || 0) / notional;
      })
      .filter((value): value is number => value != null && Number.isFinite(value));
    const returnsForPerformance = notionalReturns.length > 0 ? notionalReturns : openPositionReturns;
    const meanReturn = this.mean(returnsForPerformance);
    const returnVolatility = this.stdDev(returnsForPerformance);
    const downsideDeviation = this.stdDev(returnsForPerformance.filter((value) => value < 0));
    const sharpeRatio = returnsForPerformance.length > 1 && returnVolatility > 0
      ? (meanReturn / returnVolatility) * Math.sqrt(returnsForPerformance.length)
      : 0;
    const sortinoRatio = returnsForPerformance.length > 1 && downsideDeviation > 0
      ? (meanReturn / downsideDeviation) * Math.sqrt(returnsForPerformance.length)
      : 0;

    const expectancy = totalTrades > 0
      ? closedTrades.reduce((sum, trade) => sum + Number(trade.netPnl || 0), 0) / totalTrades
      : openPositions > 0
        ? totalUnrealizedPnl / openPositions
        : 0;
    const avgReturnPerTradePct = meanReturn * 100;

    // Execution summary
    const execSummary = this.executionAnalytics.getSummary();
    const slippageStats = this.executionAnalytics.getSlippageStats();

    // Quality summary
    const avgMfeMaeRatio = this.tradeQuality.getAverageMfeMaeRatio();
    const avgTradeScore = this.tradeQuality.getAverageQualityScore();
    const scoreDist = this.tradeQuality.getScoreDistribution();

    // Drawdown
    const drawdown = this.computeDrawdownMetrics();

    // Symbol breakdown
    const bySymbol: Record<string, SessionSummary['bySymbol'][string]> = {};
    const symbols = new Set<string>();
    for (const item of realizedPnL) symbols.add(item.symbol);
    for (const item of feeBreakdowns) symbols.add(item.symbol);
    for (const item of unrealizedPnL) symbols.add(item.symbol);
    for (const item of closedTrades) symbols.add(item.symbol);

    const unrealizedBySymbol = new Map(unrealizedPnL.map((position) => [position.symbol, position]));
    for (const symbol of symbols) {
      const symbolTrades = closedTrades.filter((trade) => trade.symbol === symbol);
      const symbolRealized = symbolTrades.reduce((sum, trade) => sum + Number(trade.realizedPnl || 0), 0);
      const symbolFees = feeBreakdowns.find((fee) => fee.symbol === symbol);
      const symbolPosition = unrealizedBySymbol.get(symbol);
      const flips = this.executionAnalytics.getFlipMetrics(symbol);

      bySymbol[symbol] = {
        trades: symbolTrades.length,
        realizedPnl: symbolRealized,
        unrealizedPnl: Number(symbolPosition?.unrealizedPnl || 0),
        fees: Number(symbolFees?.totalFees || 0),
        volume: Number(symbolFees?.makerVolume || 0) + Number(symbolFees?.takerVolume || 0),
        flipRate: Number(flips?.flipRate || 0),
        openPosition: Boolean(symbolPosition),
        positionSide: symbolPosition?.side || 'FLAT',
        positionQty: Number(symbolPosition?.qty || 0),
      };
    }

    const makerVolume = feeBreakdowns.reduce((sum, fee) => sum + Number(fee.makerVolume || 0), 0);
    const takerVolume = feeBreakdowns.reduce((sum, fee) => sum + Number(fee.takerVolume || 0), 0);
    const totalVolume = makerVolume + takerVolume;

    return {
      metadata: {
        sessionId: this.sessionId,
        generatedAt: new Date().toISOString(),
        version: '1.0.0',
        startTime: this.sessionStartTime,
        endTime: now,
        durationMs: now - this.sessionStartTime,
      },
      summary: {
        totalTrades,
        openPositions,
        winningTrades,
        losingTrades,
        winRate,
        totalRealizedPnl,
        unrealizedPnl: totalUnrealizedPnl,
        totalFees,
        netPnl,
        avgTradePnl: totalTrades > 0
          ? closedTrades.reduce((sum, trade) => sum + Number(trade.netPnl || 0), 0) / totalTrades
          : openPositions > 0
            ? totalUnrealizedPnl / openPositions
            : 0,
        avgReturnPerTradePct,
        avgWin,
        avgLoss,
        profitFactor,
        maxDrawdown: drawdown.maxDrawdown,
        maxDrawdownPercent: drawdown.maxDrawdownPercent,
        totalVolume,
        makerVolume,
        takerVolume,
      },
      bySymbol,
      execution: {
        avgSlippageBps: slippageStats.avg || execSummary.avgSlippageBps,
        slippageP95Bps: slippageStats.p95,
        slippageMaxBps: slippageStats.max,
        slippageSamples: slippageStats.samples,
        positiveSlippageCount: slippageStats.positive,
        negativeSlippageCount: slippageStats.negative,
        totalFlips: execSummary.totalFlips,
        avgFlipRate: execSummary.avgFlipRate,
        adverseSelectionCount: execSummary.adverseSelectionCount,
        adverseSelectionRate: execSummary.adverseSelectionRate,
      },
      quality: {
        avgMfeMaeRatio,
        avgTradeScore,
        goodTrades: scoreDist.excellent + scoreDist.good,
        badTrades: scoreDist.poor,
      },
      performance: {
        sharpeRatio,
        sortinoRatio,
        returnVolatility,
        downsideDeviation,
        expectancy,
      },
      positions: unrealizedPnL.map((position) => ({ ...position })),
      trades: closedTrades,
      drawdown,
    };
  }

  /**
   * Generate full evidence pack
   */
  generateEvidencePack(): EvidencePack {
    const snapshot = this.getSnapshot();

    return {
      schema: 'analytics-evidence-pack-v1',
      metadata: {
        generatedAt: new Date().toISOString(),
        sessionId: this.sessionId,
        version: '1.0.0',
        source: 'analytics-engine',
      },
      pnl: {
        realized: this.pnlCalculator.getAllRealizedPnL(),
        unrealized: this.pnlCalculator.getAllUnrealizedPnL(),
        fees: this.pnlCalculator.getAllFeeBreakdowns(),
      },
      execution: {
        slippage: this.executionAnalytics.getSlippageMetrics(),
        flips: this.executionAnalytics.getAllFlipMetrics(),
        adverseSelection: this.executionAnalytics.getAdverseSelectionMetrics(),
        timeUnderWater: this.executionAnalytics.getTimeUnderWaterMetrics(),
      },
      quality: {
        mfeMae: this.tradeQuality.getAllMfeMae(),
        scores: this.tradeQuality.getAllQualityScores(),
        drawdown: this.tradeQuality.getDrawdownMetrics(),
      },
      session: snapshot,
    };
  }

  /**
   * Save evidence pack to disk
   */
  saveEvidencePack(filename?: string): string {
    if (!this.config.persistToDisk) {
      throw new Error('Disk persistence is disabled');
    }

    const pack = this.generateEvidencePack();
    const outputFile = filename || `evidence-pack-${this.sessionId}-${Date.now()}.json`;
    const outputPath = path.join(this.config.outputDir, outputFile);

    this.ensureOutputDir();
    fs.writeFileSync(outputPath, JSON.stringify(pack, null, 2));

    return outputPath;
  }

  // ============================================================================
  // API ENDPOINT HANDLER
  // ============================================================================

  /**
   * Handle GET /api/analytics/snapshot request
   */
  handleSnapshotRequest(): { status: number; body: any } {
    try {
      const snapshot = this.getSnapshot();
      return {
        status: 200,
        body: snapshot,
      };
    } catch (error) {
      return {
        status: 500,
        body: { error: 'Failed to generate snapshot', message: (error as Error).message },
      };
    }
  }

  /**
   * Handle GET /api/analytics/evidence-pack request
   */
  handleEvidencePackRequest(): { status: number; body: any } {
    try {
      const pack = this.generateEvidencePack();
      return {
        status: 200,
        body: pack,
      };
    } catch (error) {
      return {
        status: 500,
        body: { error: 'Failed to generate evidence pack', message: (error as Error).message },
      };
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Reset all analytics state
   */
  reset(): void {
    this.pnlCalculator.reset();
    this.executionAnalytics.reset();
    this.tradeQuality.reset();
    this.sessionStartTime = Date.now();
    this.sessionId = this.generateSessionId();
    this.lastSnapshotTime = 0;
    this.lastMarkPriceBySymbol.clear();
    this.equitySeries = [{ timestamp: this.sessionStartTime, equity: 0 }];
    this.lastEquityPointTs = this.sessionStartTime;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get config
   */
  getConfig(): AnalyticsEngineConfig {
    return { ...this.config };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private checkSnapshot(): void {
    const now = Date.now();
    if (now - this.lastSnapshotTime >= this.snapshotIntervalMs) {
      this.lastSnapshotTime = now;
      
      if (this.config.persistToDisk) {
        try {
          const snapshot = this.getSnapshot();
          const filename = `snapshot-${this.sessionId}-${now}.json`;
          const outputPath = path.join(this.config.outputDir, filename);
          this.ensureOutputDir();
          fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
        } catch (error) {
          console.error('Failed to save snapshot:', error);
        }
      }
    }
  }

  private recordEquityPoint(timestamp: number, force: boolean = false): void {
    const ts = Number.isFinite(Number(timestamp)) && Number(timestamp) > 0
      ? Number(timestamp)
      : Date.now();
    if (!force && (ts - this.lastEquityPointTs) < 1000) {
      return;
    }
    const equity = this.getCurrentNetPnl();
    const previous = this.equitySeries.length > 0 ? this.equitySeries[this.equitySeries.length - 1] : null;
    if (!force && previous && previous.equity === equity) {
      this.lastEquityPointTs = ts;
      return;
    }
    this.equitySeries.push({ timestamp: ts, equity });
    this.lastEquityPointTs = ts;
    if (this.equitySeries.length > 10_000) {
      this.equitySeries = this.equitySeries.slice(-10_000);
    }
  }

  private getCurrentNetPnl(): number {
    const realized = this.pnlCalculator.getAllRealizedPnL()
      .reduce((sum, item) => sum + Number(item.totalRealizedPnl || 0), 0);
    const fees = this.pnlCalculator.getAllFeeBreakdowns()
      .reduce((sum, fee) => sum + Number(fee.totalFees || 0), 0);
    const unrealized = this.pnlCalculator.getAllUnrealizedPnL()
      .reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0);
    return realized - fees + unrealized;
  }

  private computeDrawdownMetrics(): DrawdownMetrics {
    if (this.equitySeries.length === 0) {
      return {
        currentDrawdown: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        peakEquity: 0,
        troughEquity: 0,
        drawdownStart: 0,
        drawdownEnd: null,
        recoveryTimeMs: null,
      };
    }

    let peakEquity = this.equitySeries[0].equity;
    let peakTimestamp = this.equitySeries[0].timestamp;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let drawdownStart = peakTimestamp;
    let troughEquity = peakEquity;

    for (const point of this.equitySeries) {
      if (point.equity > peakEquity) {
        peakEquity = point.equity;
        peakTimestamp = point.timestamp;
      }
      const drawdown = Math.max(0, peakEquity - point.equity);
      const pctBase = Math.max(1, Math.abs(peakEquity));
      const drawdownPercent = Math.min(100, Math.max(0, (drawdown / pctBase) * 100));
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
        drawdownStart = peakTimestamp;
        troughEquity = point.equity;
      }
    }

    const latestPoint = this.equitySeries[this.equitySeries.length - 1];
    const currentDrawdown = Math.max(0, peakEquity - latestPoint.equity);
    const drawdownRecovered = currentDrawdown === 0;

    return {
      currentDrawdown,
      maxDrawdown,
      maxDrawdownPercent,
      peakEquity,
      troughEquity,
      drawdownStart,
      drawdownEnd: drawdownRecovered ? latestPoint.timestamp : null,
      recoveryTimeMs: drawdownRecovered && drawdownStart > 0
        ? Math.max(0, latestPoint.timestamp - drawdownStart)
        : null,
    };
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const avg = this.mean(values);
    const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private ensureOutputDir(): void {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
