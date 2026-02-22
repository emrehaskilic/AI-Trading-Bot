import { DecisionLog } from '../telemetry/DecisionLog';
import { StrategyAction, StrategyActionType, StrategyDecision, StrategyDecisionLog, StrategySide } from '../types/strategy';
import { DryRunSessionService } from '../dryrun/DryRunSessionService';
import { AIDryRunConfig, AIDryRunStatus, AITrendStatus, AIMetricsSnapshot } from './types';
import { StateExtractor } from './StateExtractor';
import { PolicyDecision, PolicyEngine } from './PolicyEngine';
import { RiskGovernor } from './RiskGovernor';
import { DirectionLock } from './DirectionLock';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const DEFAULT_MIN_DECISION_INTERVAL_MS = 100;
const DEFAULT_MAX_DECISION_INTERVAL_MS = 1000;
const DEFAULT_DECISION_INTERVAL_MS = 250;
const DEFAULT_STATE_CONFIDENCE_THRESHOLD = clamp(Number(process.env.AI_STATE_CONFIDENCE_THRESHOLD || 0.58), 0, 1);
const DEFAULT_MAX_STARTUP_WARMUP_MS = Math.max(0, Math.trunc(Number(process.env.AI_MAX_STARTUP_WARMUP_MS || 2000)));
const DEFAULT_TREND_BREAK_CONFIRM_TICKS = Math.max(1, Math.trunc(clamp(Number(process.env.AI_TREND_BREAK_CONFIRM_TICKS || 3), 1, 8)));
const DEFAULT_MIN_REDUCE_GAP_MS = Math.max(0, Math.trunc(Number(process.env.AI_MIN_REDUCE_GAP_MS || 30_000)));

type RuntimeSymbolState = {
  firstSeenTs: number;
  lastDecisionTs: number;
  lastIntent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT' | 'NONE';
  holdStreak: number;
  holdStartTs: number;
  totalHoldMs: number;
  holdSamples: number;
  latestTrend: AITrendStatus | null;
  trendBreakStreak: number;
  lastTrendBreakTs: number;
  lastReduceTs: number;
};

const HARD_RISK_REASONS = new Set<string>([
  'DAILY_LOSS_CAP',
  'SLIPPAGE_HARD_LIMIT',
  'VOL_HARD_LIMIT',
  'INVALID_NOTIONAL_LIMIT',
]);

const NON_FATAL_POLICY_ERRORS = new Set<string>([
  'state_not_ready',
  'state_confidence_low',
  'startup_safety_block',
]);

export class AIDryRunController {
  private active = false;
  private symbols = new Set<string>();
  private config: AIDryRunConfig | null = null;
  private readonly runtime = new Map<string, RuntimeSymbolState>();
  private readonly pending = new Set<string>();
  private startedAtMs = 0;

  private readonly extractor = new StateExtractor();
  private policyEngine: PolicyEngine | null = null;
  private readonly riskGovernor = new RiskGovernor();
  private readonly directionLock = new DirectionLock();

  private lastError: string | null = null;
  private telemetry = {
    invalidLLMResponses: 0,
    repairCalls: 0,
    guardrailBlocks: 0,
    forcedExits: 0,
    flipsCount: 0,
    addsCount: 0,
    probeEntries: 0,
    edgeFilteredEntries: 0,
    holdOverrides: 0,
    avgHoldTimeMs: 0,
    feePct: null as number | null,
  };

  constructor(
    private readonly dryRunSession: DryRunSessionService,
    private readonly decisionLog?: DecisionLog,
    private readonly log?: (event: string, data?: Record<string, unknown>) => void
  ) {}

  start(input: {
    symbols: string[];
    apiKey?: string;
    model?: string;
    decisionIntervalMs?: number;
    temperature?: number;
    maxOutputTokens?: number;
    localOnly?: boolean;
    bootstrapTrendBySymbol?: Record<string, { bias: 'LONG' | 'SHORT' | null; strength?: number; asOfMs?: number }>;
  }): void {
    const symbols = input.symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean);
    const apiKey = String(input.apiKey || '').trim();
    const model = String(input.model || '').trim();
    const localOnly = Boolean(input.localOnly) || !apiKey || !model;

