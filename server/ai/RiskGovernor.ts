import { AIMetricsSnapshot } from './types';
import { PolicyDecision, PolicyIntent, PolicySide } from './PolicyEngine';
import { DeterministicStateSnapshot } from './StateExtractor';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const isEnabled = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

type RiskGovernorConfig = {
  slippageHardBps: number;
  volHardPercentile: number;
  reducePct: number;
  maxExposureMultiplier: number;
  blockLoserRealize: boolean;
  drawdownReduceEnabled: boolean;
  drawdownReducePct: number;
  entryTrendGuardMinTrendiness: number;
  entryTrendGuardMinScore: number;
  entryTrendGuardMinScoreGap: number;
  entryTrendGuardMinVwapGapPct: number;
  liquidationMarginHealthThreshold: number;
  liquidationProximityPctThreshold: number;
  maintenanceMarginRatioThreshold: number;
  storePath?: string;
};

export interface GovernedDecision {
  intent: PolicyIntent;
  side: PolicySide;
  confidence: number;
  riskMultiplier: number;
  sizeMultiplier: number;
  reducePct: number | null;
  maxPositionNotional: number;
  maxExposureNotional: number;
  reasons: string[];
}

export interface RiskGovernorInput {
  symbol: string;
  timestampMs: number;
  policy: PolicyDecision;
  deterministicState: DeterministicStateSnapshot;
  snapshot: AIMetricsSnapshot;
}

export class RiskGovernor {
  private readonly config: RiskGovernorConfig;

  constructor(config?: Partial<RiskGovernorConfig>) {
    this.config = {
      slippageHardBps: Math.max(1, Number(process.env.AI_SLIPPAGE_HARD_BPS || 12)),
      volHardPercentile: clamp(Number(process.env.AI_VOL_HARD_LIMIT_PCT || 97), 90, 100),
      reducePct: clamp(Number(process.env.AI_STRICT_REDUCE_PCT || 0.5), 0.1, 1),
      maxExposureMultiplier: Math.max(1, Number(process.env.AI_MAX_EXPOSURE_MULTIPLIER || 1.5)),
      blockLoserRealize: isEnabled(process.env.AI_BLOCK_LOSER_REALIZE, true),
      drawdownReduceEnabled: isEnabled(process.env.AI_DRAWDOWN_REDUCE_ENABLED, false),
      drawdownReducePct: clamp(Number(process.env.AI_DRAWDOWN_REDUCE_PCT || 8), 1, 50),
      entryTrendGuardMinTrendiness: clamp(Number(process.env.AI_ENTRY_TREND_GUARD_MIN_TRENDINESS || 0.58), 0, 1),
      entryTrendGuardMinScore: Math.max(3, Math.trunc(Number(process.env.AI_ENTRY_TREND_GUARD_MIN_SCORE || 4))),
      entryTrendGuardMinScoreGap: Math.max(1, Math.trunc(Number(process.env.AI_ENTRY_TREND_GUARD_MIN_SCORE_GAP || 2))),
      entryTrendGuardMinVwapGapPct: Math.max(0, Number(process.env.AI_ENTRY_TREND_GUARD_MIN_VWAP_GAP_PCT || 0.03)),
      liquidationMarginHealthThreshold: clamp(Number(process.env.AI_HARD_LIQ_MARGIN_HEALTH_THRESHOLD || 0.1), -1, 1),
      liquidationProximityPctThreshold: clamp(Number(process.env.AI_HARD_LIQ_PROXIMITY_PCT || 8), 0, 100),
      maintenanceMarginRatioThreshold: clamp(Number(process.env.AI_HARD_LIQ_MAINT_MARGIN_RATIO_THRESHOLD || 0.9), 0, 5),
      ...(config || {}),
    };
  }

