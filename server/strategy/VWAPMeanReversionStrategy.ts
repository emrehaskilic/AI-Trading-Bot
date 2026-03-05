/**
 * VWAP Mean Reversion Strategy
 * 
 * Capitalizes on price deviations from VWAP, assuming price tends to revert to this fair value.
 * Uses deviation percentiles to identify extreme moves and orderflow confirmation for entry timing.
 */

import { NormalizationStore } from './Normalization';
import { InstitutionalRiskEngine } from '../risk/InstitutionalRiskEngine';

export interface VWAPMeanReversionConfig {
  // Deviation thresholds
  deviationPercentileThreshold: number;
  vwapProximityThreshold: number;
  
  // Confirmation
  absorptionThreshold: number;
  cvdStabilizingThreshold: number;
  
  // Exit
  maxHoldTimeMs: number;
  trailingTakeProfit: number;
  stopLossExtension: number;
  
  // Normalization window
  rollingWindowMin: number;
}

export const defaultVWAPMeanReversionConfig: VWAPMeanReversionConfig = {
  deviationPercentileThreshold: 0.85,
  vwapProximityThreshold: 0.001,
  absorptionThreshold: 50000,
  cvdStabilizingThreshold: 0.3,
  maxHoldTimeMs: 480000, // 8 minutes
  trailingTakeProfit: 0.70,
  stopLossExtension: 1.5,
  rollingWindowMin: 10,
};

export interface VWAPInput {
  nowMs: number;
  symbol: string;
  price: number;
  vwap: number;
  deltaZ: number;
  cvdSlope: number;
  previousDeltaZ: number;
  previousPrice: number;
  absorption?: {
    value: number;
    side: 'buy' | 'sell';
  } | null;
}

export interface VWAPPosition {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTimestamp: number;
  entryDeviation: number;
}

export interface VWAPDecision {
  action: 'ENTRY' | 'EXIT' | 'NOOP';
  side?: 'LONG' | 'SHORT';
  reason: string;
  metadata?: Record<string, unknown>;
}

export class VWAPMeanReversionStrategy {
  private readonly config: VWAPMeanReversionConfig;
  private readonly norm: NormalizationStore;
  private readonly riskEngine: InstitutionalRiskEngine;
  
  // State tracking
  private position: VWAPPosition | null = null;
  private entryTimestamp = 0;
  private vwapTouchCount = 0;
  private lastPrice = 0;
  private lastDeltaZ = 0;
  
  constructor(
    riskEngine: InstitutionalRiskEngine,
    config?: Partial<VWAPMeanReversionConfig>
  ) {
    this.config = { ...defaultVWAPMeanReversionConfig, ...(config || {}) };
    const windowMs = Math.max(60_000, this.config.rollingWindowMin * 60_000);
    this.norm = new NormalizationStore(windowMs, 64);
    this.riskEngine = riskEngine;
  }
  
  evaluate(input: VWAPInput): VWAPDecision {
    // Calculate VWAP deviation
    const deviation = input.price - input.vwap;
    const deviationPct = deviation / input.vwap;
    const absDeviation = Math.abs(deviation);
    
    // Update normalization
    this.norm.update('deviation', deviation, input.nowMs);
    this.norm.update('deviationPct', deviationPct, input.nowMs);
    this.norm.update('absDeviation', absDeviation, input.nowMs);
    
    // Calculate percentiles
    const deviationP = this.norm.percentile('deviation', deviation);
    const absDeviationP = this.norm.percentile('absDeviation', absDeviation);
    
    // Track VWAP touches
    this.updateVWAPTouchCount(input.price, input.vwap);
    
    // Check entry
    if (!this.position) {
      const entrySignal = this.checkMeanRevEntry(
        input,
        deviation,
        deviationPct,
        deviationP,
        absDeviationP
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
          entryDeviation: deviation,
        };
        this.entryTimestamp = input.nowMs;
        this.vwapTouchCount = 0;
        
        return {
          action: 'ENTRY',
          side: entrySignal.side!,
          reason: 'MEAN_REVERSION',
          metadata: {
            deviation,
            deviationPct,
            deviationP,
            absDeviationP,
          },
        };
      }
    } else {
      // Check exit
      const exitSignal = this.checkMeanRevExit(input, deviation, deviationP);
      
      if (exitSignal.valid) {
        const side = this.position.side;
        this.position = null;
        
        return {
          action: 'EXIT',
          side,
          reason: exitSignal.reason,
          metadata: {
            deviation,
            deviationP,
          },
        };
      }
    }
    
    this.lastPrice = input.price;
    this.lastDeltaZ = input.deltaZ;
    
