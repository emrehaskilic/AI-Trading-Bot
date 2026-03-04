/**
 * Strategy API Endpoints
 * 
 * Provides read-only access to strategy and consensus data for UI dashboard.
 * All endpoints are deterministic and have no side effects.
 */

import { Request, Response } from 'express';
import { Router } from 'express';
import { ConsensusEngine, ConsensusDecision } from '../consensus/ConsensusEngine';
import { StrategySignal, SignalSide } from '../strategies/StrategyInterface';
import { RiskState } from '../risk/RiskStateManager';

// Types for strategy snapshot response
export interface StrategySnapshotResponse {
  timestamp: number;
  consensus: {
    side: 'LONG' | 'SHORT' | 'FLAT';
    confidence: number;
    quorumMet: boolean;
    vetoApplied: boolean;
    riskGatePassed: boolean;
    contributingStrategies: number;
    totalStrategies: number;
    breakdown: {
      long: { count: number; avgConfidence: number };
      short: { count: number; avgConfidence: number };
      flat: { count: number; avgConfidence: number };
    };
    strategyIds: string[];
  } | null;
  signals: Array<{
    strategyId: string;
    side: 'LONG' | 'SHORT' | 'FLAT';
    confidence: number;
    timestamp: number;
    metadata?: Record<string, unknown>;
  }>;
  config: {
    minQuorumSize: number;
    minConfidenceThreshold: number;
    maxSignalAgeMs: number;
    minActionConfidence: number;
    longWeight: number;
    shortWeight: number;
  };
}

// Options for creating strategy routes
export interface StrategyRoutesOptions {
  consensusEngine: ConsensusEngine;
  getCurrentSignals: (symbol?: string) => StrategySignal[];
  getCurrentRiskState: (symbol?: string) => RiskState;
}

/**
 * Create strategy API routes
 */
export function createStrategyRoutes(options: StrategyRoutesOptions): Router {
  const router = Router();
  const { consensusEngine, getCurrentSignals, getCurrentRiskState } = options;

  /**
   * GET /api/strategy/snapshot
   * Returns current consensus decision and strategy signals
   */
  router.get('/snapshot', (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      const symbol = typeof _req.query.symbol === 'string' ? String(_req.query.symbol).toUpperCase() : undefined;
      const signals = getCurrentSignals(symbol);
      const riskState = getCurrentRiskState(symbol);
      
      // Evaluate consensus
      let consensus: StrategySnapshotResponse['consensus'] = null;
      
      try {
        const decision = consensusEngine.evaluate(signals, riskState, now);
        consensus = {
          side: decision.side,
          confidence: decision.confidence,
          quorumMet: decision.quorumMet,
          vetoApplied: decision.vetoApplied,
          riskGatePassed: decision.riskGatePassed,
          contributingStrategies: decision.contributingStrategies,
          totalStrategies: decision.totalStrategies,
          breakdown: decision.breakdown,
          strategyIds: decision.strategyIds,
        };
      } catch (consensusError) {
        // Consensus evaluation failed, return null consensus but continue
      }

      // Format signals for response
      const formattedSignals = signals.map(signal => ({
        strategyId: signal.strategyId,
        side: signal.side,
        confidence: signal.confidence,
        timestamp: signal.timestamp,
        metadata: signal.metadata,
      }));

      // Get consensus config
      const config = (consensusEngine as any).config || {
        minQuorumSize: 2,
        minConfidenceThreshold: 0.3,
        maxSignalAgeMs: 5000,
        minActionConfidence: 0.5,
        longWeight: 1.0,
        shortWeight: 1.0,
      };

      const response: StrategySnapshotResponse = {
        timestamp: now,
        consensus,
        signals: formattedSignals,
        config: {
          minQuorumSize: config.minQuorumSize,
          minConfidenceThreshold: config.minConfidenceThreshold,
          maxSignalAgeMs: config.maxSignalAgeMs,
          minActionConfidence: config.minActionConfidence,
          longWeight: config.longWeight,
          shortWeight: config.shortWeight,
        },
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json({
        error: 'strategy_snapshot_failed',
        message: error?.message || 'Failed to get strategy snapshot',
      });
    }
  });

  /**
   * GET /api/strategy/signals
   * Returns raw strategy signals without consensus evaluation
   */
  router.get('/signals', (_req: Request, res: Response) => {
    try {
      const symbol = typeof _req.query.symbol === 'string' ? String(_req.query.symbol).toUpperCase() : undefined;
      const signals = getCurrentSignals(symbol);
      
      res.status(200).json({
        timestamp: Date.now(),
        count: signals.length,
        signals: signals.map(signal => ({
          strategyId: signal.strategyId,
          side: signal.side,
          confidence: signal.confidence,
          timestamp: signal.timestamp,
          metadata: signal.metadata,
        })),
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'strategy_signals_failed',
        message: error?.message || 'Failed to get strategy signals',
      });
    }
  });

  /**
   * GET /api/strategy/consensus
   * Returns only the consensus decision
   */
  router.get('/consensus', (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      const symbol = typeof _req.query.symbol === 'string' ? String(_req.query.symbol).toUpperCase() : undefined;
      const signals = getCurrentSignals(symbol);
      const riskState = getCurrentRiskState(symbol);
      
      const decision = consensusEngine.evaluate(signals, riskState, now);
      
      res.status(200).json({
        timestamp: now,
        consensus: {
          side: decision.side,
          confidence: decision.confidence,
          quorumMet: decision.quorumMet,
          vetoApplied: decision.vetoApplied,
          riskGatePassed: decision.riskGatePassed,
          contributingStrategies: decision.contributingStrategies,
          totalStrategies: decision.totalStrategies,
          breakdown: decision.breakdown,
          strategyIds: decision.strategyIds,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'strategy_consensus_failed',
        message: error?.message || 'Failed to get consensus',
      });
    }
  });

  return router;
}
