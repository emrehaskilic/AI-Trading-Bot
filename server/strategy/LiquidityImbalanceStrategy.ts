/**
 * Liquidity Imbalance Strategy
 * 
 * Exploits extreme orderbook imbalances (obiDeep, obiWeighted) as leading indicators.
 * When liquidity is significantly skewed to one side, price tends to move toward the thinner side.
 */

import { NormalizationStore } from './Normalization';
import { InstitutionalRiskEngine } from '../risk/InstitutionalRiskEngine';

export interface LiquidityImbalanceConfig {
  // Imbalance thresholds
  extremeLongThreshold: number;
  extremeShortThreshold: number;
  extremePercentile: number;
  obiConfirmPercentile: number;
  
  // Exit
  normalizationThreshold: number;
  minExtremeCount: number;
  maxHoldTimeMs: number;
  vwapRejectionPct: number;
  
  // Normalization window
  rollingWindowMin: number;
  historySize: number;
}

export const defaultLiquidityImbalanceConfig: LiquidityImbalanceConfig = {
  extremeLongThreshold: 0.8,
  extremeShortThreshold: 0.8,
  extremePercentile: 0.90,
  obiConfirmPercentile: 0.85,
  normalizationThreshold: 0.3,
  minExtremeCount: 3,
  maxHoldTimeMs: 180000, // 3 minutes
  vwapRejectionPct: 0.002,
  rollingWindowMin: 3,
  historySize: 20,
};

export interface ImbalanceInput {
  nowMs: number;
  symbol: string;
  price: number;
  vwap: number;
  obiDeep: number;
  obiWeighted: number;
  deltaZ: number;
  printsPerSecond: number;
}

export interface ImbalancePosition {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTimestamp: number;
  entryImbalance: number;
}

export interface ImbalanceDecision {
  action: 'ENTRY' | 'EXIT' | 'NOOP';
  side?: 'LONG' | 'SHORT';
  reason: string;
  metadata?: Record<string, unknown>;
}

export class LiquidityImbalanceStrategy {
  private readonly config: LiquidityImbalanceConfig;
  private readonly norm: NormalizationStore;
  private readonly riskEngine: InstitutionalRiskEngine;
  
  // State tracking
  private position: ImbalancePosition | null = null;
  private imbalanceHistory: number[] = [];
  private entryTimestamp = 0;
  
  constructor(
    riskEngine: InstitutionalRiskEngine,
    config?: Partial<LiquidityImbalanceConfig>
  ) {
    this.config = { ...defaultLiquidityImbalanceConfig, ...(config || {}) };
    const windowMs = Math.max(60_000, this.config.rollingWindowMin * 60_000);
    this.norm = new NormalizationStore(windowMs, 64);
    this.riskEngine = riskEngine;
  }
  
