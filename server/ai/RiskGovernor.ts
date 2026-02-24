import { AIMetricsSnapshot } from './types';
import { PolicyDecision, PolicyIntent, PolicySide } from './PolicyEngine';
import { DeterministicStateSnapshot } from './StateExtractor';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

type RiskGovernorConfig = {
  slippageHardBps: number;
  volHardPercentile: number;
  reducePct: number;
  maxExposureMultiplier: number;
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

    if (slippageHard) reasons.push('SLIPPAGE_HARD_LIMIT');
    if (toxicityHard) reasons.push('TOXICITY_HARD_LIMIT');
    if (volHard) reasons.push('VOL_HARD_LIMIT');
    if (liquidationHard) reasons.push('HARD_LIQUIDATION_RISK');

    if (slippageHard || toxicityHard || volHard || liquidationHard) {
      if (position) {
        intent = 'REDUCE';
        side = position.side;
        reducePct = this.config.reducePct;
      } else {
        intent = 'HOLD';
        side = null;
      }
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
}