    this.symbols = new Set(symbols);
    this.config = {
      apiKey,
      model,
      decisionIntervalMs: clamp(
        Number(input.decisionIntervalMs ?? DEFAULT_DECISION_INTERVAL_MS),
        DEFAULT_MIN_DECISION_INTERVAL_MS,
        DEFAULT_MAX_DECISION_INTERVAL_MS
      ),
      temperature: Number.isFinite(input.temperature as number) ? Number(input.temperature) : 0,
      maxOutputTokens: Math.max(64, Number(input.maxOutputTokens ?? 256)),
      localOnly,
      minHoldMs: Math.max(0, Number(process.env.AI_MIN_HOLD_MS || 90_000)),
      flipCooldownMs: Math.max(0, Number(process.env.AI_FLIP_COOLDOWN_MS || 90_000)),
      minAddGapMs: Math.max(0, Number(process.env.AI_MIN_ADD_GAP_MS || 30_000)),
    };

    this.policyEngine = new PolicyEngine({
      apiKey,
      model,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
      localOnly,
    });

    this.active = true;
    this.startedAtMs = Date.now();
    this.lastError = null;
    this.pending.clear();
    this.runtime.clear();
    this.resetTelemetry();

    this.log?.('AI_POLICY_ENGINE_START', {
      symbols,
      localOnly,
      decisionIntervalMs: this.config.decisionIntervalMs,
      maxWarmupMs: DEFAULT_MAX_STARTUP_WARMUP_MS,
      stateConfidenceThreshold: DEFAULT_STATE_CONFIDENCE_THRESHOLD,
    });
  }

  stop(): void {
    this.active = false;
    this.symbols.clear();
    this.pending.clear();
    this.runtime.clear();
    this.lastError = null;
    this.log?.('AI_POLICY_ENGINE_STOP', {});
  }

  isActive(): boolean {
    return this.active;
  }

  isTrackingSymbol(symbol: string): boolean {
    return this.symbols.has(String(symbol || '').toUpperCase());
  }

  getStatus(): AIDryRunStatus {
    this.telemetry.avgHoldTimeMs = this.computeAvgHoldTime();
    return {
      active: this.active,
      model: this.config?.model || null,
      decisionIntervalMs: this.config?.decisionIntervalMs || 0,
      temperature: this.config?.temperature || 0,
      maxOutputTokens: this.config?.maxOutputTokens || 0,
      apiKeySet: Boolean(this.config?.apiKey),
      localOnly: Boolean(this.config?.localOnly),
      lastError: this.lastError,
      symbols: [...this.symbols],
      telemetry: { ...this.telemetry },
    };
  }

  getTrendStatus(symbol: string, nowMs = Date.now()): AITrendStatus | null {
    const key = String(symbol || '').toUpperCase();
    const state = this.runtime.get(key);
    if (!state?.latestTrend) return null;
    if (state.latestTrend.ageMs == null) return state.latestTrend;
    return {
      ...state.latestTrend,
      ageMs: Math.max(0, nowMs - (state.latestTrend.ageMs ? (nowMs - state.latestTrend.ageMs) : nowMs)),
    };
  }

  async onMetrics(snapshot: AIMetricsSnapshot): Promise<void> {
    if (!this.active || !this.config || !this.policyEngine) return;

    const symbol = String(snapshot.symbol || '').toUpperCase();
    if (!this.symbols.has(symbol)) return;

    const nowMs = Number(snapshot.timestampMs || Date.now());
    const runtime = this.getRuntime(symbol, nowMs);
    if (this.pending.has(symbol)) return;
    if (nowMs - runtime.lastDecisionTs < this.config.decisionIntervalMs) return;

    this.pending.add(symbol);
    try {
      const deterministicState = this.extractor.extract(snapshot);
      this.directionLock.observe(symbol, snapshot.position, deterministicState);
      runtime.latestTrend = this.toTrendView(deterministicState, snapshot, nowMs, runtime.latestTrend);

      const ready = this.isReadyForPolicy(snapshot);
      const hasOpenPosition = Boolean(snapshot.position);
      const confidenceEnough = deterministicState.stateConfidence >= DEFAULT_STATE_CONFIDENCE_THRESHOLD;
      const startupExecutionPass =
        deterministicState.executionState !== 'LOW_RESILIENCY'
        || (deterministicState.spreadBps <= 8 && deterministicState.expectedSlippageBps <= 4);
      const startupSafetyPass =
        startupExecutionPass
        && deterministicState.toxicityState !== 'TOXIC'
        && deterministicState.volatilityPercentile < 97;
      const canEvaluateForEntry = confidenceEnough && startupSafetyPass;
      const canEvaluatePolicy = ready && (hasOpenPosition || canEvaluateForEntry);

      let policy: PolicyDecision = { intent: 'HOLD', side: null, riskMultiplier: 0.2, confidence: 0 };
      let policySource: 'LLM' | 'LOCAL_POLICY' | 'HOLD_FALLBACK' = 'LOCAL_POLICY';
      let policyError: string | null = null;
      let policyGateReason: string | null = null;
      let rawPolicyText: string | null = null;

      if (canEvaluatePolicy) {
        const policyResult = await this.policyEngine.evaluate({
          symbol,
          timestampMs: nowMs,
          state: deterministicState,
          position: snapshot.position,
          directionLockBlocked: false,
          lockReason: null,
          startedAtMs: this.startedAtMs,
        });
        policy = policyResult.decision;
        policySource = policyResult.source;
        policyError = policyResult.error;
        rawPolicyText = policyResult.rawText;

        if (policyResult.source === 'HOLD_FALLBACK') {
          this.telemetry.invalidLLMResponses += 1;
        }
      } else {
        policySource = 'LOCAL_POLICY';
        policyError = null;
        if (!ready) {
          policyGateReason = 'state_not_ready';
        } else if (!confidenceEnough) {
          policyGateReason = 'state_confidence_low';
        } else if (!startupSafetyPass) {
          policyGateReason = 'startup_safety_block';
        } else {
          policyGateReason = 'policy_gate_blocked';
        }
      }

      const governed = this.riskGovernor.apply({
        symbol,
        timestampMs: nowMs,
        policy,
        deterministicState,
        snapshot,
      });

      if (governed.intent !== policy.intent) {
        this.telemetry.guardrailBlocks += 1;
      }

      const lockEvaluation = this.directionLock.evaluate(
        symbol,
        governed.intent,
        governed.side as StrategySide | null,
        snapshot.position,
        deterministicState
      );

      let finalDecision = governed;
      if (lockEvaluation.blocked) {
        this.telemetry.guardrailBlocks += 1;
        if (snapshot.position && lockEvaluation.reason === 'NO_AUTO_CLOSE_REVERSE') {
          finalDecision = {
            ...governed,
            intent: 'REDUCE',
            side: snapshot.position.side,
            reducePct: 0.25,
            reasons: [...governed.reasons, lockEvaluation.reason],
          };
        } else {
          finalDecision = {
            ...governed,
            intent: 'HOLD',
            side: null,
            reducePct: null,
            reasons: [...governed.reasons, lockEvaluation.reason || 'DIRECTION_LOCK'],
          };
        }
      }

      if (snapshot.position) {
        const hardRisk = finalDecision.reasons.some((reason) => HARD_RISK_REASONS.has(reason));
        const trendIntact = this.isTrendIntact(snapshot.position.side, deterministicState);

        if (trendIntact) {
          runtime.trendBreakStreak = 0;
          runtime.lastTrendBreakTs = 0;
          if (!hardRisk && (finalDecision.intent === 'REDUCE' || finalDecision.intent === 'EXIT')) {
            finalDecision = {
              ...finalDecision,
              intent: 'HOLD',
              side: null,
              reducePct: null,
              reasons: [...finalDecision.reasons, 'TREND_INTACT_HOLD'],
            };
          }
        } else {
          runtime.trendBreakStreak += 1;
          runtime.lastTrendBreakTs = nowMs;
          const breakConfirmed = runtime.trendBreakStreak >= DEFAULT_TREND_BREAK_CONFIRM_TICKS;
          if (!hardRisk && !breakConfirmed && (finalDecision.intent === 'REDUCE' || finalDecision.intent === 'EXIT')) {
            finalDecision = {
              ...finalDecision,
              intent: 'HOLD',
              side: null,
              reducePct: null,
              reasons: [...finalDecision.reasons, 'TREND_BREAK_AWAIT_CONFIRM'],
            };
          }
        }
      } else {
        runtime.trendBreakStreak = 0;
        runtime.lastTrendBreakTs = 0;
        runtime.lastReduceTs = 0;
      }

      if (snapshot.position && finalDecision.intent === 'REDUCE') {
        const hardRisk = finalDecision.reasons.some((reason) => HARD_RISK_REASONS.has(reason));
        if (!hardRisk && runtime.lastReduceTs > 0 && DEFAULT_MIN_REDUCE_GAP_MS > 0) {
          const elapsed = Math.max(0, nowMs - runtime.lastReduceTs);
          if (elapsed < DEFAULT_MIN_REDUCE_GAP_MS) {
            finalDecision = {
              ...finalDecision,
              intent: 'HOLD',
              side: null,
              reducePct: null,
              reasons: [...finalDecision.reasons, 'REDUCE_COOLDOWN'],
            };
          }
        }
      }

      const decision = this.buildStrategyDecision(snapshot, finalDecision, {
        deterministicState,
        policy,
        policySource,
        policyError,
        policyGateReason,
        rawPolicyText,
        confidenceEnough,
        startupSafetyPass,
        ready,
        lockEvaluation,
        trendBreakStreak: runtime.trendBreakStreak,
        trendBreakConfirmTicks: DEFAULT_TREND_BREAK_CONFIRM_TICKS,
      });

      this.dryRunSession.submitStrategyDecision(symbol, decision, nowMs);
      this.decisionLog?.record(decision.log);

      this.updateRuntimeAfterDecision(runtime, finalDecision.intent, nowMs);
      runtime.lastDecisionTs = nowMs;

      if (finalDecision.intent === 'ADD') {
        this.telemetry.addsCount += 1;
      }

      if (lockEvaluation.blocked) {
        this.telemetry.flipsCount += 1;
      }

      this.lastError = policyError && !NON_FATAL_POLICY_ERRORS.has(policyError) ? policyError : null;
      this.log?.('AI_POLICY_DECISION', {
        symbol,
        finalIntent: finalDecision.intent,
        finalSide: finalDecision.side,
        reasons: finalDecision.reasons,
        policySource,
        policyError,
        policyGateReason,
      });
    } catch (e: any) {
      this.lastError = String(e?.message || 'ai_policy_failed');
      this.telemetry.invalidLLMResponses += 1;
      const holdDecision = this.buildStrategyDecision(snapshot, {
        intent: 'HOLD',
        side: null,
        confidence: 0,
        riskMultiplier: 0.2,
        sizeMultiplier: 0,
        reducePct: null,
        maxPositionNotional: 0,
        reasons: ['POLICY_RUNTIME_ERROR'],
      }, {
        deterministicState: this.extractor.extract(snapshot),
        policy: { intent: 'HOLD', side: null, confidence: 0, riskMultiplier: 0.2 },
        policySource: 'HOLD_FALLBACK',
        policyError: this.lastError,
        policyGateReason: null,
        rawPolicyText: null,
        confidenceEnough: false,
        startupSafetyPass: false,
        ready: false,
        lockEvaluation: { blocked: false, reason: null, confirmations: 0 },
        trendBreakStreak: 0,
        trendBreakConfirmTicks: DEFAULT_TREND_BREAK_CONFIRM_TICKS,
      });
      this.dryRunSession.submitStrategyDecision(symbol, holdDecision, nowMs);
      this.decisionLog?.record(holdDecision.log);
    } finally {
      this.pending.delete(symbol);
    }
  }

  private buildStrategyDecision(
    snapshot: AIMetricsSnapshot,
    governed: {
      intent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT';
      side: 'LONG' | 'SHORT' | null;
      confidence: number;
      riskMultiplier: number;
      sizeMultiplier: number;
      reducePct: number | null;
      maxPositionNotional: number;
      reasons: string[];
    },
      context: {
      deterministicState: ReturnType<StateExtractor['extract']>;
      policy: PolicyDecision;
      policySource: 'LLM' | 'LOCAL_POLICY' | 'HOLD_FALLBACK';
      policyError: string | null;
      policyGateReason: string | null;
      rawPolicyText: string | null;
      confidenceEnough: boolean;
      startupSafetyPass: boolean;
      ready: boolean;
      lockEvaluation: { blocked: boolean; reason: string | null; confirmations: number };
      trendBreakStreak: number;
      trendBreakConfirmTicks: number;
    }
  ): StrategyDecision {
    const actions: StrategyAction[] = [];

    if (governed.intent === 'HOLD') {
      actions.push({
        type: StrategyActionType.NOOP,
        reason: 'NOOP',
        metadata: {
          aiPolicy: true,
          deterministic: context.deterministicState,
          policySource: context.policySource,
          policyError: context.policyError,
          policyGateReason: context.policyGateReason,
          policy: context.policy,
        },
      });
    }

    if (governed.intent === 'ENTER' && governed.side) {
      actions.push({
        type: StrategyActionType.ENTRY,
        side: governed.side,
        reason: 'ENTRY_TR',
        expectedPrice: snapshot.market.price,
        sizeMultiplier: governed.sizeMultiplier,
        metadata: {
          aiPolicy: true,
          postOnlyRequired: true,
          riskMultiplier: governed.riskMultiplier,
          confidence: governed.confidence,
        },
      });
    }

    if (governed.intent === 'ADD' && governed.side) {
      actions.push({
        type: StrategyActionType.ADD,
        side: governed.side,
        reason: 'AI_ADD',
        expectedPrice: snapshot.market.price,
        sizeMultiplier: governed.sizeMultiplier,
        metadata: {
          aiPolicy: true,
          postOnlyRequired: true,
          riskMultiplier: governed.riskMultiplier,
          confidence: governed.confidence,
        },
      });
    }

    if (governed.intent === 'REDUCE') {
      actions.push({
        type: StrategyActionType.REDUCE,
        reason: 'REDUCE_SOFT',
        reducePct: clamp(Number(governed.reducePct ?? 0.35), 0.1, 1),
        metadata: {
          aiPolicy: true,
          confidence: governed.confidence,
        },
      });
    }

    if (governed.intent === 'EXIT') {
      actions.push({
        type: StrategyActionType.EXIT,
        reason: 'EXIT_HARD',
        metadata: {
          aiPolicy: true,
          confidence: governed.confidence,
        },
      });
    }

    if (actions.length === 0) {
      actions.push({ type: StrategyActionType.NOOP, reason: 'NOOP', metadata: { aiPolicy: true } });
    }

    const reasons = actions.map((a) => a.reason);
    const log: StrategyDecisionLog = {
      timestampMs: snapshot.timestampMs,
      symbol: snapshot.symbol,
      regime: snapshot.decision.regime,
      gate: {
        passed: snapshot.decision.gatePassed,
        reason: null,
        details: {
          aiPolicy: true,
          deterministicState: context.deterministicState,
          policy: context.policy,
          policySource: context.policySource,
          policyError: context.policyError,
          policyGateReason: context.policyGateReason,
          policyRawText: context.rawPolicyText,
          governorReasons: governed.reasons,
          ready: context.ready,
          confidenceEnough: context.confidenceEnough,
          startupSafetyPass: context.startupSafetyPass,
          directionLock: context.lockEvaluation,
          maxPositionNotional: governed.maxPositionNotional,
          trendBreakStreak: context.trendBreakStreak,
          trendBreakConfirmTicks: context.trendBreakConfirmTicks,
        },
      },
      dfs: snapshot.decision.dfs,
      dfsPercentile: snapshot.decision.dfsPercentile,
      volLevel: snapshot.decision.volLevel,
      thresholds: snapshot.decision.thresholds,
      reasons,
      actions,
      stats: {
        aiDecision: 1,
        aiConfidence: Number(governed.confidence.toFixed(4)),
        riskMultiplier: Number(governed.riskMultiplier.toFixed(4)),
        stateConfidence: Number(context.deterministicState.stateConfidence.toFixed(4)),
        volatilityPct: Number(context.deterministicState.volatilityPercentile.toFixed(4)),
      },
    };

    return {
      symbol: snapshot.symbol,
      timestampMs: snapshot.timestampMs,
      regime: snapshot.decision.regime,
      dfs: snapshot.decision.dfs,
      dfsPercentile: snapshot.decision.dfsPercentile,
      volLevel: snapshot.decision.volLevel,
      gatePassed: snapshot.decision.gatePassed,
      actions,
      reasons,
      log,
    };
  }

  private toTrendView(
    deterministicState: ReturnType<StateExtractor['extract']>,
    snapshot: AIMetricsSnapshot,
    nowMs: number,
    previous: AITrendStatus | null
  ): AITrendStatus {
    const side = deterministicState.directionalBias === 'NEUTRAL' ? null : deterministicState.directionalBias;
    const intact =
      deterministicState.regimeState === 'TREND'
      && deterministicState.toxicityState !== 'TOXIC'
      && deterministicState.executionState !== 'LOW_RESILIENCY';

    let ageMs: number | null = null;
    if (side && previous?.side === side && previous.ageMs != null) {
      ageMs = Math.max(0, previous.ageMs + Math.max(0, nowMs - snapshot.timestampMs));
    } else if (side) {
      ageMs = 0;
    }

    return {
      side,
      score: clamp(Number(deterministicState.stateConfidence || 0), 0, 1),
      intact,
      ageMs,
      breakConfirm: 0,
      source: 'runtime',
    };
  }

  private isReadyForPolicy(snapshot: AIMetricsSnapshot): boolean {
    const hasOrderbook = Number(snapshot.market.price || 0) > 0 && Number.isFinite(snapshot.market.spreadPct as number);
    const hasOi = Number.isFinite(snapshot.openInterest.oiChangePct as number);
    const hasVolatility = Number.isFinite(snapshot.volatility as number) && Number(snapshot.volatility || 0) >= 0;
    return hasOrderbook && hasOi && hasVolatility;
  }

  private getRuntime(symbol: string, nowMs: number): RuntimeSymbolState {
    let state = this.runtime.get(symbol);
    if (!state) {
      state = {
        firstSeenTs: nowMs,
        lastDecisionTs: 0,
        lastIntent: 'NONE',
        holdStreak: 0,
        holdStartTs: 0,
        totalHoldMs: 0,
        holdSamples: 0,
        latestTrend: null,
        trendBreakStreak: 0,
        lastTrendBreakTs: 0,
        lastReduceTs: 0,
      };
      this.runtime.set(symbol, state);
    }
    return state;
  }

  private updateRuntimeAfterDecision(
    runtime: RuntimeSymbolState,
    intent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT',
    nowMs: number
  ): void {
    if (intent === 'HOLD') {
      runtime.holdStreak += 1;
      if (runtime.holdStartTs <= 0) runtime.holdStartTs = nowMs;
    } else {
      runtime.holdStreak = 0;
      if (runtime.holdStartTs > 0) {
        runtime.totalHoldMs += Math.max(0, nowMs - runtime.holdStartTs);
        runtime.holdSamples += 1;
        runtime.holdStartTs = 0;
      }
    }
    if (intent === 'REDUCE') {
      runtime.lastReduceTs = nowMs;
    }
    runtime.lastIntent = intent;
  }

  private computeAvgHoldTime(): number {
    let total = 0;
    let count = 0;
    for (const runtime of this.runtime.values()) {
      total += runtime.totalHoldMs;
      count += runtime.holdSamples;
    }
    return count > 0 ? Number((total / count).toFixed(2)) : 0;
  }

  private isTrendIntact(
    side: 'LONG' | 'SHORT',
    state: ReturnType<StateExtractor['extract']>
  ): boolean {
    const opposingBias =
      (side === 'LONG' && state.directionalBias === 'SHORT')
      || (side === 'SHORT' && state.directionalBias === 'LONG');

    const cvdOpposing =
      (side === 'LONG' && state.cvdSlopeSign === 'DOWN')
      || (side === 'SHORT' && state.cvdSlopeSign === 'UP');

    const oiOpposing =
      (side === 'LONG' && state.oiDirection === 'DOWN')
      || (side === 'SHORT' && state.oiDirection === 'UP');

    if (opposingBias) return false;
    if (cvdOpposing && oiOpposing) return false;
    if (state.regimeState === 'VOL_EXPANSION') return false;
    if (state.executionState === 'LOW_RESILIENCY') return false;
    if (state.flowState === 'EXHAUSTION') return false;
    return true;
  }

  private resetTelemetry(): void {
    this.telemetry.invalidLLMResponses = 0;
    this.telemetry.repairCalls = 0;
    this.telemetry.guardrailBlocks = 0;
    this.telemetry.forcedExits = 0;
    this.telemetry.flipsCount = 0;
    this.telemetry.addsCount = 0;
    this.telemetry.probeEntries = 0;
    this.telemetry.edgeFilteredEntries = 0;
    this.telemetry.holdOverrides = 0;
    this.telemetry.avgHoldTimeMs = 0;
    this.telemetry.feePct = null;
  }
}
