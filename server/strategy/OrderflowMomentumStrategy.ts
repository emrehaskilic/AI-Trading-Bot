/**
 * Orderflow Momentum Strategy
 * 
 * Focuses on aggressive orderflow confirmation through deltaZ, CVD slope, and OBI alignment.
 * Captures strong directional moves confirmed by multiple orderflow dimensions.
 */

import { NormalizationStore } from './Normalization';
import { DirectionalFlowScore, DirectionalFlowWeights } from './DirectionalFlowScore';
import { InstitutionalRiskEngine } from '../risk/InstitutionalRiskEngine';

export interface OrderflowMomentumConfig {
  // Entry thresholds
  entryThresholdLong: number;
  entryThresholdShort: number;
  exitThresholdLong: number;
  exitThresholdShort: number;
  
  // Component thresholds
  minAlignment: number;
  cvdMinSlope: number;
  obiMinThreshold: number;
  deltaMinThreshold: number;
  
  // Confirmation
  confirmationThreshold: number;
  minConsecutive: number;
  
  // Time
  maxHoldTimeMs: number;
  hardStopPct: number;
  
  // Normalization window
  rollingWindowMin: number;
}

export const defaultOrderflowMomentumConfig: OrderflowMomentumConfig = {
  entryThresholdLong: 0.85,
  entryThresholdShort: 0.15,
  exitThresholdLong: 0.35,
  exitThresholdShort: 0.65,
  minAlignment: 2,
  cvdMinSlope: 0.5,
  obiMinThreshold: 0.3,
  deltaMinThreshold: 1.0,
  confirmationThreshold: 0.90,
  minConsecutive: 2,
  maxHoldTimeMs: 300000, // 5 minutes
  hardStopPct: 0.015,    // 1.5%
  rollingWindowMin: 5,
};

// Momentum-focused DFS weights
const MOMENTUM_WEIGHTS: DirectionalFlowWeights = {
  w1: 0.30,  // deltaZ (increased for momentum focus)
  w2: 0.25,  // cvdSlope (increased for trend confirmation)
  w3: 0.15,  // logP
  w4: 0.10,  // obiWeighted
  w5: 0.12,  // obiDeep
  w6: 0.05,  // sweepSigned
  w7: 0.03,  // burstSigned
  w8: 0.00,  // oiImpulse (removed for pure orderflow)
};

export interface StrategyInput {
  nowMs: number;
  symbol: string;
  price: number;
  vwap: number;
  deltaZ: number;
  cvdSlope: number;
  obiDeep: number;
  obiWeighted: number;
  delta5s: number;
  aggressiveBuyVolume: number;
  aggressiveSellVolume: number;
  printsPerSecond: number;
  consecutiveBurst: {
    count: number;
    side: 'buy' | 'sell' | null;
  };
  absorption?: {
    value: number;
    side: 'buy' | 'sell';
  } | null;
  volatility: number;
}

export interface Position {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTimestamp: number;
  entryDfs: number;
}

export interface StrategyDecision {
  action: 'ENTRY' | 'EXIT' | 'NOOP';
  side?: 'LONG' | 'SHORT';
  reason: string;
  metadata?: Record<string, unknown>;
}

export class OrderflowMomentumStrategy {
  private readonly config: OrderflowMomentumConfig;
  private readonly norm: NormalizationStore;
  private readonly dfs: DirectionalFlowScore;
  private readonly riskEngine: InstitutionalRiskEngine;
  
  // State tracking
  private position: Position | null = null;
  private consecutiveConfirmations = 0;
  private lastDfsPercentile = 0.5;
  private lastDeltaZ = 0;
  
  constructor(
    riskEngine: InstitutionalRiskEngine,
    config?: Partial<OrderflowMomentumConfig>
  ) {
    this.config = { ...defaultOrderflowMomentumConfig, ...(config || {}) };
    const windowMs = Math.max(60_000, this.config.rollingWindowMin * 60_000);
    this.norm = new NormalizationStore(windowMs, 64);
    this.dfs = new DirectionalFlowScore(this.norm, MOMENTUM_WEIGHTS);
    this.riskEngine = riskEngine;
  }
  
