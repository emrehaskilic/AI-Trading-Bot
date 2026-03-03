/**
 * ConsensusEngine.ts
 * 
 * Aggregates strategy signals and produces a consensus decision.
 * Part of FAZ-5 Strategy Framework.
 */

import { RiskState } from '../risk/RiskStateManager';
import { 
  StrategySignal, 
  SignalSide, 
  StrategyContext 
} from '../strategies/StrategyInterface';

/** Consensus configuration */
export interface ConsensusConfig {
  /** Minimum number of signals required for consensus (quorum) */
  minQuorumSize: number;
  /** Minimum confidence threshold for a valid signal (0.0 - 1.0) */
  minConfidenceThreshold: number;
  /** Maximum signal age in milliseconds */
  maxSignalAgeMs: number;
  /** Weight for LONG signals in conflict resolution */
  longWeight: number;
  /** Weight for SHORT signals in conflict resolution */
  shortWeight: number;
  /** Minimum aggregated confidence to take action */
  minActionConfidence: number;
  /** Whether to allow FLAT signals to participate in consensus */
  includeFlatSignals: boolean;
}

/** Default consensus configuration */
export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  minQuorumSize: 2,
  minConfidenceThreshold: 0.3,
  maxSignalAgeMs: 5000,
  longWeight: 1.0,
  shortWeight: 1.0,
  minActionConfidence: 0.5,
  includeFlatSignals: false
};

/** Consensus decision output */
export interface ConsensusDecision {
  /** Consensus side (LONG, SHORT, or FLAT) */
  side: SignalSide;
  /** Aggregated confidence level */
  confidence: number;
  /** Number of strategies that contributed to consensus */
  contributingStrategies: number;
  /** Total number of strategies evaluated */
  totalStrategies: number;
  /** Whether quorum was achieved */
  quorumMet: boolean;
  /** Whether any veto was applied */
  vetoApplied: boolean;
  /** Risk gate status */
  riskGatePassed: boolean;
  /** Timestamp of decision */
  timestamp: number;
  /** Detailed breakdown by side */
  breakdown: {
    long: { count: number; avgConfidence: number };
    short: { count: number; avgConfidence: number };
    flat: { count: number; avgConfidence: number };
  };
  /** IDs of strategies that contributed signals */
  strategyIds: string[];
}