    return { action: 'NOOP', reason: 'NO_SIGNAL' };
  }
  
  private checkMeanRevEntry(
    input: VWAPInput,
    deviation: number,
    deviationPct: number,
    deviationP: number,
    absDeviationP: number
  ): { valid: boolean; side?: 'LONG' | 'SHORT' } {
    // Long entry: price significantly below VWAP
    if (deviation < 0 && absDeviationP >= this.config.deviationPercentileThreshold) {
      // Check for reversal confirmation
      const reversalConfirm = this.checkReversalConfirmation(input, 'LONG');
      
      // Check delta improving (becoming less negative)
      const deltaImproving = input.deltaZ > input.previousDeltaZ;
      
      // Check CVD stabilizing or turning up
      const cvdStabilizing = input.cvdSlope > -this.config.cvdStabilizingThreshold;
      
      if (reversalConfirm && deltaImproving && cvdStabilizing) {
        // Additional: check for absorption at lows
        const absorptionOk =
          input.absorption?.side === 'buy' ||
          (input.absorption?.value ?? 0) > this.config.absorptionThreshold;
        
        if (absorptionOk) {
          return { valid: true, side: 'LONG' };
        }
      }
    }
    
    // Short entry: price significantly above VWAP
    if (deviation > 0 && absDeviationP >= this.config.deviationPercentileThreshold) {
      const reversalConfirm = this.checkReversalConfirmation(input, 'SHORT');
      const deltaImproving = input.deltaZ < input.previousDeltaZ;
      const cvdStabilizing = input.cvdSlope < this.config.cvdStabilizingThreshold;
      
      if (reversalConfirm && deltaImproving && cvdStabilizing) {
        const absorptionOk =
          input.absorption?.side === 'sell' ||
          (input.absorption?.value ?? 0) > this.config.absorptionThreshold;
        
        if (absorptionOk) {
          return { valid: true, side: 'SHORT' };
        }
      }
    }
    
    return { valid: false };
  }
  
  private checkReversalConfirmation(
    input: VWAPInput,
    side: 'LONG' | 'SHORT'
  ): boolean {
    const price = input.price;
    const prevPrice = input.previousPrice;
    
    if (side === 'LONG') {
      // Price moving up toward VWAP
      if (
        price > prevPrice &&
        price - input.vwap > prevPrice - input.vwap
      ) {
        return true;
      }
    }
    
    if (side === 'SHORT') {
      // Price moving down toward VWAP
      if (
        price < prevPrice &&
        price - input.vwap < prevPrice - input.vwap
      ) {
        return true;
      }
    }
    
    return false;
  }
  
  private checkMeanRevExit(
    input: VWAPInput,
    deviation: number,
    deviationP: number
  ): { valid: boolean; reason: string } {
    if (!this.position) return { valid: false, reason: '' };
    
    // Target exit: return to VWAP
    if (Math.abs(deviation) < input.vwap * this.config.vwapProximityThreshold) {
      return { valid: true, reason: 'VWAP_TARGET_HIT' };
    }
    
    // Percentile-based exit: deviation normalized
    if (this.position.side === 'LONG' && deviationP >= 0.45) {
      return { valid: true, reason: 'DEVIATION_NORMALIZED' };
    }
    if (this.position.side === 'SHORT' && deviationP <= 0.55) {
      return { valid: true, reason: 'DEVIATION_NORMALIZED' };
    }
    
    // Time-based exit
    const timeHeld = input.nowMs - this.entryTimestamp;
    if (timeHeld > this.config.maxHoldTimeMs) {
      return { valid: true, reason: 'TIME_EXIT' };
    }
    
    // Stop loss: deviation extended further
    if (this.position.side === 'LONG') {
      if (deviation < this.position.entryDeviation * this.config.stopLossExtension) {
        return { valid: true, reason: 'STOP_LOSS' };
      }
    }
    if (this.position.side === 'SHORT') {
      if (deviation > this.position.entryDeviation * this.config.stopLossExtension) {
        return { valid: true, reason: 'STOP_LOSS' };
      }
    }
    
    // Trailing exit: deviation improved significantly
    const improvement =
      Math.abs(this.position.entryDeviation) - Math.abs(deviation);
    if (
      improvement >
      this.config.trailingTakeProfit * Math.abs(this.position.entryDeviation)
    ) {
      return { valid: true, reason: 'TRAILING_PROFIT' };
    }
    
    return { valid: false, reason: '' };
  }
  
  private updateVWAPTouchCount(price: number, vwap: number): void {
    if (Math.abs(price - vwap) < vwap * this.config.vwapProximityThreshold) {
      this.vwapTouchCount += 1;
    } else {
      this.vwapTouchCount = 0;
    }
  }
  
  getPosition(): VWAPPosition | null {
    return this.position;
  }
  
  getVWAPTouchCount(): number {
    return this.vwapTouchCount;
  }
  
  reset(): void {
    this.position = null;
    this.entryTimestamp = 0;
    this.vwapTouchCount = 0;
    this.lastPrice = 0;
    this.lastDeltaZ = 0;
  }
}
