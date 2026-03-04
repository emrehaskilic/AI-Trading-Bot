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

  constructor(config: Partial<AnalyticsEngineConfig> = {}) {
    this.config = { ...DEFAULT_ANALYTICS_CONFIG, ...config };
    this.snapshotIntervalMs = this.config.snapshotIntervalMs;
    
    this.pnlCalculator = new PnLCalculator();
    this.executionAnalytics = new ExecutionAnalytics();
    this.tradeQuality = new TradeQuality(this.config);
    
    this.sessionStartTime = Date.now();
    this.sessionId = this.generateSessionId();

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
    // Update PnL
    this.pnlCalculator.processFill(fill);

    // Update execution analytics (slippage)
    this.executionAnalytics.processFill(fill);

    // Check if we should generate a snapshot
    this.checkSnapshot();
  }

  /**
   * Process a position update
   */
  ingestPosition(update: PositionUpdateEvent): void {
    // Update PnL
    this.pnlCalculator.processPositionUpdate(update);

    // Update execution analytics (flip tracking)
    this.executionAnalytics.processPositionUpdate(update);
  }

  /**
   * Process a price tick
   */
  ingestPrice(tick: PriceTickEvent): void {
    // Update trade quality (MFE/MAE tracking)
    this.tradeQuality.processPriceTick(tick);

    // Update execution analytics (adverse selection)
    this.executionAnalytics.processPriceTick(tick);
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
    const allTrades = this.pnlCalculator.getAllTrades();
    const closedTrades = allTrades.filter(t => t.status === 'CLOSED');
    const openTrades = allTrades.filter(t => t.status === 'OPEN');
    const unrealizedPnL = this.pnlCalculator.getAllUnrealizedPnL();

    const realizedPnL = this.pnlCalculator.getAllRealizedPnL();
    const totalRealizedPnl = realizedPnL.reduce((sum, r) => sum + r.totalRealizedPnl, 0);
    const totalUnrealizedPnl = unrealizedPnL.reduce((sum, p) => sum + Number(p.unrealizedPnl || 0), 0);
    const openPositions = unrealizedPnL.filter((p) => p.side !== 'FLAT' && Number(p.qty || 0) > 0).length;
    const totalFees = realizedPnL.reduce((sum, r) => sum + r.totalFees, 0);
    const netPnl = totalRealizedPnl - totalFees + totalUnrealizedPnl;

    const winningTrades = realizedPnL.reduce((sum, r) => sum + r.winningTrades, 0);
    const losingTrades = realizedPnL.reduce((sum, r) => sum + r.losingTrades, 0);
    const totalTrades = winningTrades + losingTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const avgWin = realizedPnL.length > 0 
      ? realizedPnL.reduce((sum, r) => sum + r.avgWin, 0) / realizedPnL.length 
      : 0;
    const avgLoss = realizedPnL.length > 0 
      ? realizedPnL.reduce((sum, r) => sum + r.avgLoss, 0) / realizedPnL.length 
      : 0;

    const grossProfit = realizedPnL.reduce((sum, r) => {
      return sum + (r.grossPnl > 0 ? r.grossPnl : 0);
    }, 0);
    const grossLoss = Math.abs(realizedPnL.reduce((sum, r) => {
      return sum + (r.grossPnl < 0 ? r.grossPnl : 0);
    }, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Execution summary
    const execSummary = this.executionAnalytics.getSummary();

    // Quality summary
    const avgMfeMaeRatio = this.tradeQuality.getAverageMfeMaeRatio();
    const avgTradeScore = this.tradeQuality.getAverageQualityScore();
    const scoreDist = this.tradeQuality.getScoreDistribution();

    // Drawdown
    const drawdown = this.tradeQuality.getDrawdownMetrics();

    // Symbol breakdown
    const bySymbol: Record<string, any> = {};
    for (const pnl of realizedPnL) {
      const fees = this.pnlCalculator.getFeeBreakdown(pnl.symbol);
      const flips = this.executionAnalytics.getFlipMetrics(pnl.symbol);
      
      bySymbol[pnl.symbol] = {
        trades: pnl.tradeCount,
        realizedPnl: pnl.totalRealizedPnl,
        fees: pnl.totalFees,
        volume: (fees?.makerVolume || 0) + (fees?.takerVolume || 0),
        flipRate: flips?.flipRate || 0,
      };
    }

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
        avgTradePnl: totalTrades > 0 ? netPnl / totalTrades : 0,
        avgWin,
        avgLoss,
        profitFactor,
        maxDrawdown: drawdown.maxDrawdown,
        maxDrawdownPercent: drawdown.maxDrawdownPercent,
        totalVolume: realizedPnL.reduce((sum, r) => sum + r.tradeCount, 0), // Simplified
        makerVolume: 0, // Would calculate from fees
        takerVolume: 0,
      },
      bySymbol,
      execution: {
        avgSlippageBps: execSummary.avgSlippageBps,
        positiveSlippageCount: 0, // Would calculate from records
        negativeSlippageCount: 0,
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

  private ensureOutputDir(): void {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