export class ConsensusEngine {
  private config: ConsensusConfig;

  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
  }

  /**
   * Evaluate signals and produce a consensus decision
   * @param signals - Array of strategy signals
   * @param riskState - Current risk state
   * @param currentTime - Current timestamp (deterministic)
   * @returns Consensus decision
   */
  evaluate(
    signals: StrategySignal[], 
    riskState: RiskState,
    currentTime: number
  ): ConsensusDecision {
    // Step 1: Filter valid signals
    let validSignals = this.filterValidSignals(signals, currentTime);
    
    // Step 2: Apply veto rules
    const vetoResult = this.applyVetoRules(validSignals);
    validSignals = vetoResult.signals;
    const vetoApplied = vetoResult.vetoApplied;

    // Step 3: Check quorum
    const quorumMet = this.checkQuorum(validSignals);

    // Step 4: Calculate breakdown
    const breakdown = this.calculateBreakdown(validSignals);

    // Step 5: Resolve conflicts and determine side
    let side = this.resolveConflicts(validSignals);
    let confidence = this.calculateAggregatedConfidence(validSignals, side);

    // Step 6: Build initial decision
    let decision: ConsensusDecision = {
      side,
      confidence,
      contributingStrategies: validSignals.length,
      totalStrategies: signals.length,
      quorumMet,
      vetoApplied,
      riskGatePassed: true, // Will be updated
      timestamp: currentTime,
      breakdown,
      strategyIds: validSignals.map(s => s.strategyId)
    };

    // Step 7: Apply risk gate
    decision = this.checkRiskGate(decision, riskState);

    return decision;
  }

  /**
   * Filter signals based on validity criteria
   */
  private filterValidSignals(
    signals: StrategySignal[], 
    currentTime: number
  ): StrategySignal[] {
    return signals.filter(signal => {
      // Check confidence threshold
      if (signal.confidence < this.config.minConfidenceThreshold) {
        return false;
      }

      // Check signal age
      const signalAge = currentTime - signal.timestamp;
      if (signalAge > this.config.maxSignalAgeMs) {
        return false;
      }

      // Include/exclude FLAT signals based on config
      if (signal.side === SignalSide.FLAT && !this.config.includeFlatSignals) {
        return false;
      }

      return true;
    });
  }

  /**
   * Apply veto rules - veto strategies can force FLAT
   */
  private applyVetoRules(signals: StrategySignal[]): { 
    signals: StrategySignal[]; 
    vetoApplied: boolean 
  } {
    // Check if any veto strategy is signaling FLAT
    const vetoFlatSignals = signals.filter(
      s => s.side === SignalSide.FLAT && s.metadata?.canVeto === true
    );

    if (vetoFlatSignals.length > 0) {
      // Veto applied - return only FLAT signals
      return {
        signals: signals.filter(s => s.side === SignalSide.FLAT),
        vetoApplied: true
      };
    }

    return { signals, vetoApplied: false };
  }

  /**
   * Check if quorum is achieved
   */
  private checkQuorum(signals: StrategySignal[]): boolean {
    // Only count non-FLAT signals for quorum
    const actionableSignals = signals.filter(
      s => s.side === SignalSide.LONG || s.side === SignalSide.SHORT
    );
    return actionableSignals.length >= this.config.minQuorumSize;
  }

  /**
   * Calculate aggregated confidence for a given side
   */
  private calculateAggregatedConfidence(
    signals: StrategySignal[], 
    targetSide: SignalSide
  ): number {
    const sideSignals = signals.filter(s => s.side === targetSide);
    
    if (sideSignals.length === 0) {
      return 0;
    }

    // Weighted average of confidence
    const totalConfidence = sideSignals.reduce((sum, s) => sum + s.confidence, 0);
    return totalConfidence / sideSignals.length;
  }

  /**
   * Calculate breakdown statistics by side
   */
  private calculateBreakdown(signals: StrategySignal[]): ConsensusDecision['breakdown'] {
    const longSignals = signals.filter(s => s.side === SignalSide.LONG);
    const shortSignals = signals.filter(s => s.side === SignalSide.SHORT);
    const flatSignals = signals.filter(s => s.side === SignalSide.FLAT);

    const avgConfidence = (arr: StrategySignal[]): number => {
      if (arr.length === 0) return 0;
      return arr.reduce((sum, s) => sum + s.confidence, 0) / arr.length;
    };

    return {
      long: {
        count: longSignals.length,
        avgConfidence: avgConfidence(longSignals)
      },
      short: {
        count: shortSignals.length,
        avgConfidence: avgConfidence(shortSignals)
      },
      flat: {
        count: flatSignals.length,
        avgConfidence: avgConfidence(flatSignals)
      }
    };
  }

  /**
   * Resolve conflicts between LONG and SHORT signals
   */
  private resolveConflicts(signals: StrategySignal[]): SignalSide {
    const longSignals = signals.filter(s => s.side === SignalSide.LONG);
    const shortSignals = signals.filter(s => s.side === SignalSide.SHORT);
    const flatSignals = signals.filter(s => s.side === SignalSide.FLAT);

    // If only FLAT signals, return FLAT
    if (longSignals.length === 0 && shortSignals.length === 0) {
      return SignalSide.FLAT;
    }

    // Calculate weighted scores
    const longScore = longSignals.reduce(
      (sum, s) => sum + s.confidence, 
      0
    ) * this.config.longWeight;

    const shortScore = shortSignals.reduce(
      (sum, s) => sum + s.confidence, 
      0
    ) * this.config.shortWeight;

    // Determine winner
    if (longScore > shortScore) {
      return SignalSide.LONG;
    } else if (shortScore > longScore) {
      return SignalSide.SHORT;
    } else {
      // Tie - return FLAT
      return SignalSide.FLAT;
    }
  }

  /**
   * Apply risk gate to the decision
   */
  private checkRiskGate(
    decision: ConsensusDecision, 
    riskState: RiskState
  ): ConsensusDecision {
    let riskGatePassed = true;
    let modifiedDecision = { ...decision };

    switch (riskState) {
      case RiskState.TRACKING:
        // Normal operation
        riskGatePassed = true;
        break;

      case RiskState.REDUCED_RISK:
        // Reduce confidence by 50%
        modifiedDecision.confidence = decision.confidence * 0.5;
        riskGatePassed = modifiedDecision.confidence >= this.config.minActionConfidence;
        break;

      case RiskState.HALTED:
        // No new positions
        riskGatePassed = false;
        modifiedDecision.side = SignalSide.FLAT;
        modifiedDecision.confidence = 0;
        break;

      case RiskState.KILL_SWITCH:
        // Emergency stop - force FLAT
        riskGatePassed = false;
        modifiedDecision.side = SignalSide.FLAT;
        modifiedDecision.confidence = 0;
        break;
    }

    modifiedDecision.riskGatePassed = riskGatePassed;
    return modifiedDecision;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConsensusConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ConsensusConfig {
    return { ...this.config };
  }

  /**
   * Check if a decision should result in a trade action
   */
  shouldTrade(decision: ConsensusDecision): boolean {
    return (
      decision.quorumMet &&
      decision.riskGatePassed &&
      decision.confidence >= this.config.minActionConfidence &&
      decision.side !== SignalSide.FLAT
    );
  }
}
