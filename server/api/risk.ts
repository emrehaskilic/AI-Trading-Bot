/**
 * Risk API Endpoints
 * 
 * Provides read-only access to risk management data for UI dashboard.
 * All endpoints are deterministic and have no side effects.
 */

import { Request, Response } from 'express';
import { Router } from 'express';
import { 
  RiskStateManager, 
  RiskState, 
  RiskStateTransition,
  RiskStateConfig 
} from '../risk/RiskStateManager';

// Types for risk snapshot response
export interface RiskSnapshotResponse {
  timestamp: number;
  state: {
    current: RiskState;
    canTrade: boolean;
    canOpenPosition: boolean;
    isReducedRisk: boolean;
    positionSizeMultiplier: number;
  };
  limits: {
    maxPositionNotional: number;
    maxLeverage: number;
    maxPositionQty: number;
    dailyLossLimit: number;
    reducedRiskPositionMultiplier: number;
  };
  triggers: {
    lastTrigger: RiskStateTransition | null;
    recentTriggers: RiskStateTransition[];
    triggerCounts: Record<string, number>;
  };
  killSwitch: {
    active: boolean;
    triggeredAt: number | null;
    reason: string | null;
  };
  exposure: {
    totalPositionNotional: number;
    totalMarginUsed: number;
    availableMargin: number;
    marginUtilizationPercent: number;
  };
}

// Options for creating risk routes
export interface RiskRoutesOptions {
  riskStateManager?: RiskStateManager;
  getRiskStateManager?: () => RiskStateManager;
  killSwitchManager?: {
    isActive: () => boolean;
    getLastTrigger: () => { timestamp: number; reason: string } | null;
  };
  getPositionExposure: () => {
    totalPositionNotional: number;
    totalMarginUsed: number;
    availableMargin: number;
    marginUtilizationPercent: number;
  };
  riskLimits?: {
    maxPositionNotional: number;
    maxLeverage: number;
    maxPositionQty: number;
    dailyLossLimit: number;
    reducedRiskPositionMultiplier: number;
  };
  getRiskLimits?: () => {
    maxPositionNotional: number;
    maxLeverage: number;
    maxPositionQty: number;
    dailyLossLimit: number;
    reducedRiskPositionMultiplier: number;
  };
}

/**
 * Create risk API routes
 */