  apply(input: RiskGovernorInput): GovernedDecision {
    const reasons: string[] = [];
    const policy = input.policy;
    const position = input.snapshot.position;
    const maxPositionNotional = Math.max(
      0,
      Number(input.snapshot.riskState.startingMarginUser || 0) * Math.max(1, Number(input.snapshot.riskState.leverage || 1))
    );
    const maxExposureNotional = maxPositionNotional * this.config.maxExposureMultiplier;
    const currentNotional = position ? Math.max(0, Number(position.qty || 0) * Math.max(0, Number(input.snapshot.market.price || 0))) : 0;

    const confidence = clamp(Number(policy.confidence || 0), 0, 1);
    const requestedMultiplier = clamp(Number(policy.riskMultiplier || 0.2), 0.01, 2.0);
    let intent: PolicyIntent = policy.intent;
    let side: PolicySide = policy.side;
    let reducePct: number | null = null;

    const slippageHard = Number(input.deterministicState.expectedSlippageBps || 0) >= this.config.slippageHardBps;
    const toxicityHard = input.deterministicState.toxicityState === 'TOXIC';
    const volHard = Number(input.deterministicState.volatilityPercentile || 0) >= this.config.volHardPercentile;
    const liquidationHard = this.isHardLiquidationRisk(input.snapshot.riskState);
    const drawdownPct = Number(input.snapshot.riskState.drawdownPct || 0);
    const drawdownLossCap = this.config.drawdownReduceEnabled
      && Number.isFinite(drawdownPct)
      && drawdownPct <= -(this.config.drawdownReducePct / 100);
    const dailyLossCap = Boolean(input.snapshot.riskState.dailyLossLock) || drawdownLossCap;

    if (slippageHard) reasons.push('SLIPPAGE_HARD_LIMIT');
    if (toxicityHard) {
      reasons.push('TOXICITY_HARD_LIMIT');
      reasons.push('TOXICITY_LIMIT');
    }
    if (volHard) reasons.push('VOL_HARD_LIMIT');
    if (liquidationHard) reasons.push('HARD_LIQUIDATION_RISK');
    if (dailyLossCap) reasons.push('DAILY_LOSS_CAP');

    if (slippageHard || toxicityHard || volHard || liquidationHard) {
      if (position) {
        intent = 'REDUCE';
        side = position.side;
        reducePct = this.config.reducePct;
      } else {
        intent = 'HOLD';
        side = null;
      }
    } else if (dailyLossCap) {
      intent = 'HOLD';
      side = null;
      reducePct = null;
    }

    if ((intent === 'ENTER' || intent === 'ADD') && input.deterministicState.executionState !== 'HEALTHY') {
      reasons.push('EXECUTION_WIDEN_BLOCK');
      intent = 'HOLD';
      side = null;
    }

    if (intent === 'ENTER') {
      if (position) {
        reasons.push('ENTER_REQUIRES_FLAT');
        intent = 'HOLD';
        side = null;
      }
      if (maxPositionNotional <= 0) {
        reasons.push('INVALID_NOTIONAL_LIMIT');
        intent = 'HOLD';
        side = null;
      }

      if (intent === 'ENTER' && side) {
        const dominantTrendSide = this.detectDominantTrendSide(input.snapshot, input.deterministicState);
        if (dominantTrendSide && dominantTrendSide !== side) {
          reasons.push('ENTRY_COUNTERTREND_GUARD');
          intent = 'HOLD';
          side = null;
        }
      }
    }

    if (intent === 'ADD') {
      if (!position) {
        reasons.push('ADD_REQUIRES_POSITION');
        intent = 'HOLD';
        side = null;
      } else {
        side = position.side;
        if (currentNotional >= maxExposureNotional) {
          reasons.push('MAX_EXPOSURE_REACHED');
          intent = 'HOLD';
          side = null;
        }
      }
    }

    if (intent === 'REDUCE') {
      if (!position) {
        reasons.push('REDUCE_REQUIRES_POSITION');
        intent = 'HOLD';
        side = null;
      } else {
        side = position.side;
        reducePct = this.config.reducePct;
        if (!liquidationHard && currentNotional <= maxPositionNotional + 1e-6) {
          reasons.push('NOTIONAL_FLOOR_PROTECT');
          intent = 'HOLD';
          side = null;
          reducePct = null;
        }
      }
    }

    if (intent === 'EXIT') {
      if (!position) {
        reasons.push('EXIT_REQUIRES_POSITION');
        intent = 'HOLD';
        side = null;
      } else {
        side = position.side;
      }
    }

    if (this.config.blockLoserRealize && position && (intent === 'REDUCE' || intent === 'EXIT')) {
      const unrealizedPnlPct = Number(position.unrealizedPnlPct || 0);
      const hardRiskActive = slippageHard || toxicityHard || volHard || liquidationHard;
      if (Number.isFinite(unrealizedPnlPct) && unrealizedPnlPct < 0 && !hardRiskActive) {
        reasons.push('LOSER_REALIZE_BLOCK');
        intent = 'HOLD';
        side = null;
        reducePct = null;
      }
    }

    let adaptiveMultiplier = requestedMultiplier;
    if (position) {
      const unrealizedPnlPct = Number(position.unrealizedPnlPct || 0);
      if (Number.isFinite(unrealizedPnlPct) && unrealizedPnlPct > 0) {
        const profitFactor = Math.min(2, 1 + (unrealizedPnlPct / 100));
        adaptiveMultiplier = Math.min(2, adaptiveMultiplier * profitFactor);
        reasons.push('WINNER_RISK_BOOST');
      } else if (Number.isFinite(unrealizedPnlPct) && unrealizedPnlPct < 0) {
        adaptiveMultiplier *= 0.5;
        reasons.push('LOSER_RISK_DAMP');
      }
    }
    adaptiveMultiplier = clamp(adaptiveMultiplier, 0.01, 2.0);

    const sizeMultiplier =
      intent === 'ENTER'
        ? 1
        : intent === 'ADD'
          ? clamp(adaptiveMultiplier, 0.01, 2.0)
          : 1;

    return {
      intent,
      side,
      confidence: Number(confidence.toFixed(6)),
      riskMultiplier: Number(clamp(adaptiveMultiplier, 0.01, 2.0).toFixed(6)),
      sizeMultiplier: Number(sizeMultiplier.toFixed(6)),
      reducePct: reducePct == null ? null : Number(clamp(reducePct, 0.1, 1).toFixed(6)),
      maxPositionNotional: Number(maxPositionNotional.toFixed(6)),
      maxExposureNotional: Number(maxExposureNotional.toFixed(6)),
      reasons: Array.from(new Set(reasons)),
    };
  }

