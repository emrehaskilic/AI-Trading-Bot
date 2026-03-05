/**
 * Regime-Switching Hybrid Strategy
 * 
 * Dynamically adapts trading approach based on detected market regime:
 * - TR (Trending): Trend following with momentum
 * - MR (Mean Reverting): Mean reversion to VWAP
 * - EV (Event-Driven): Burst detection and quick profits
 */

import { NormalizationStore } from './Normalization';
import { DirectionalFlowScore } from './DirectionalFlowScore';
import { RegimeSelector, RegimeOutput } from './RegimeSelector';
import { InstitutionalRiskEngine } from '../risk/InstitutionalRiskEngine';

// Sub-strategy configurations
export interface TrendFollowingConfig {
  trEntryThresholdLong: number;
  trEntryThresholdShort: number;
  trExitThresholdLong: number;
  trExitThresholdShort: number;
  trMaxHoldTime: number;
  vwapBreakThreshold: number;
}

export interface MeanReversionConfig {
  mrDeviationThreshold: number;
  mrMaxHoldTime: number;
  vwapProximityThreshold: number;
}

export interface EventDrivenConfig {
  evEntryThresholdLong: number;
  evEntryThresholdShort: number;
  evBurstCount: number;
  evVolThreshold: number;
  evQuickExitTime: number;
  evMaxHoldTime: number;
  evVolCollapseThreshold: number;
}

export interface RegimeHybridConfig {
  // Sub-strategy configs
  trend: TrendFollowingConfig;
  meanRev: MeanReversionConfig;
  event: EventDrivenConfig;
  
  // General
  rollingWindowMin: number;
  regimeLockTRMR: number;
  regimeLockEV: number;
  allowRegimeChangeExit: boolean;
}

export const defaultRegimeHybridConfig: RegimeHybridConfig = {
  trend: {
    trEntryThresholdLong: 0.80,
    trEntryThresholdShort: 0.20,
    trExitThresholdLong: 0.40,
    trExitThresholdShort: 0.60,
    trMaxHoldTime: 600000, // 10 minutes
    vwapBreakThreshold: 0.003,
  },
  meanRev: {
    mrDeviationThreshold: 0.75,
    mrMaxHoldTime: 300000, // 5 minutes
    vwapProximityThreshold: 0.002,
  },
  event: {
    evEntryThresholdLong: 0.92,
    evEntryThresholdShort: 0.08,
    evBurstCount: 3,
    evVolThreshold: 0.80,
    evQuickExitTime: 30000, // 30 seconds
    evMaxHoldTime: 120000,  // 2 minutes
    evVolCollapseThreshold: 0.50,
  },
  rollingWindowMin: 10,
  regimeLockTRMR: 3,
  regimeLockEV: 2,
  allowRegimeChangeExit: false,
};

export interface HybridInput {
  nowMs: number;
  symbol: string;
  price: number;
  vwap: number;
  deltaZ: number;
  cvdSlope: number;
  obiDeep: number;
  obiWeighted: number;
  previousDeltaZ: number;
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

export interface HybridPosition {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTimestamp: number;
  entryRegime: 'TR' | 'MR' | 'EV';
}

export interface HybridDecision {
  action: 'ENTRY' | 'EXIT' | 'NOOP';
  side?: 'LONG' | 'SHORT';
  reason: string;
  metadata?: Record<string, unknown>;
}

export class RegimeSwitchingHybridStrategy {
  private readonly config: RegimeHybridConfig;
  private readonly norm: NormalizationStore;
  private readonly dfs: DirectionalFlowScore;
  private readonly regimeSelector: RegimeSelector;
  private readonly riskEngine: InstitutionalRiskEngine;
  
  // State tracking
  private position: HybridPosition | null = null;
  private currentRegime: 'TR' | 'MR' | 'EV' = 'MR';
  private entryTimestamp = 0;
  
  constructor(
    riskEngine: InstitutionalRiskEngine,
    config?: Partial<RegimeHybridConfig>
  ) {
    this.config = { ...defaultRegimeHybridConfig, ...(config || {}) };
    const windowMs = Math.max(60_000, this.config.rollingWindowMin * 60_000);
    this.norm = new NormalizationStore(windowMs, 64);
    this.dfs = new DirectionalFlowScore(this.norm);
    this.regimeSelector = new RegimeSelector(
      this.norm,
      this.config.regimeLockTRMR,
      this.config.regimeLockEV
    );
    this.riskEngine = riskEngine;
  }
  
