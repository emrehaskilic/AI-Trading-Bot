/**
 * Analytics API Endpoints
 *
 * Provides read-only access to analytics data for UI dashboard.
 * All endpoints are deterministic and have no side effects.
 */

import { Request, Response, Router } from 'express';
import { AnalyticsEngine } from '../analytics/AnalyticsEngine';

export interface AnalyticsSnapshotResponse {
  timestamp: number;
  session: {
    sessionId: string;
    startTime: number;
    durationMs: number;
  };
  pnl: {
    totalRealizedPnl: number;
    totalFees: number;
    netPnl: number;
    unrealizedPnl: number;
    totalReturn: number;
  };
  trades: {
    totalTrades: number;
    openPositions: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
  };
  execution: {
    avgSlippageBps: number;
    avgFillTimeMs: number;
    flipRate: number;
    adverseSelectionBps: number;
  };
  quality: {
    avgMfeMaeRatio: number;
    avgTradeScore: number;
    scoreDistribution: Record<string, number>;
  };
  drawdown: {
    maxDrawdown: number;
    maxDrawdownPercent: number;
    currentDrawdown: number;
    recoveryFactor: number;
  };
  bySymbol: Record<string, {
    trades: number;
    realizedPnl: number;
    fees: number;
    volume: number;
    flipRate: number;
  }>;
}

export interface AnalyticsRoutesOptions {
  analyticsEngine: AnalyticsEngine;
}

export interface EvidencePackResponse {
  schema: string;
  metadata: Record<string, unknown>;
}

export function createAnalyticsRoutes(options: AnalyticsRoutesOptions): Router {
  const router = Router();
  const { analyticsEngine } = options;

  router.get('/snapshot', (_req: Request, res: Response) => {
    try {
      const snapshot = analyticsEngine.getSnapshot();
      const neutralTrades = Math.max(
        snapshot.summary.totalTrades - snapshot.quality.goodTrades - snapshot.quality.badTrades,
        0,
      );

      const response: AnalyticsSnapshotResponse = {
        timestamp: Date.now(),
        session: {
          sessionId: snapshot.metadata.sessionId,
          startTime: snapshot.metadata.startTime,
          durationMs: snapshot.metadata.durationMs,
        },
        pnl: {
          totalRealizedPnl: snapshot.summary.totalRealizedPnl,
          totalFees: snapshot.summary.totalFees,
          netPnl: snapshot.summary.netPnl,
          unrealizedPnl: snapshot.summary.unrealizedPnl,
          totalReturn: 0,
        },
        trades: {
          totalTrades: snapshot.summary.totalTrades,
          openPositions: snapshot.summary.openPositions,
          winningTrades: snapshot.summary.winningTrades,
          losingTrades: snapshot.summary.losingTrades,
          winRate: snapshot.summary.winRate,
          avgWin: snapshot.summary.avgWin,
          avgLoss: snapshot.summary.avgLoss,
          profitFactor: snapshot.summary.profitFactor,
        },
        execution: {
          avgSlippageBps: snapshot.execution.avgSlippageBps,
          avgFillTimeMs: 0,
          flipRate: snapshot.execution.avgFlipRate,
          adverseSelectionBps: snapshot.execution.adverseSelectionRate,
        },
        quality: {
          avgMfeMaeRatio: snapshot.quality.avgMfeMaeRatio,
          avgTradeScore: snapshot.quality.avgTradeScore,
          scoreDistribution: {
            good: snapshot.quality.goodTrades,
            bad: snapshot.quality.badTrades,
            neutral: neutralTrades,
          },
        },
        drawdown: {
          maxDrawdown: snapshot.drawdown.maxDrawdown,
          maxDrawdownPercent: snapshot.drawdown.maxDrawdownPercent,
          currentDrawdown: snapshot.drawdown.currentDrawdown,
          recoveryFactor: Number(snapshot.drawdown.recoveryTimeMs ?? 0),
        },
        bySymbol: snapshot.bySymbol,
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({
        error: 'analytics_snapshot_failed',
        message: error?.message || 'Failed to get analytics snapshot',
      });
    }
  });

  router.get('/evidence-pack', (_req: Request, res: Response) => {
    try {
      const evidencePack = analyticsEngine.generateEvidencePack();
      const sessionId = evidencePack.session.metadata.sessionId || 'unknown';

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="evidence-pack-${sessionId}.json"`);
      res.status(200).json(evidencePack);
    } catch (error: any) {
      res.status(500).json({
        error: 'analytics_evidence_pack_failed',
        message: error?.message || 'Failed to generate evidence pack',
      });
    }
  });

  router.get('/pnl', (_req: Request, res: Response) => {
    try {
      const snapshot = analyticsEngine.getSnapshot();
      res.status(200).json({
        timestamp: Date.now(),
        pnl: {
          totalRealizedPnl: snapshot.summary.totalRealizedPnl,
          totalFees: snapshot.summary.totalFees,
          netPnl: snapshot.summary.netPnl,
          unrealizedPnl: snapshot.summary.unrealizedPnl,
          totalReturn: 0,
        },
        bySymbol: snapshot.bySymbol,
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'analytics_pnl_failed',
        message: error?.message || 'Failed to get PnL data',
      });
    }
  });

  router.get('/trades', (_req: Request, res: Response) => {
    try {
      const snapshot = analyticsEngine.getSnapshot();
      res.status(200).json({
        timestamp: Date.now(),
        trades: {
          totalTrades: snapshot.summary.totalTrades,
          openPositions: snapshot.summary.openPositions,
          winningTrades: snapshot.summary.winningTrades,
          losingTrades: snapshot.summary.losingTrades,
          winRate: snapshot.summary.winRate,
          avgWin: snapshot.summary.avgWin,
          avgLoss: snapshot.summary.avgLoss,
          profitFactor: snapshot.summary.profitFactor,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'analytics_trades_failed',
        message: error?.message || 'Failed to get trade statistics',
      });
    }
  });

  router.get('/drawdown', (_req: Request, res: Response) => {
    try {
      const snapshot = analyticsEngine.getSnapshot();
      res.status(200).json({
        timestamp: Date.now(),
        drawdown: {
          maxDrawdown: snapshot.drawdown.maxDrawdown,
          maxDrawdownPercent: snapshot.drawdown.maxDrawdownPercent,
          currentDrawdown: snapshot.drawdown.currentDrawdown,
          recoveryFactor: Number(snapshot.drawdown.recoveryTimeMs ?? 0),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'analytics_drawdown_failed',
        message: error?.message || 'Failed to get drawdown metrics',
      });
    }
  });

  return router;
}
