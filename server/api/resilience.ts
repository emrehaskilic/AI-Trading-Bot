/**
 * Resilience API Endpoints
 * 
 * Provides read-only access to resilience guard data for UI dashboard.
 * All endpoints are deterministic and have no side effects.
 */

import { Request, Response } from 'express';
import { Router } from 'express';
import { AntiSpoofGuard } from '../metrics/AntiSpoofGuard';
import { DeltaBurstFilter } from '../metrics/DeltaBurstFilter';
import { LatencyTracker } from '../metrics/LatencyTracker';

// Types for guard action
export interface GuardAction {
  guardType: 'anti_spoof' | 'delta_burst' | 'latency' | 'flash_crash' | 'general';
  timestamp: number;
  symbol?: string;
  action: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
}

// Types for resilience snapshot response
export interface ResilienceSnapshotResponse {
  timestamp: number;
  guards: {
    antiSpoof: {
      totalDetections: number;
      activeSuspectedLevels: number;
      totalLevelsTracked: number;
      avgSpoofScore: number;
      lastDetectionAt: number | null;
    };
    deltaBurst: {
      totalBurstsDetected: number;
      currentCooldownActive: boolean;
      cooldownRemainingMs: number;
      meanDelta: number;
      stdDelta: number;
      lastBurstAt: number | null;
    };
    latency: {
      stages: Record<string, {
        avgMs: number;
        p95Ms: number;
        maxMs: number;
        samples: number;
      }>;
      totalSamples: number;
    };
    flashCrash: {
      totalDetections: number;
      lastDetectionAt: number | null;
      activeProtections: boolean;
    };
  };
  triggerCounters: {
    antiSpoof: number;
    deltaBurst: number;
    latencySpike: number;
    flashCrash: number;
    total: number;
  };
  recentActions: GuardAction[];
}

// Options for creating resilience routes
export interface ResilienceRoutesOptions {
  antiSpoofGuards?: Map<string, AntiSpoofGuard>;
  deltaBurstFilters?: Map<string, DeltaBurstFilter>;
  latencyTracker: LatencyTracker;
  flashCrashDetector?: {
    getDetectionCount: () => number;
    getLastDetectionTime: () => number | null;
    isProtectionActive: () => boolean;
  };
  getGuardActions: () => GuardAction[];
  getTriggerCounters: () => {
    antiSpoof: number;
    deltaBurst: number;
    latencySpike: number;
    flashCrash: number;
  };
}

/**
 * Create resilience API routes
 */