  evaluate(input: StrategyInput): StrategyDecision {
    // Compute DFS with momentum-focused weights
    const dfsOut = this.dfs.compute({
      deltaZ: input.deltaZ,
      cvdSlope: input.cvdSlope,
      obiWeighted: input.obiWeighted,
      obiDeep: input.obiDeep,
      sweepStrength: input.delta5s,
      burstCount: input.consecutiveBurst.count,
      burstSide: input.consecutiveBurst.side,
      aggressiveBuyVolume: input.aggressiveBuyVolume,
      aggressiveSellVolume: input.aggressiveSellVolume,
      oiChangePct: 0,
      price: input.price,
      prevPrice: this.position?.entryPrice ?? null,
      prevCvd: null,
      nowMs: input.nowMs,
    });
    
    // Calculate component alignment
    const alignment = this.calculateAlignment(input, dfsOut.dfs);
    
    // Check for entry
    if (!this.position) {
      const entrySignal = this.checkEntry(input, dfsOut.dfsPercentile, alignment);
      if (entrySignal.valid) {
        // Check risk
        const riskCheck = this.riskEngine.canTrade(
          input.symbol,
          1,
          input.price,
          entrySignal.side!.toLowerCase() as 'long' | 'short'
        );
        
        if (!riskCheck.allowed) {
          return { action: 'NOOP', reason: `RISK_BLOCKED: ${riskCheck.reason}` };
        }
        
        this.position = {
          side: entrySignal.side!,
          entryPrice: input.price,
          entryTimestamp: input.nowMs,
          entryDfs: dfsOut.dfs,
        };
        this.consecutiveConfirmations = 0;
        
        return {
          action: 'ENTRY',
          side: entrySignal.side!,
          reason: 'MOMENTUM_CONFIRMED',
          metadata: {
            dfs: dfsOut.dfs,
            dfsPercentile: dfsOut.dfsPercentile,
            alignment,
          },
        };
      }
    } else {
      // Check for exit
      const exitSignal = this.checkExit(input, dfsOut.dfsPercentile, alignment);
      if (exitSignal.valid) {
        const side = this.position.side;
        this.position = null;
        this.consecutiveConfirmations = 0;
        
        return {
          action: 'EXIT',
          side,
          reason: exitSignal.reason,
          metadata: {
            dfs: dfsOut.dfs,
            dfsPercentile: dfsOut.dfsPercentile,
          },
        };
      }
    }
    
    this.lastDfsPercentile = dfsOut.dfsPercentile;
    this.lastDeltaZ = input.deltaZ;
    
    return { action: 'NOOP', reason: 'NO_SIGNAL' };
  }
  
  private calculateAlignment(input: StrategyInput, dfs: number): number {
    const deltaDirection = Math.sign(input.deltaZ);
    const cvdDirection = Math.sign(input.cvdSlope);
    const obiDirection = Math.sign(input.obiDeep);
    const dfsDirection = Math.sign(dfs);
    
    let aligned = 0;
    if (deltaDirection === dfsDirection) aligned += 1;
    if (cvdDirection === dfsDirection) aligned += 1;
    if (obiDirection === dfsDirection) aligned += 1;
    
    return aligned;
  }
  
  private checkEntry(
    input: StrategyInput,
    dfsP: number,
    alignment: number
  ): { valid: boolean; side?: 'LONG' | 'SHORT' } {
    // Long entry conditions
    if (
      dfsP >= this.config.entryThresholdLong &&
      alignment >= this.config.minAlignment &&
      input.cvdSlope > this.config.cvdMinSlope &&
      input.obiDeep > this.config.obiMinThreshold &&
      input.deltaZ > this.config.deltaMinThreshold
    ) {
      if (dfsP >= this.config.confirmationThreshold) {
        this.consecutiveConfirmations += 1;
      } else {
        this.consecutiveConfirmations = 0;
      }
      
      if (this.consecutiveConfirmations >= this.config.minConsecutive) {
        return { valid: true, side: 'LONG' };
      }
    }
    
    // Short entry conditions
    if (
      dfsP <= this.config.entryThresholdShort &&
      alignment >= this.config.minAlignment &&
      input.cvdSlope < -this.config.cvdMinSlope &&
      input.obiDeep < -this.config.obiMinThreshold &&
      input.deltaZ < -this.config.deltaMinThreshold
    ) {
      if (dfsP <= 1 - this.config.confirmationThreshold) {
        this.consecutiveConfirmations += 1;
      } else {
        this.consecutiveConfirmations = 0;
      }
      
      if (this.consecutiveConfirmations >= this.config.minConsecutive) {
        return { valid: true, side: 'SHORT' };
      }
    }
    
    this.consecutiveConfirmations = 0;
    return { valid: false };
  }
  
  private checkExit(
    input: StrategyInput,
    dfsP: number,
    alignment: number
  ): { valid: boolean; reason: string } {
    if (!this.position) return { valid: false, reason: '' };
    
    const timeInTrade = input.nowMs - this.position.entryTimestamp;
    
    // Time-based exit
    if (timeInTrade >= this.config.maxHoldTimeMs) {
      return { valid: true, reason: 'TIME_EXIT' };
    }
    
    // Hard stop
    const priceChange = (input.price - this.position.entryPrice) / this.position.entryPrice;
    if (this.position.side === 'LONG' && priceChange < -this.config.hardStopPct) {
      return { valid: true, reason: 'HARD_STOP' };
    }
    if (this.position.side === 'SHORT' && priceChange > this.config.hardStopPct) {
      return { valid: true, reason: 'HARD_STOP' };
    }
    
    // Momentum reversal exit
    if (this.position.side === 'LONG') {
      if (dfsP <= this.config.exitThresholdLong) {
        return { valid: true, reason: 'MOMENTUM_REVERSAL' };
      }
      if (alignment === 0 && dfsP <= 0.4) {
        return { valid: true, reason: 'ALIGNMENT_BREAKDOWN' };
      }
    }
    
    if (this.position.side === 'SHORT') {
      if (dfsP >= this.config.exitThresholdShort) {
        return { valid: true, reason: 'MOMENTUM_REVERSAL' };
      }
      if (alignment === 0 && dfsP >= 0.6) {
        return { valid: true, reason: 'ALIGNMENT_BREAKDOWN' };
      }
    }
    
    return { valid: false, reason: '' };
  }
  
  getPosition(): Position | null {
    return this.position;
  }
  
  reset(): void {
    this.position = null;
    this.consecutiveConfirmations = 0;
    this.lastDfsPercentile = 0.5;
    this.lastDeltaZ = 0;
  }
}