  evaluate(input: ImbalanceInput): ImbalanceDecision {
    // Calculate composite imbalance score
    const imbalanceScore = this.calculateImbalanceScore(input);
    
    // Update history
    this.imbalanceHistory.push(imbalanceScore);
    if (this.imbalanceHistory.length > this.config.historySize) {
      this.imbalanceHistory.shift();
    }
    
    // Update normalization
    this.norm.update('imbalance', imbalanceScore, input.nowMs);
    this.norm.update('obiDeep', input.obiDeep, input.nowMs);
    this.norm.update('obiWeighted', input.obiWeighted, input.nowMs);
    
    // Calculate percentiles
    const imbalanceP = this.norm.percentile('imbalance', imbalanceScore);
    const obiDeepP = this.norm.percentile('obiDeep', input.obiDeep);
    const obiWeightedP = this.norm.percentile('obiWeighted', input.obiWeighted);
    
    // Check entry
    if (!this.position) {
      const entrySignal = this.checkImbalanceEntry(
        input,
        imbalanceScore,
        imbalanceP,
        obiDeepP,
        obiWeightedP
      );
      
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
          entryImbalance: imbalanceScore,
        };
        this.entryTimestamp = input.nowMs;
        
        return {
          action: 'ENTRY',
          side: entrySignal.side!,
          reason: 'IMBALANCE_EXTREME',
          metadata: {
            imbalanceScore,
            imbalanceP,
            obiDeepP,
            obiWeightedP,
          },
        };
      }
    } else {
      // Check exit
      const exitSignal = this.checkImbalanceExit(input, imbalanceScore, imbalanceP);
      
      if (exitSignal.valid) {
        const side = this.position.side;
        this.position = null;
        
        return {
          action: 'EXIT',
          side,
          reason: exitSignal.reason,
          metadata: {
            imbalanceScore,
            imbalanceP,
          },
        };
      }
    }
    
    return { action: 'NOOP', reason: 'NO_SIGNAL' };
  }
  
  private calculateImbalanceScore(input: ImbalanceInput): number {
    const deepWeight = 0.6;
    const weightedWeight = 0.4;
    
    let score = deepWeight * input.obiDeep + weightedWeight * input.obiWeighted;
    
    // Boost score if both metrics agree
    if (Math.sign(input.obiDeep) === Math.sign(input.obiWeighted)) {
      score = score * 1.2;
    }
    
    return score;
  }
  
  private checkImbalanceEntry(
    input: ImbalanceInput,
    score: number,
    scoreP: number,
    obiDeepP: number,
    obiWeightedP: number
  ): { valid: boolean; side?: 'LONG' | 'SHORT' } {
    // Extreme buy imbalance -> expect price up (long)
    if (
      score >= this.config.extremeLongThreshold &&
      scoreP >= this.config.extremePercentile &&
      obiDeepP >= this.config.obiConfirmPercentile &&
      obiWeightedP >= this.config.obiConfirmPercentile
    ) {
      // Check for mean reversion warning (don't chase too far)
      if (input.price > input.vwap * 1.005) {
        return { valid: false };
      }
      
      // Require confirmation from recent history
      const recentExtremes = this.countRecentExtremes('buy');
      if (recentExtremes >= this.config.minExtremeCount) {
        return { valid: true, side: 'LONG' };
      }
    }
    
    // Extreme sell imbalance -> expect price down (short)
    if (
      score <= -this.config.extremeShortThreshold &&
      scoreP <= 1 - this.config.extremePercentile &&
      obiDeepP <= 1 - this.config.obiConfirmPercentile &&
      obiWeightedP <= 1 - this.config.obiConfirmPercentile
    ) {
      if (input.price < input.vwap * 0.995) {
        return { valid: false };
      }
      
      const recentExtremes = this.countRecentExtremes('sell');
      if (recentExtremes >= this.config.minExtremeCount) {
        return { valid: true, side: 'SHORT' };
      }
    }
    
    return { valid: false };
  }
  
  private checkImbalanceExit(
    input: ImbalanceInput,
    score: number,
    scoreP: number
  ): { valid: boolean; reason: string } {
    if (!this.position) return { valid: false, reason: '' };
    
    // Normalization exit
    if (this.position.side === 'LONG') {
      if (
        score <= this.config.normalizationThreshold ||
        scoreP <= 0.55
      ) {
        return { valid: true, reason: 'IMBALANCE_NORMALIZED' };
      }
    }
    
    if (this.position.side === 'SHORT') {
      if (
        score >= -this.config.normalizationThreshold ||
        scoreP >= 0.45
      ) {
        return { valid: true, reason: 'IMBALANCE_NORMALIZED' };
      }
    }
    
    // Time decay exit
    const timeHeld = input.nowMs - this.entryTimestamp;
    if (timeHeld > this.config.maxHoldTimeMs) {
      return { valid: true, reason: 'TIME_DECAY' };
    }
    
    // VWAP rejection exit
    if (
      this.position.side === 'LONG' &&
      input.price < input.vwap * (1 - this.config.vwapRejectionPct)
    ) {
      return { valid: true, reason: 'VWAP_REJECTION' };
    }
    if (
      this.position.side === 'SHORT' &&
      input.price > input.vwap * (1 + this.config.vwapRejectionPct)
    ) {
      return { valid: true, reason: 'VWAP_REJECTION' };
    }
    
    return { valid: false, reason: '' };
  }
  
  private countRecentExtremes(side: 'buy' | 'sell'): number {
    let count = 0;
    for (const score of this.imbalanceHistory) {
      if (side === 'buy' && score >= this.config.extremeLongThreshold) {
        count += 1;
      }
      if (side === 'sell' && score <= -this.config.extremeShortThreshold) {
        count += 1;
      }
    }
    return count;
  }
  
  getPosition(): ImbalancePosition | null {
    return this.position;
  }
  
  reset(): void {
    this.position = null;
    this.imbalanceHistory = [];
    this.entryTimestamp = 0;
  }
}