export function createResilienceRoutes(options: ResilienceRoutesOptions): Router {
  const router = Router();
  const antiSpoofGuards = options.antiSpoofGuards ?? new Map<string, AntiSpoofGuard>();
  const deltaBurstFilters = options.deltaBurstFilters ?? new Map<string, DeltaBurstFilter>();
  const {
    latencyTracker,
    flashCrashDetector,
    getGuardActions,
    getTriggerCounters,
  } = options;

  /**
   * GET /api/resilience/snapshot
   * Returns guard actions, trigger counters, and filter status
   */
  router.get('/snapshot', (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      
      // Aggregate AntiSpoof stats across all symbols
      let totalSpoofDetections = 0;
      let totalLevelsTracked = 0;
      let totalSuspectedLevels = 0;
      let totalSpoofScore = 0;
      let lastSpoofDetection: number | null = null;
      
      antiSpoofGuards.forEach((guard) => {
        const status = guard.getStatus(now);
        totalSpoofDetections += status.totalSpoofDetections;
        totalLevelsTracked += status.totalLevelsTracked;
        totalSuspectedLevels += status.spoofSuspectedLevels;
        totalSpoofScore += status.avgSpoofScore;
      });
      
      const avgSpoofScore = antiSpoofGuards.size > 0 ? totalSpoofScore / antiSpoofGuards.size : 0;
      
      // Aggregate DeltaBurst stats across all symbols
      let totalBursts = 0;
      let anyCooldownActive = false;
      let maxCooldownRemaining = 0;
      let totalMeanDelta = 0;
      let totalStdDelta = 0;
      let lastBurstTime: number | null = null;
      
      deltaBurstFilters.forEach((filter) => {
        const status = filter.getStatus(now);
        totalBursts += status.totalBurstsDetected;
        if (status.currentCooldownActive) {
          anyCooldownActive = true;
          maxCooldownRemaining = Math.max(maxCooldownRemaining, filter.getCooldownRemainingMs(now));
        }
        totalMeanDelta += status.meanDelta;
        totalStdDelta += status.stdDelta;
        if (status.lastBurstMs > 0 && (lastBurstTime === null || status.lastBurstMs > lastBurstTime)) {
          lastBurstTime = status.lastBurstMs;
        }
      });
      
      const avgMeanDelta = deltaBurstFilters.size > 0 ? totalMeanDelta / deltaBurstFilters.size : 0;
      const avgStdDelta = deltaBurstFilters.size > 0 ? totalStdDelta / deltaBurstFilters.size : 0;
      
      // Get latency stats
      const latencySnapshot = latencyTracker.snapshot();
      const totalLatencySamples = Object.values(latencySnapshot.stages)
        .reduce((sum, stage) => sum + stage.samples, 0);
      
      // Get flash crash stats
      const flashCrashStats = {
        totalDetections: flashCrashDetector?.getDetectionCount() || 0,
        lastDetectionAt: flashCrashDetector?.getLastDetectionTime() || null,
        activeProtections: flashCrashDetector?.isProtectionActive() || false,
      };
      
      // Get trigger counters
      const counters = getTriggerCounters();
      
      // Get recent actions
      const recentActions = getGuardActions().slice(-20);

      const response: ResilienceSnapshotResponse = {
        timestamp: now,
        guards: {
          antiSpoof: {
            totalDetections: totalSpoofDetections,
            activeSuspectedLevels: totalSuspectedLevels,
            totalLevelsTracked,
            avgSpoofScore,
            lastDetectionAt: lastSpoofDetection,
          },
          deltaBurst: {
            totalBurstsDetected: totalBursts,
            currentCooldownActive: anyCooldownActive,
            cooldownRemainingMs: maxCooldownRemaining,
            meanDelta: avgMeanDelta,
            stdDelta: avgStdDelta,
            lastBurstAt: lastBurstTime,
          },
          latency: {
            stages: latencySnapshot.stages,
            totalSamples: totalLatencySamples,
          },
          flashCrash: flashCrashStats,
        },
        triggerCounters: {
          ...counters,
          total: counters.antiSpoof + counters.deltaBurst + counters.latencySpike + counters.flashCrash,
        },
        recentActions,
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({
        error: 'resilience_snapshot_failed',
        message: error?.message || 'Failed to get resilience snapshot',
      });
    }
  });

  /**
   * GET /api/resilience/guards
   * Returns detailed guard status for each symbol
   */
  router.get('/guards', (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      
      // Get AntiSpoof status per symbol
      const antiSpoofBySymbol: Record<string, any> = {};
      antiSpoofGuards.forEach((guard, symbol) => {
        antiSpoofBySymbol[symbol] = {
          ...guard.getStatus(now),
          symbol,
        };
      });
      
      // Get DeltaBurst status per symbol
      const deltaBurstBySymbol: Record<string, any> = {};
      deltaBurstFilters.forEach((filter, symbol) => {
        deltaBurstBySymbol[symbol] = {
          ...filter.getStatus(now),
          cooldownRemainingMs: filter.getCooldownRemainingMs(now),
          confidenceMultiplier: filter.getConfidenceMultiplier(now),
          shouldSuppressSignal: filter.shouldSuppressSignal(now),
          symbol,
        };
      });
      
      res.status(200).json({
        timestamp: now,
        antiSpoof: antiSpoofBySymbol,
        deltaBurst: deltaBurstBySymbol,
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'resilience_guards_failed',
        message: error?.message || 'Failed to get guard status',
      });
    }
  });

  /**
   * GET /api/resilience/actions
   * Returns recent guard actions
   */
  router.get('/actions', (_req: Request, res: Response) => {
    try {
      const actions = getGuardActions();
      const limit = Math.min(100, Math.max(1, parseInt(_req.query.limit as string) || 50));
      
      res.status(200).json({
        timestamp: Date.now(),
        totalActions: actions.length,
        actions: actions.slice(-limit),
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'resilience_actions_failed',
        message: error?.message || 'Failed to get guard actions',
      });
    }
  });

  /**
   * GET /api/resilience/counters
   * Returns trigger counters
   */
  router.get('/counters', (_req: Request, res: Response) => {
    try {
      const counters = getTriggerCounters();
      
      res.status(200).json({
        timestamp: Date.now(),
        counters: {
          ...counters,
          total: counters.antiSpoof + counters.deltaBurst + counters.latencySpike + counters.flashCrash,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'resilience_counters_failed',
        message: error?.message || 'Failed to get trigger counters',
      });
    }
  });

  return router;
}