export function createRiskRoutes(options: RiskRoutesOptions): Router {
  const router = Router();
  const { 
    riskStateManager,
    getRiskStateManager,
    killSwitchManager, 
    getPositionExposure,
    riskLimits,
    getRiskLimits,
  } = options;

  /**
   * GET /api/risk/snapshot
   * Returns current risk state, limits, triggers, and kill switch status
   */
  router.get('/snapshot', (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      const resolvedRiskStateManager = getRiskStateManager ? getRiskStateManager() : riskStateManager;
      const resolvedRiskLimits = getRiskLimits ? getRiskLimits() : riskLimits;
      if (!resolvedRiskStateManager || !resolvedRiskLimits) {
        throw new Error('risk_routes_not_configured');
      }
      
      // Get current state
      const currentState = resolvedRiskStateManager.getCurrentState();
      const canTrade = resolvedRiskStateManager.canTrade();
      const canOpenPosition = resolvedRiskStateManager.canOpenPosition();
      const isReducedRisk = resolvedRiskStateManager.isReducedRisk();
      const positionSizeMultiplier = resolvedRiskStateManager.getPositionSizeMultiplier();
      
      // Get transition history
      const transitionHistory = resolvedRiskStateManager.getTransitionHistory();
      const lastTrigger = transitionHistory.length > 0 
        ? transitionHistory[transitionHistory.length - 1] 
        : null;
      
      // Get recent triggers (last 10)
      const recentTriggers = transitionHistory.slice(-10);
      
      // Count triggers by type
      const triggerCounts: Record<string, number> = {};
      transitionHistory.forEach((t: RiskStateTransition) => {
        triggerCounts[t.trigger] = (triggerCounts[t.trigger] || 0) + 1;
      });
      
      // Get kill switch status
      const killSwitch = {
        active: killSwitchManager?.isActive() || false,
        triggeredAt: killSwitchManager?.getLastTrigger()?.timestamp || null,
        reason: killSwitchManager?.getLastTrigger()?.reason || null,
      };
      
      // Get exposure
      const exposure = getPositionExposure();

      const response: RiskSnapshotResponse = {
        timestamp: now,
        state: {
          current: currentState,
          canTrade,
          canOpenPosition,
          isReducedRisk,
          positionSizeMultiplier,
        },
        limits: resolvedRiskLimits,
        triggers: {
          lastTrigger,
          recentTriggers,
          triggerCounts,
        },
        killSwitch,
        exposure,
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({
        error: 'risk_snapshot_failed',
        message: error?.message || 'Failed to get risk snapshot',
      });
    }
  });

  /**
   * GET /api/risk/state
   * Returns only the current risk state
   */
  router.get('/state', (_req: Request, res: Response) => {
    try {
      const resolvedRiskStateManager = getRiskStateManager ? getRiskStateManager() : riskStateManager;
      if (!resolvedRiskStateManager) {
        throw new Error('risk_routes_not_configured');
      }
      const currentState = resolvedRiskStateManager.getCurrentState();
      const canTrade = resolvedRiskStateManager.canTrade();
      const canOpenPosition = resolvedRiskStateManager.canOpenPosition();
      const isReducedRisk = resolvedRiskStateManager.isReducedRisk();
      const positionSizeMultiplier = resolvedRiskStateManager.getPositionSizeMultiplier();
      
      res.status(200).json({
        timestamp: Date.now(),
        state: currentState,
        canTrade,
        canOpenPosition,
        isReducedRisk,
        positionSizeMultiplier,
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'risk_state_failed',
        message: error?.message || 'Failed to get risk state',
      });
    }
  });

  /**
   * GET /api/risk/limits
   * Returns risk limits configuration
   */
  router.get('/limits', (_req: Request, res: Response) => {
    try {
      const resolvedRiskLimits = getRiskLimits ? getRiskLimits() : riskLimits;
      if (!resolvedRiskLimits) {
        throw new Error('risk_routes_not_configured');
      }
      res.status(200).json({
        timestamp: Date.now(),
        limits: resolvedRiskLimits,
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'risk_limits_failed',
        message: error?.message || 'Failed to get risk limits',
      });
    }
  });

  /**
   * GET /api/risk/triggers
   * Returns trigger history
   */
  router.get('/triggers', (_req: Request, res: Response) => {
    try {
      const resolvedRiskStateManager = getRiskStateManager ? getRiskStateManager() : riskStateManager;
      if (!resolvedRiskStateManager) {
        throw new Error('risk_routes_not_configured');
      }
      const transitionHistory = resolvedRiskStateManager.getTransitionHistory();
      
      // Count triggers by type
      const triggerCounts: Record<string, number> = {};
      transitionHistory.forEach((t: RiskStateTransition) => {
        triggerCounts[t.trigger] = (triggerCounts[t.trigger] || 0) + 1;
      });
      
      res.status(200).json({
        timestamp: Date.now(),
        totalTransitions: transitionHistory.length,
        recentTriggers: transitionHistory.slice(-20),
        triggerCounts,
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'risk_triggers_failed',
        message: error?.message || 'Failed to get risk triggers',
      });
    }
  });

  /**
   * GET /api/risk/killswitch
   * Returns kill switch status
   */
  router.get('/killswitch', (_req: Request, res: Response) => {
    try {
      const killSwitch = {
        active: killSwitchManager?.isActive() || false,
        triggeredAt: killSwitchManager?.getLastTrigger()?.timestamp || null,
        reason: killSwitchManager?.getLastTrigger()?.reason || null,
      };
      
      res.status(200).json({
        timestamp: Date.now(),
        killSwitch,
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'risk_killswitch_failed',
        message: error?.message || 'Failed to get kill switch status',
      });
    }
  });

  return router;
}