  private isHardLiquidationRisk(riskState: AIMetricsSnapshot['riskState']): boolean {
    const marginHealth = Number(riskState.marginHealth);
    const maintenanceMarginRatio = Number(riskState.maintenanceMarginRatio);
    const liquidationProximityPct = Number(riskState.liquidationProximityPct);

    if (Number.isFinite(marginHealth) && marginHealth <= this.config.liquidationMarginHealthThreshold) {
      return true;
    }
    if (Number.isFinite(maintenanceMarginRatio) && maintenanceMarginRatio >= this.config.maintenanceMarginRatioThreshold) {
      return true;
    }
    if (Number.isFinite(liquidationProximityPct) && liquidationProximityPct <= this.config.liquidationProximityPctThreshold) {
      return true;
    }
    return false;
  }

  private detectDominantTrendSide(
    snapshot: AIMetricsSnapshot,
    state: DeterministicStateSnapshot
  ): PolicySide {
    const trendiness = Number(snapshot.regimeMetrics.trendinessScore || 0);
    if (!Number.isFinite(trendiness) || trendiness < this.config.entryTrendGuardMinTrendiness) {
      return null;
    }

    const price = Number(snapshot.market.price || 0);
    const vwap = Number(snapshot.market.vwap || 0);
    const safeVwap = Number.isFinite(vwap) && vwap > 0 ? vwap : price;
    const vwapGapRatio = safeVwap > 0 ? ((price - safeVwap) / safeVwap) : 0;
    const minVwapGapRatio = this.config.entryTrendGuardMinVwapGapPct / 100;

    let upScore = 0;
    let downScore = 0;

    if (state.cvdSlopeSign === 'UP') upScore += 1;
    if (state.cvdSlopeSign === 'DOWN') downScore += 1;

    if (state.oiDirection !== 'DOWN') upScore += 1;
    if (state.oiDirection !== 'UP') downScore += 1;

    if (vwapGapRatio >= minVwapGapRatio) upScore += 1;
    if (vwapGapRatio <= -minVwapGapRatio) downScore += 1;

    if (state.flowState === 'EXPANSION') {
      if (state.cvdSlopeSign === 'UP') upScore += 1;
      if (state.cvdSlopeSign === 'DOWN') downScore += 1;
    }

    const deltaZ = Number(snapshot.market.deltaZ || 0);
    if (deltaZ > 0.4) upScore += 1;
    if (deltaZ < -0.4) downScore += 1;

    if (upScore >= this.config.entryTrendGuardMinScore && upScore >= (downScore + this.config.entryTrendGuardMinScoreGap)) {
      return 'LONG';
    }
    if (downScore >= this.config.entryTrendGuardMinScore && downScore >= (upScore + this.config.entryTrendGuardMinScoreGap)) {
      return 'SHORT';
    }
    return null;
  }
}