  evaluate(input: HybridInput): HybridDecision {
    // Compute DFS
    const dfsOut = this.dfs.compute({
      deltaZ: input.deltaZ,
      cvdSlope: input.cvdSlope,
      obiWeighted: input.obiWeighted,
      obiDeep: input.obiDeep,
      sweepStrength: input.deltaZ,
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
    
    // Update regime selector
    const regimeOut = this.regimeSelector.update({
      nowMs: input.nowMs,
      price: input.price,
      vwap: input.vwap,
      dfsPercentile: dfsOut.dfsPercentile,
      deltaZ: input.deltaZ,
      printsPerSecond: input.printsPerSecond,
      burstCount: input.consecutiveBurst.count,
      volatility: input.volatility,
    });
    
    this.currentRegime = regimeOut.regime;
    
    // Route to appropriate sub-strategy
    if (!this.position) {
      const entrySignal = this.routeEntry(input, dfsOut, regimeOut);
      
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
          entryRegime: this.currentRegime,
        };
        this.entryTimestamp = input.nowMs;
        
        return {
          action: 'ENTRY',
          side: entrySignal.side!,
          reason: `ENTRY_${this.currentRegime}`,
          metadata: {
            regime: this.currentRegime,
            dfs: dfsOut.dfs,
            dfsPercentile: dfsOut.dfsPercentile,
            volLevel: regimeOut.volLevel,
          },
        };
      }
    } else {
      // Check for regime change exit (optional)
      if (this.config.allowRegimeChangeExit) {
        const regimeChanged = this.checkRegimeChangeExit();
        if (regimeChanged) {
          const side = this.position.side;
          this.position = null;
          return {
            action: 'EXIT',
            side,
            reason: 'REGIME_CHANGE',
            metadata: {
              newRegime: this.currentRegime,
            },
          };
        }
      }
      
      // Route to appropriate exit logic based on entry regime
      const exitSignal = this.routeExit(input, dfsOut, regimeOut);
      
      if (exitSignal.valid) {
        const side = this.position.side;
        this.position = null;
        
        return {
          action: 'EXIT',
          side,
          reason: exitSignal.reason,
          metadata: {
            exitRegime: this.currentRegime,
            dfs: dfsOut.dfs,
            dfsPercentile: dfsOut.dfsPercentile,
          },
        };
      }
    }
    
    return { action: 'NOOP', reason: 'NO_SIGNAL' };
  }
  
  private routeEntry(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    regimeOut: RegimeOutput
  ): { valid: boolean; side?: 'LONG' | 'SHORT' } {
    switch (this.currentRegime) {
      case 'TR':
        return this.checkTrendEntry(input, dfsOut, regimeOut);
      case 'MR':
        return this.checkMeanRevEntry(input, dfsOut, regimeOut);
      case 'EV':
        return this.checkEventEntry(input, dfsOut, regimeOut);
      default:
        return { valid: false };
    }
  }
  
  private routeExit(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    regimeOut: RegimeOutput
  ): { valid: boolean; reason: string } {
    if (!this.position) return { valid: false, reason: '' };
    
    // Route based on entry regime
    switch (this.position.entryRegime) {
      case 'TR':
        return this.checkTrendExit(input, dfsOut, regimeOut);
      case 'MR':
        return this.checkMeanRevExit(input, dfsOut, regimeOut);
      case 'EV':
        return this.checkEventExit(input, dfsOut, regimeOut);
      default:
        return { valid: false, reason: '' };
    }
  }
  
  // =====================================================
  // TREND FOLLOWING (TR) LOGIC
  // =====================================================
  private checkTrendEntry(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    _regimeOut: RegimeOutput
  ): { valid: boolean; side?: 'LONG' | 'SHORT' } {
    const cfg = this.config.trend;
    
    // Long entry
    if (dfsOut.dfsPercentile >= cfg.trEntryThresholdLong) {
      if (input.price >= input.vwap) {
        if (input.cvdSlope > 0) {
          if (input.obiDeep > 0) {
            return { valid: true, side: 'LONG' };
          }
        }
      }
    }
    
    // Short entry
    if (dfsOut.dfsPercentile <= cfg.trEntryThresholdShort) {
      if (input.price <= input.vwap) {
        if (input.cvdSlope < 0) {
          if (input.obiDeep < 0) {
            return { valid: true, side: 'SHORT' };
          }
        }
      }
    }
    
    return { valid: false };
  }
  
  private checkTrendExit(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    _regimeOut: RegimeOutput
  ): { valid: boolean; reason: string } {
    if (!this.position) return { valid: false, reason: '' };
    const cfg = this.config.trend;
    const timeHeld = input.nowMs - this.entryTimestamp;
    
    if (this.position.side === 'LONG') {
      if (dfsOut.dfsPercentile <= cfg.trExitThresholdLong) {
        return { valid: true, reason: 'TREND_REVERSAL' };
      }
      if (input.price < input.vwap * (1 - cfg.vwapBreakThreshold)) {
        return { valid: true, reason: 'VWAP_BREAK' };
      }
    }
    
    if (this.position.side === 'SHORT') {
      if (dfsOut.dfsPercentile >= cfg.trExitThresholdShort) {
        return { valid: true, reason: 'TREND_REVERSAL' };
      }
      if (input.price > input.vwap * (1 + cfg.vwapBreakThreshold)) {
        return { valid: true, reason: 'VWAP_BREAK' };
      }
    }
    
    if (timeHeld > cfg.trMaxHoldTime) {
      return { valid: true, reason: 'TIME_EXIT' };
    }
    
    return { valid: false, reason: '' };
  }
  
