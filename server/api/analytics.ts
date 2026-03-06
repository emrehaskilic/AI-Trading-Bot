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
  source: 'analytics' | 'dry_run_fallback';
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
  fees: {
    makerFees: number;
    takerFees: number;
    totalFees: number;
    effectiveRate: number;
  };
  trades: {
    totalTrades: number;
    openPositions: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    avgTradePnl: number;
    avgReturnPerTradePct: number;
    profitFactor: number;
  };
  execution: {
    avgSlippageBps: number;
    p95SlippageBps: number;
    maxSlippageBps: number;
    slippageSamples: number;
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
    currentDrawdownPercent: number;
    recoveryFactor: number;
  };
  performance: {
    sharpeRatio: number;
    sortinoRatio: number;
    returnVolatility: number;
    downsideDeviation: number;
    expectancy: number;
  };
  positions: Array<{
    symbol: string;
    side: 'LONG' | 'SHORT' | 'FLAT';
    qty: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    notionalValue: number;
  }>;
  bySymbol: Record<string, {
    trades: number;
    realizedPnl: number;
    unrealizedPnl: number;
    fees: number;
    volume: number;
    flipRate: number;
    openPosition: boolean;
    positionSide: 'LONG' | 'SHORT' | 'FLAT';
    positionQty: number;
  }>;
}

export interface AnalyticsRoutesOptions {
  analyticsEngine: AnalyticsEngine;
  getDryRunStatus?: () => any;
}

export interface EvidencePackResponse {
  schema: string;
  metadata: Record<string, unknown>;
}

interface DryRunAnalyticsFallback {
  totalRealizedPnl: number;
  totalFees: number;
  unrealizedPnl: number;
  netPnl: number;
  totalTrades: number;
  openPositions: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  avgTradePnl: number;
  avgReturnPerTradePct: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  currentDrawdown: number;
  currentDrawdownPercent: number;
  recoveryFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  returnVolatility: number;
  downsideDeviation: number;
  expectancy: number;
  positions: AnalyticsSnapshotResponse['positions'];
  bySymbol: AnalyticsSnapshotResponse['bySymbol'];
}

