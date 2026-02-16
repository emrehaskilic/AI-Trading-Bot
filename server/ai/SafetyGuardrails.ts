import { AIForcedAction, AIDecisionPlan, AIMetricsSnapshot, GuardrailReason } from './types';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

type GuardrailConfig = {
  maxSpreadPct: number;
  minPrintsPerSecond: number;
  minTradeCount: number;
  maxMarginUsagePct: number;
  maxMarginUsageHardPct: number;
  drawdownForceExitPct: number;
};

export type GuardrailRuntimeContext = {
  nowMs: number;
  minHoldMsRemaining: number;
  flipCooldownMsRemaining: number;
  addGapMsRemaining: number;
};

export type SafetyGuardrailResult = {
  blockedReasons: GuardrailReason[];
  blockEntry: boolean;
  blockAdd: boolean;
  blockFlip: boolean;
  forcedAction: AIForcedAction | null;
};

const DEFAULT_CONFIG: GuardrailConfig = {
  maxSpreadPct: Number(process.env.AI_MAX_SPREAD_PCT || 0.6),
  minPrintsPerSecond: Number(process.env.AI_MIN_PRINTS_PER_SEC || 0.25),
  minTradeCount: Number(process.env.AI_MIN_TRADE_COUNT || 4),
  maxMarginUsagePct: Number(process.env.AI_MAX_MARGIN_USAGE_PCT || 0.85),
  maxMarginUsageHardPct: Number(process.env.AI_MAX_MARGIN_USAGE_HARD_PCT || 0.95),
  drawdownForceExitPct: Number(process.env.AI_DRAWDOWN_FORCE_EXIT_PCT || 0.08),
};

const ENTRY_BLOCKERS: ReadonlySet<GuardrailReason> = new Set([
  'SPREAD_TOO_WIDE',
  'ACTIVITY_WEAK',
  'INTEGRITY_FAIL',
  'COOLDOWN_ACTIVE',
  'FLIP_COOLDOWN_ACTIVE',
  'MIN_HOLD_ACTIVE',
  'RISK_LOCK',
  'MARGIN_CAP',
  'GATE_NOT_PASSED',
]);

const ADD_BLOCKERS: ReadonlySet<GuardrailReason> = new Set([
  ...ENTRY_BLOCKERS,
  'ADD_GAP_ACTIVE',
]);

const FLIP_BLOCKERS: ReadonlySet<GuardrailReason> = new Set([
  'MIN_HOLD_ACTIVE',
  'FLIP_COOLDOWN_ACTIVE',
  'RISK_LOCK',
  'INTEGRITY_FAIL',
]);

export class SafetyGuardrails {
  private readonly config: GuardrailConfig;

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  evaluate(
    snapshot: AIMetricsSnapshot,
    context: GuardrailRuntimeContext,
    proposedPlan?: AIDecisionPlan | null
  ): SafetyGuardrailResult {
    const reasons = new Set<GuardrailReason>();

    for (const raw of snapshot.blockedReasons || []) {
      const mapped = this.mapBlockedReason(raw);
      if (mapped) reasons.add(mapped);
    }

    if (!snapshot.decision.gatePassed) {
      reasons.add('GATE_NOT_PASSED');
      reasons.add('INTEGRITY_FAIL');
    }

    const spreadPct = Number(snapshot.market.spreadPct ?? 0);
    if (Number.isFinite(spreadPct) && spreadPct > this.config.maxSpreadPct) {
      reasons.add('SPREAD_TOO_WIDE');
    }

    if (
      snapshot.trades.printsPerSecond < this.config.minPrintsPerSecond ||
      snapshot.trades.tradeCount < this.config.minTradeCount
    ) {
      reasons.add('ACTIVITY_WEAK');
    }

    if (context.minHoldMsRemaining > 0) {
      reasons.add('MIN_HOLD_ACTIVE');
    }

    if (context.flipCooldownMsRemaining > 0) {
      reasons.add('FLIP_COOLDOWN_ACTIVE');
    }

    if (context.addGapMsRemaining > 0) {
      reasons.add('ADD_GAP_ACTIVE');
    }

    if (
      context.minHoldMsRemaining > 0 ||
      context.flipCooldownMsRemaining > 0 ||
      context.addGapMsRemaining > 0
    ) {
      reasons.add('COOLDOWN_ACTIVE');
    }

    const equity = Math.max(0, Number(snapshot.riskState.equity || 0));
    const marginInUse = Math.max(0, Number(snapshot.riskState.marginInUse || 0));
    const marginUsagePct = equity > 0 ? marginInUse / equity : 0;
    if (marginUsagePct >= this.config.maxMarginUsagePct) {
      reasons.add('MARGIN_CAP');
    }

    const drawdownPct = Number(snapshot.riskState.drawdownPct || 0);
    if (
      snapshot.riskState.dailyLossLock ||
      drawdownPct <= -Math.abs(this.config.drawdownForceExitPct)
    ) {
      reasons.add('RISK_LOCK');
    }

    const forcedAction = this.resolveForcedAction(snapshot, reasons, marginUsagePct, proposedPlan);
    const blockedReasons = [...reasons];

    return {
      blockedReasons,
      blockEntry: blockedReasons.some((reason) => ENTRY_BLOCKERS.has(reason)),
      blockAdd: blockedReasons.some((reason) => ADD_BLOCKERS.has(reason)),
      blockFlip: blockedReasons.some((reason) => FLIP_BLOCKERS.has(reason)),
      forcedAction,
    };
  }

  private resolveForcedAction(
    snapshot: AIMetricsSnapshot,
    reasons: Set<GuardrailReason>,
    marginUsagePct: number,
    proposedPlan?: AIDecisionPlan | null
  ): AIForcedAction | null {
    if (!snapshot.position) {
      return null;
    }

    if (reasons.has('RISK_LOCK')) {
      return { intent: 'EXIT', reason: 'RISK_LOCK' };
    }

    if (reasons.has('INTEGRITY_FAIL') && reasons.has('GATE_NOT_PASSED')) {
      return { intent: 'EXIT', reason: 'INTEGRITY_FAIL' };
    }

    if (marginUsagePct >= this.config.maxMarginUsageHardPct) {
      return { intent: 'MANAGE', reducePct: 0.5, reason: 'MARGIN_CAP' };
    }

    if (proposedPlan?.intent === 'ENTER' && proposedPlan.side && snapshot.position.side !== proposedPlan.side) {
      if (reasons.has('MIN_HOLD_ACTIVE') || reasons.has('FLIP_COOLDOWN_ACTIVE')) {
        return { intent: 'HOLD', reason: 'COOLDOWN_ACTIVE' };
      }
    }

    return null;
  }

  private mapBlockedReason(raw: string): GuardrailReason | null {
    const value = String(raw || '').trim().toUpperCase();
    if (!value) return null;
    if (value.includes('SPREAD')) return 'SPREAD_TOO_WIDE';
    if (value.includes('ACTIVITY') || value.includes('PRINT')) return 'ACTIVITY_WEAK';
    if (value.includes('INTEGRITY') || value.includes('ORDERBOOK')) return 'INTEGRITY_FAIL';
    if (value.includes('COOLDOWN')) return 'COOLDOWN_ACTIVE';
    if (value.includes('DRAWDOWN') || value.includes('RISK') || value.includes('LOSS_LOCK')) return 'RISK_LOCK';
    return null;
  }
}

export const clampPlanNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return clamp(value, min, max);
};