  // =====================================================
  // MEAN REVERSION (MR) LOGIC
  // =====================================================
  private checkMeanRevEntry(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    _regimeOut: RegimeOutput
  ): { valid: boolean; side?: 'LONG' | 'SHORT' } {
    const cfg = this.config.meanRev;
    
    // Calculate deviation from VWAP
    const deviation = Math.abs(input.price - input.vwap);
    this.norm.update('dev', deviation, input.nowMs);
    const devP = this.norm.percentile('dev', deviation);
    
    if (devP < cfg.mrDeviationThreshold) {
      return { valid: false };
    }
    
    // Long entry: price below VWAP, reverting up
    if (input.price < input.vwap) {
      if (dfsOut.dfsPercentile >= 0.55) {
        if (input.deltaZ > input.previousDeltaZ) {
          if (input.absorption?.side === 'buy') {
            return { valid: true, side: 'LONG' };
          }
        }
      }
    }
    
    // Short entry: price above VWAP, reverting down
    if (input.price > input.vwap) {
      if (dfsOut.dfsPercentile <= 0.45) {
        if (input.deltaZ < input.previousDeltaZ) {
          if (input.absorption?.side === 'sell') {
            return { valid: true, side: 'SHORT' };
          }
        }
      }
    }
    
    return { valid: false };
  }
  
  private checkMeanRevExit(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    _regimeOut: RegimeOutput
  ): { valid: boolean; reason: string } {
    if (!this.position) return { valid: false, reason: '' };
    const cfg = this.config.meanRev;
    const timeHeld = input.nowMs - this.entryTimestamp;
    
    if (this.position.side === 'LONG') {
      if (input.price >= input.vwap * (1 - cfg.vwapProximityThreshold)) {
        return { valid: true, reason: 'VWAP_REACHED' };
      }
      if (dfsOut.dfsPercentile <= 0.30) {
        return { valid: true, reason: 'WEAKNESS' };
      }
    }
    
    if (this.position.side === 'SHORT') {
      if (input.price <= input.vwap * (1 + cfg.vwapProximityThreshold)) {
        return { valid: true, reason: 'VWAP_REACHED' };
      }
      if (dfsOut.dfsPercentile >= 0.70) {
        return { valid: true, reason: 'STRENGTH' };
      }
    }
    
    if (timeHeld > cfg.mrMaxHoldTime) {
      return { valid: true, reason: 'TIME_EXIT' };
    }
    
    return { valid: false, reason: '' };
  }
  
  // =====================================================
  // EVENT-DRIVEN (EV) LOGIC
  // =====================================================
  private checkEventEntry(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    regimeOut: RegimeOutput
  ): { valid: boolean; side?: 'LONG' | 'SHORT' } {
    const cfg = this.config.event;
    
    // Long entry
    if (dfsOut.dfsPercentile >= cfg.evEntryThresholdLong) {
      if (input.consecutiveBurst.side === 'buy') {
        if (input.consecutiveBurst.count >= cfg.evBurstCount) {
          if (regimeOut.volLevel > cfg.evVolThreshold) {
            return { valid: true, side: 'LONG' };
          }
        }
      }
    }
    
    // Short entry
    if (dfsOut.dfsPercentile <= cfg.evEntryThresholdShort) {
      if (input.consecutiveBurst.side === 'sell') {
        if (input.consecutiveBurst.count >= cfg.evBurstCount) {
          if (regimeOut.volLevel > cfg.evVolThreshold) {
            return { valid: true, side: 'SHORT' };
          }
        }
      }
    }
    
    return { valid: false };
  }
  
  private checkEventExit(
    input: HybridInput,
    dfsOut: { dfs: number; dfsPercentile: number },
    regimeOut: RegimeOutput
  ): { valid: boolean; reason: string } {
    if (!this.position) return { valid: false, reason: '' };
    const cfg = this.config.event;
    const timeInTrade = input.nowMs - this.entryTimestamp;
    
    // Quick profit taking
    if (timeInTrade < cfg.evQuickExitTime) {
      if (this.position.side === 'LONG' && dfsOut.dfsPercentile <= 0.70) {
        return { valid: true, reason: 'QUICK_PROFIT' };
      }
      if (this.position.side === 'SHORT' && dfsOut.dfsPercentile >= 0.30) {
        return { valid: true, reason: 'QUICK_PROFIT' };
      }
    }
    
    // Time-based exit for events
    if (timeInTrade > cfg.evMaxHoldTime) {
      return { valid: true, reason: 'EVENT_TIMEOUT' };
    }
    
    // Volatility collapse exit
    if (regimeOut.volLevel < cfg.evVolCollapseThreshold) {
      return { valid: true, reason: 'VOL_COLLAPSE' };
    }
    
    return { valid: false, reason: '' };
  }
  
  private checkRegimeChangeExit(): boolean {
    if (!this.position) return false;
    
    // Exit if regime changed from entry regime
    return this.position.entryRegime !== this.currentRegime;
  }
  
  getPosition(): HybridPosition | null {
    return this.position;
  }
  
  getCurrentRegime(): 'TR' | 'MR' | 'EV' {
    return this.currentRegime;
  }
  
  reset(): void {
    this.position = null;
    this.currentRegime = 'MR';
    this.entryTimestamp = 0;
  }
}