function deriveDryRunFallback(status: any): DryRunAnalyticsFallback | null {
  if (!status || typeof status !== 'object') return null;

  const summary = status.summary || {};
  const config = status.config || {};
  const performance = summary.performance || {};
  const perSymbol = status.perSymbol && typeof status.perSymbol === 'object'
    ? status.perSymbol
    : {};

  const startBalance = Math.max(1e-9, Number(config.walletBalanceStartUsdt || 0));
  const totalRealizedPnl = Number(summary.realizedPnl || 0);
  const totalFees = Number(summary.feePaid || 0);
  const unrealizedPnl = Number(summary.unrealizedPnl || 0);
  const netPnl = totalRealizedPnl - totalFees + unrealizedPnl;
  const totalTrades = Math.max(0, Number(performance.totalTrades || 0));
  const winningTrades = Math.max(0, Number(performance.winCount || 0));
  const losingTrades = Math.max(0, Number(performance.lossCount || 0));
  const winRate = Number(performance.winRate || 0);
  const maxDrawdown = Math.max(0, Number(performance.maxDrawdown || 0));
  const maxDrawdownPercentRaw = startBalance > 0 ? (maxDrawdown / startBalance) * 100 : 0;
  const maxDrawdownPercent = Math.min(100, Math.max(0, maxDrawdownPercentRaw));
  const currentDrawdown = Math.max(0, -netPnl);
  const currentDrawdownPercentRaw = startBalance > 0 ? (currentDrawdown / startBalance) * 100 : 0;
  const currentDrawdownPercent = Math.min(100, Math.max(0, currentDrawdownPercentRaw));

  const positions: AnalyticsSnapshotResponse['positions'] = [];
  const bySymbol: AnalyticsSnapshotResponse['bySymbol'] = {};
  for (const [symbol, symbolStatusRaw] of Object.entries(perSymbol)) {
    const symbolStatus = (symbolStatusRaw || {}) as any;
    const metrics = symbolStatus.metrics || {};
    const symbolPerf = symbolStatus.performance || {};
    const position = symbolStatus.position || null;
    const qty = Math.max(0, Math.abs(Number(position?.qty || 0)));
    const sideRaw = String(position?.side || 'FLAT').toUpperCase();
    const side: 'LONG' | 'SHORT' | 'FLAT' = sideRaw === 'LONG' || sideRaw === 'SHORT'
      ? sideRaw
      : 'FLAT';
    const entryPrice = Math.max(0, Number(position?.entryPrice || 0));
    const markPrice = Math.max(0, Number(metrics.markPrice || entryPrice || 0));
    const symbolUnrealized = Number(metrics.unrealizedPnl || 0);
    const notionalValue = qty * markPrice;
    const unrealizedPnlPercent = entryPrice > 0 && qty > 0
      ? (symbolUnrealized / (entryPrice * qty)) * 100
      : 0;

    if (qty > 0 && side !== 'FLAT') {
      positions.push({
        symbol,
        side,
        qty,
        entryPrice,
        markPrice,
        unrealizedPnl: symbolUnrealized,
        unrealizedPnlPercent,
        notionalValue,
      });
    }

    bySymbol[symbol] = {
      trades: Math.max(0, Number(symbolPerf.totalTrades || 0)),
      realizedPnl: Number(metrics.realizedPnl || 0),
      unrealizedPnl: symbolUnrealized,
      fees: Number(metrics.feePaid || 0),
      volume: 0,
      flipRate: 0,
      openPosition: qty > 0 && side !== 'FLAT',
      positionSide: qty > 0 && side !== 'FLAT' ? side : 'FLAT',
      positionQty: qty,
    };
  }

  return {
    totalRealizedPnl,
    totalFees,
    unrealizedPnl,
    netPnl,
    totalTrades,
    openPositions: positions.length,
    winningTrades,
    losingTrades,
    winRate,
    avgWin: 0,
    avgLoss: 0,
    avgTradePnl: totalTrades > 0 ? netPnl / totalTrades : positions.length > 0 ? unrealizedPnl / positions.length : 0,
    avgReturnPerTradePct: 0,
    profitFactor: 0,
    maxDrawdown,
    maxDrawdownPercent,
    currentDrawdown,
    currentDrawdownPercent,
    recoveryFactor: 0,
    sharpeRatio: Number(performance.sharpeRatio || 0),
    sortinoRatio: 0,
    returnVolatility: 0,
    downsideDeviation: 0,
    expectancy: totalTrades > 0 ? netPnl / totalTrades : 0,
    positions,
    bySymbol,
  };
}

export function createAnalyticsRoutes(options: AnalyticsRoutesOptions): Router {
  const router = Router();
  const { analyticsEngine, getDryRunStatus } = options;

  router.get('/snapshot', (_req: Request, res: Response) => {
    try {
      const snapshot = analyticsEngine.getSnapshot();
      const dryRunFallback = deriveDryRunFallback(getDryRunStatus ? getDryRunStatus() : null);
      const useFallback = Boolean(
        dryRunFallback
        && snapshot.summary.totalTrades === 0
        && (
          dryRunFallback.totalTrades > 0
          || dryRunFallback.openPositions > 0
          || Math.abs(dryRunFallback.totalRealizedPnl) > 0
          || Math.abs(dryRunFallback.unrealizedPnl) > 0
          || dryRunFallback.totalFees > 0
        ),
      );

      const totalRealizedPnl = useFallback ? dryRunFallback!.totalRealizedPnl : snapshot.summary.totalRealizedPnl;
      const totalFees = useFallback ? dryRunFallback!.totalFees : snapshot.summary.totalFees;
      const unrealizedPnl = useFallback ? dryRunFallback!.unrealizedPnl : snapshot.summary.unrealizedPnl;
      const netPnl = useFallback ? dryRunFallback!.netPnl : snapshot.summary.netPnl;
      const totalTrades = useFallback ? dryRunFallback!.totalTrades : snapshot.summary.totalTrades;
      const openPositions = useFallback ? dryRunFallback!.openPositions : snapshot.summary.openPositions;
      const winningTrades = useFallback ? dryRunFallback!.winningTrades : snapshot.summary.winningTrades;
      const losingTrades = useFallback ? dryRunFallback!.losingTrades : snapshot.summary.losingTrades;
      const winRate = useFallback ? dryRunFallback!.winRate : snapshot.summary.winRate;
      const avgWin = useFallback ? dryRunFallback!.avgWin : snapshot.summary.avgWin;
      const avgLoss = useFallback ? dryRunFallback!.avgLoss : snapshot.summary.avgLoss;
      const avgTradePnl = useFallback ? dryRunFallback!.avgTradePnl : snapshot.summary.avgTradePnl;
      const avgReturnPerTradePct = useFallback ? dryRunFallback!.avgReturnPerTradePct : snapshot.summary.avgReturnPerTradePct;
      const profitFactor = useFallback ? dryRunFallback!.profitFactor : snapshot.summary.profitFactor;
      const maxDrawdown = useFallback ? dryRunFallback!.maxDrawdown : snapshot.drawdown.maxDrawdown;
      const maxDrawdownPercent = useFallback ? dryRunFallback!.maxDrawdownPercent : snapshot.drawdown.maxDrawdownPercent;
      const currentDrawdown = useFallback ? dryRunFallback!.currentDrawdown : snapshot.drawdown.currentDrawdown;
      const currentDrawdownPercentRaw = useFallback
        ? dryRunFallback!.currentDrawdownPercent
        : Number(snapshot.drawdown.peakEquity || 0) !== 0
          ? (snapshot.drawdown.currentDrawdown / Math.max(1, Math.abs(Number(snapshot.drawdown.peakEquity || 0)))) * 100
          : 0;
      const currentDrawdownPercent = Math.min(100, Math.max(0, Number(currentDrawdownPercentRaw || 0)));
      const recoveryFactor = useFallback
        ? dryRunFallback!.recoveryFactor
        : Number(snapshot.drawdown.recoveryTimeMs ?? 0);
      const sharpeRatio = useFallback ? dryRunFallback!.sharpeRatio : Number(snapshot.performance?.sharpeRatio || 0);
      const sortinoRatio = useFallback ? dryRunFallback!.sortinoRatio : Number(snapshot.performance?.sortinoRatio || 0);
      const returnVolatility = useFallback ? dryRunFallback!.returnVolatility : Number(snapshot.performance?.returnVolatility || 0);
      const downsideDeviation = useFallback ? dryRunFallback!.downsideDeviation : Number(snapshot.performance?.downsideDeviation || 0);
      const expectancy = useFallback ? dryRunFallback!.expectancy : Number(snapshot.performance?.expectancy || 0);
      const positions = useFallback ? dryRunFallback!.positions : (Array.isArray(snapshot.positions) ? snapshot.positions : []);
      const bySymbol = useFallback ? dryRunFallback!.bySymbol : snapshot.bySymbol;

      const evidencePack = analyticsEngine.generateEvidencePack();
      const feeBreakdowns = evidencePack?.pnl?.fees || [];
      const makerFees = feeBreakdowns.reduce((sum, fee) => sum + Number(fee?.makerFees || 0), 0);
      const takerFees = feeBreakdowns.reduce((sum, fee) => sum + Number(fee?.takerFees || 0), 0);
      const neutralTrades = Math.max(
        totalTrades - snapshot.quality.goodTrades - snapshot.quality.badTrades,
        0,
      );
      const totalNotional = Object.values(bySymbol || {})
        .reduce((sum, symbolStats) => sum + Number(symbolStats?.volume || 0), 0);

      const response: AnalyticsSnapshotResponse = {
        timestamp: Date.now(),
        source: useFallback ? 'dry_run_fallback' : 'analytics',
        session: {
          sessionId: snapshot.metadata.sessionId,
          startTime: snapshot.metadata.startTime,
          durationMs: snapshot.metadata.durationMs,
        },
        pnl: {
          totalRealizedPnl,
          totalFees,
          netPnl,
          unrealizedPnl,
          totalReturn: 0,
        },
        fees: {
          makerFees: makerFees > 0 ? makerFees : (useFallback ? 0 : makerFees),
          takerFees: takerFees > 0 ? takerFees : (useFallback ? totalFees : takerFees),
          totalFees,
          effectiveRate: totalNotional > 0 ? totalFees / totalNotional : 0,
        },
        trades: {
          totalTrades,
          openPositions,
          winningTrades,
          losingTrades,
          winRate,
          avgWin,
          avgLoss,
          avgTradePnl,
          avgReturnPerTradePct,
          profitFactor,
        },
        execution: {
          avgSlippageBps: snapshot.execution.avgSlippageBps,
          p95SlippageBps: snapshot.execution.slippageP95Bps,
          maxSlippageBps: snapshot.execution.slippageMaxBps,
          slippageSamples: snapshot.execution.slippageSamples,
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
          maxDrawdown,
          maxDrawdownPercent,
          currentDrawdown,
          currentDrawdownPercent,
          recoveryFactor,
        },
        performance: {
          sharpeRatio,
          sortinoRatio,
          returnVolatility,
          downsideDeviation,
          expectancy,
        },
        positions,
        bySymbol,
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
      const evidencePack = analyticsEngine.generateEvidencePack();
      const feeBreakdowns = evidencePack?.pnl?.fees || [];
      const makerFees = feeBreakdowns.reduce((sum, fee) => sum + Number(fee?.makerFees || 0), 0);
      const takerFees = feeBreakdowns.reduce((sum, fee) => sum + Number(fee?.takerFees || 0), 0);
      res.status(200).json({
        timestamp: Date.now(),
        pnl: {
          totalRealizedPnl: snapshot.summary.totalRealizedPnl,
          totalFees: snapshot.summary.totalFees,
          netPnl: snapshot.summary.netPnl,
          unrealizedPnl: snapshot.summary.unrealizedPnl,
          makerFees,
          takerFees,
          totalReturn: 0,
        },
        positions: snapshot.positions || [],
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
          avgTradePnl: snapshot.summary.avgTradePnl,
          avgReturnPerTradePct: snapshot.summary.avgReturnPerTradePct,
          profitFactor: snapshot.summary.profitFactor,
        },
        positions: snapshot.positions || [],
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
          currentDrawdownPercent: Number(snapshot.drawdown.peakEquity || 0) !== 0
            ? (snapshot.drawdown.currentDrawdown / Math.max(1e-9, Math.abs(Number(snapshot.drawdown.peakEquity || 0)))) * 100
            : 0,
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

  router.get('/performance', (_req: Request, res: Response) => {
    try {
      const snapshot = analyticsEngine.getSnapshot();
      res.status(200).json({
        timestamp: Date.now(),
        performance: {
          sharpeRatio: Number(snapshot.performance?.sharpeRatio || 0),
          sortinoRatio: Number(snapshot.performance?.sortinoRatio || 0),
          returnVolatility: Number(snapshot.performance?.returnVolatility || 0),
          downsideDeviation: Number(snapshot.performance?.downsideDeviation || 0),
          expectancy: Number(snapshot.performance?.expectancy || 0),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'analytics_performance_failed',
        message: error?.message || 'Failed to get performance metrics',
      });
    }
  });

  return router;
}
