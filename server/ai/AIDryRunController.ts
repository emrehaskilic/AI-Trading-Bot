import { DecisionLog } from '../telemetry/DecisionLog';
import { StrategyAction, StrategyActionType, StrategyDecision, StrategyDecisionLog, StrategySide } from '../types/strategy';
import { DryRunSessionService } from '../dryrun/DryRunSessionService';
import { AIBiasStatus, AIDryRunConfig, AIDryRunStatus, AITrendStatus, AIMetricsSnapshot } from './types';
import { StateExtractor } from './StateExtractor';
import { PolicyDecision, PolicyEngine, PolicyLLMCaller } from './PolicyEngine';
import { RiskGovernor } from './RiskGovernor';
import { DirectionLock } from './DirectionLock';
import { AIPerformanceTracker } from './AIPerformanceTracker';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const isEnabled = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const DEFAULT_MIN_DECISION_INTERVAL_MS = 100;
const DEFAULT_MAX_DECISION_INTERVAL_MS = 1000;
const DEFAULT_DECISION_INTERVAL_MS = 250;
const DEFAULT_STATE_CONFIDENCE_THRESHOLD = clamp(Number(process.env.AI_STATE_CONFIDENCE_THRESHOLD || 0.5), 0, 1);
const DEFAULT_MAX_STARTUP_WARMUP_MS = Math.max(0, Math.trunc(Number(process.env.AI_MAX_STARTUP_WARMUP_MS || 2000)));
const DEFAULT_TREND_BREAK_CONFIRM_TICKS = Math.max(1, Math.trunc(clamp(Number(process.env.AI_TREND_BREAK_CONFIRM_TICKS || 3), 1, 12)));
const DEFAULT_MIN_REDUCE_GAP_MS = Math.max(0, Math.trunc(Number(process.env.AI_MIN_REDUCE_GAP_MS || 30_000)));
const REENTRY_COOLDOWN_BARS = Math.max(0, Math.trunc(Number(process.env.AI_REENTRY_COOLDOWN_BARS || 2)));

const TEST_LOCAL_POLICY_ENABLED = isEnabled(process.env.AI_TEST_LOCAL_POLICY, false);
const STRICT_3M_MODE_ENABLED = TEST_LOCAL_POLICY_ENABLED && isEnabled(process.env.AI_STRICT_3M_TREND_MODE, false);
const BAR_MS = Math.max(1, Math.trunc(Number(process.env.AI_BAR_INTERVAL_MS || 180_000)));
const MIN_TREND_DURATION_BARS = Math.max(1, Math.trunc(Number(process.env.AI_MIN_TREND_DURATION_BARS || 3)));
const DCA_MAX_COUNT = Math.max(0, Math.trunc(Number(process.env.AI_DCA_MAX_COUNT || 3)));
const DCA_BAR_GAP = Math.max(1, Math.trunc(Number(process.env.AI_DCA_MIN_BAR_GAP || 2)));
const PYRAMID_MAX_COUNT = Math.max(0, Math.trunc(Number(process.env.AI_PYRAMID_MAX_COUNT || 3)));
const PYRAMID_BAR_GAP = Math.max(1, Math.trunc(Number(process.env.AI_PYRAMID_MIN_BAR_GAP || 1)));
const REVERSE_ADD_BLOCK_BARS = Math.max(0, Math.trunc(Number(process.env.AI_REVERSE_ADD_BLOCK_BARS || 2)));
const MAX_EXPOSURE_MULTIPLIER = Math.max(1, Number(process.env.AI_MAX_EXPOSURE_MULTIPLIER || 2.0));
const SLIPPAGE_HARD_BPS = Math.max(1, Number(process.env.AI_SLIPPAGE_HARD_BPS || 12));
const VOL_HARD_LIMIT = clamp(Number(process.env.AI_VOL_HARD_LIMIT_PCT || 97), 90, 100);
const CRASH_EXIT_VOL_PCT = clamp(Number(process.env.AI_CRASH_EXIT_MIN_VOL_PCT || 90), 70, 100);
const CRASH_EXIT_OPPOSING_STRENGTH = clamp(Number(process.env.AI_CRASH_EXIT_MIN_OPPOSING_STRENGTH || 62), 50, 90);
const CRASH_EXIT_CONFIRM_BARS = Math.max(1, Math.trunc(Number(process.env.AI_CRASH_EXIT_CONFIRM_BARS || 2)));
const BIAS_MIN_HOLD_BARS = Math.max(1, Math.trunc(Number(process.env.AI_BIAS_MIN_HOLD_BARS || 4)));
const BIAS_ENTRY_CONFIRM_BARS = Math.max(1, Math.trunc(Number(process.env.AI_BIAS_ENTRY_CONFIRM_BARS || 2)));
const BIAS_FLIP_CONFIRM_BARS = Math.max(1, Math.trunc(Number(process.env.AI_BIAS_FLIP_CONFIRM_BARS || 3)));
const BIAS_NEUTRAL_CONFIRM_BARS = Math.max(1, Math.trunc(Number(process.env.AI_BIAS_NEUTRAL_CONFIRM_BARS || 3)));
const BIAS_MIN_SIDE_STRENGTH_PCT = clamp(Number(process.env.AI_BIAS_MIN_SIDE_STRENGTH_PCT || 60), 50, 90);

type RuntimeSymbolState = {
  firstSeenTs: number;
  lastDecisionTs: number;
  lastIntent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT' | 'NONE';
  holdStreak: number;
  holdStartTs: number;
  totalHoldMs: number;
  holdSamples: number;
  latestTrend: AITrendStatus | null;
  latestBias: AIBiasStatus | null;
  biasPendingSide: StrategySide | 'NEUTRAL' | null;
  biasPendingCount: number;
  biasPendingLastBarId: number;
  biasStableSinceBarId: number;
  crashExitPendingBarId: number;
  crashExitStreak: number;
  trendBreakStreak: number;
  lastTrendBreakBarId: number;
  lastTrendBreakTs: number;
  lastReduceTs: number;
  lastBarId: number;
  positionSide: StrategySide | null;
  lastClosedSide: StrategySide | null;
  entryBarId: number;
  lastCloseBarId: number;
  lastReversalEntryBarId: number;
  trendSide: StrategySide | null;
  trendStartBarId: number;
  lastDcaBarId: number;
  lastPyramidBarId: number;
  dcaCount: number;
  pyramidCount: number;
  lastCvdSlope: number | null;
  lastDfsPct: number;
  lastObservedUnrealizedPnlPct: number;
  activeTradeRegime: string | null;
  activeTradeDecisionTs: number;
  activeTradeConfidence: number;
  activeTradeRiskMultiplier: number;
  activeTradeReasons: string[];
  activeTradeRealizedPnlBase: number | null;
};

const HARD_RISK_REASONS = new Set<string>([
  'SLIPPAGE_HARD_LIMIT',
  'TOXICITY_HARD_LIMIT',
  'VOL_HARD_LIMIT',
  'HARD_LIQUIDATION_RISK',
  'CRASH_REVERSAL_EXIT',
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
  private readonly performanceTracker = new AIPerformanceTracker(
    Math.max(500, Math.trunc(Number(process.env.AI_PERF_TRACKER_MAX_RECORDS || 5000)))
  );

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
    llmCaller?: PolicyLLMCaller;
    bootstrapTrendBySymbol?: Record<string, { bias: 'LONG' | 'SHORT' | null; strength?: number; asOfMs?: number }>;
  }): void {
    const symbols = input.symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean);
    const apiKey = String(input.apiKey || '').trim();
    const model = String(input.model || '').trim();
    const localOnly = TEST_LOCAL_POLICY_ENABLED && Boolean(input.localOnly);

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
      llmCaller: input.llmCaller,
      testLocalPolicyEnabled: TEST_LOCAL_POLICY_ENABLED,
    });

    this.active = true;
    this.startedAtMs = Date.now();
    this.lastError = null;
    this.pending.clear();
    this.runtime.clear();
    this.performanceTracker.clear();
    this.resetTelemetry();

    this.log?.('AI_POLICY_ENGINE_START', {
      symbols,
      localOnly,
      deterministic3MMode: STRICT_3M_MODE_ENABLED,
      decisionIntervalMs: this.config.decisionIntervalMs,
      maxWarmupMs: DEFAULT_MAX_STARTUP_WARMUP_MS,
      stateConfidenceThreshold: DEFAULT_STATE_CONFIDENCE_THRESHOLD,
      trendBreakConfirmTicks: DEFAULT_TREND_BREAK_CONFIRM_TICKS,
      minTrendBars: MIN_TREND_DURATION_BARS,
    });
  }

  stop(): void {
    this.active = false;
    this.symbols.clear();
    this.pending.clear();
    this.runtime.clear();
    this.performanceTracker.clear();
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
    const performance = this.performanceTracker.getSummary(1000);
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
      performance,
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

  getBiasStatus(symbol: string, _nowMs = Date.now()): AIBiasStatus | null {
    const key = String(symbol || '').toUpperCase();
    return this.runtime.get(key)?.latestBias || null;
  }

  async onMetrics(snapshot: AIMetricsSnapshot): Promise<void> {
    if (!this.active || !this.config || !this.policyEngine) return;

    const symbol = String(snapshot.symbol || '').toUpperCase();
    if (!this.symbols.has(symbol)) return;

    const nowMs = Number(snapshot.timestampMs || Date.now());
    const barId = this.toBarId(nowMs);
    const runtime = this.getRuntime(symbol, nowMs);
    if (this.pending.has(symbol)) return;
    if (nowMs - runtime.lastDecisionTs < this.config.decisionIntervalMs) return;

    this.pending.add(symbol);
    try {
      const deterministicState = this.extractor.extract(snapshot);
      const dfsPct = this.toPercentile(snapshot.decision.dfsPercentile);
      this.syncRuntimePositionState(runtime, snapshot, barId, symbol, nowMs);
      this.syncRuntimeTrendState(runtime, deterministicState, dfsPct, barId);
      this.directionLock.observe(symbol, snapshot.position, deterministicState);
      runtime.latestTrend = this.toTrendView(deterministicState, snapshot, nowMs, runtime.latestTrend);

      const ready = this.isReadyForPolicy(snapshot);
      const confidenceEnough = deterministicState.stateConfidence >= DEFAULT_STATE_CONFIDENCE_THRESHOLD;
      const startupExecutionPass = deterministicState.executionState === 'HEALTHY';
      const startupSafetyPass =
        startupExecutionPass
        && deterministicState.toxicityState !== 'TOXIC'
        && deterministicState.volatilityPercentile < 95;
      const canEvaluatePolicy = ready && confidenceEnough;

      let policy: PolicyDecision = { intent: 'HOLD', side: null, riskMultiplier: 1, confidence: 0 };
      let policySource: 'LLM' | 'LOCAL_POLICY' = 'LLM';
      let policyError: string | null = null;
      let policyGateReason: string | null = null;
      let rawPolicyText: string | null = null;
      let parsedPolicy: PolicyDecision | null = null;

      if (canEvaluatePolicy) {
        if (STRICT_3M_MODE_ENABLED) {
          policy = this.computeStrict3MPolicy(snapshot, deterministicState, runtime, barId, dfsPct);
          policySource = 'LOCAL_POLICY';
          parsedPolicy = policy;
        } else {
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
          rawPolicyText = policyResult.rawText ? String(policyResult.rawText).slice(0, 200) : null;
          parsedPolicy = policyResult.parsedPolicy;
        }
      } else {
        if (!ready) {
          policyGateReason = 'state_not_ready';
        } else if (!confidenceEnough) {
          policyGateReason = 'state_confidence_low';
        } else {
          policyGateReason = 'policy_gate_blocked';
        }
      }

      const forceHoldReasons: string[] = [];
      if (policySource !== 'LLM') {
        forceHoldReasons.push('POLICY_NOT_FROM_LLM');
      }
      if (policyError) {
        forceHoldReasons.push('POLICY_ERROR_HOLD');
      }
      if (forceHoldReasons.length > 0) {
        policy = { intent: 'HOLD', side: null, riskMultiplier: 1, confidence: 0 };
      }
      if (policyError) {
        this.telemetry.invalidLLMResponses += 1;
      }

      let governed = this.riskGovernor.apply({
        symbol,
        timestampMs: nowMs,
        policy,
        deterministicState,
        snapshot,
      });

      if (forceHoldReasons.length > 0) {
        governed = {
          ...governed,
          intent: 'HOLD',
          side: null,
          reducePct: null,
          reasons: [...governed.reasons, ...forceHoldReasons],
        };
      }

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
        finalDecision = {
          ...governed,
          intent: 'HOLD',
          side: null,
          reducePct: null,
          reasons: [...governed.reasons, lockEvaluation.reason || 'DIRECTION_LOCK'],
        };
      }

      if (finalDecision.intent === 'ENTER' && finalDecision.side && this.isSameBarDirectionChangeBlocked(runtime, barId, finalDecision.side)) {
        finalDecision = {
          ...finalDecision,
          intent: 'HOLD',
          side: null,
          reducePct: null,
          reasons: [...finalDecision.reasons, 'SAME_BAR_DIRECTION_CHANGE_BLOCK'],
        };
      }

      if (
        snapshot.position
        && this.shouldForceCrashExit(snapshot.position.side, deterministicState, snapshot, runtime, dfsPct, barId)
      ) {
        finalDecision = {
          ...finalDecision,
          intent: 'EXIT',
          side: snapshot.position.side,
          reducePct: null,
          reasons: [...finalDecision.reasons, 'CRASH_REVERSAL_EXIT'],
        };
      }

      if (snapshot.position) {
        const hardRisk = finalDecision.reasons.some((reason) => HARD_RISK_REASONS.has(reason));
        const trendIntact = this.isTrendIntact(snapshot.position.side, deterministicState, snapshot, runtime);

        if (trendIntact) {
          runtime.trendBreakStreak = 0;
          runtime.lastTrendBreakBarId = -1;
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
          if (runtime.lastTrendBreakBarId !== barId) {
            runtime.trendBreakStreak += 1;
            runtime.lastTrendBreakBarId = barId;
            runtime.lastTrendBreakTs = nowMs;
          }
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
        runtime.lastTrendBreakBarId = -1;
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

      runtime.latestBias = this.resolveCanonicalBias(runtime, snapshot, deterministicState, finalDecision, dfsPct, nowMs, barId);

      const decision = this.buildStrategyDecision(snapshot, finalDecision, {
        deterministicState,
        policy,
        policySource,
        policyError,
        policyGateReason,
        rawPolicyText,
        parsedPolicy,
        confidenceEnough,
        startupSafetyPass,
        ready,
        lockEvaluation,
        trendBreakStreak: runtime.trendBreakStreak,
        trendBreakConfirmTicks: DEFAULT_TREND_BREAK_CONFIRM_TICKS,
      });

      const submittedOrders = this.dryRunSession.submitStrategyDecision(symbol, decision, nowMs);
      this.decisionLog?.record(decision.log);
      this.updateActiveTradeContext(
        runtime,
        symbol,
        deterministicState.regimeState,
        finalDecision,
        nowMs,
        submittedOrders.length > 0
      );

      this.updateRuntimeAfterDecision(runtime, finalDecision, nowMs, barId, submittedOrders.length > 0);
      runtime.lastCvdSlope = Number(snapshot.market.cvdSlope || 0);
      runtime.lastDfsPct = dfsPct;
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
        llmUsed: policySource === 'LLM',
        policyError,
        policyGateReason,
        policyRawText: rawPolicyText,
        parsedPolicy,
        strict3MMode: STRICT_3M_MODE_ENABLED,
      });
    } catch (e: any) {
      this.lastError = String(e?.message || 'ai_policy_failed');
      this.telemetry.invalidLLMResponses += 1;
      const runtime = this.getRuntime(symbol, nowMs);
      const previousBias = runtime.latestBias;
      const sideFromPosition = snapshot.position?.side === 'LONG' || snapshot.position?.side === 'SHORT'
        ? snapshot.position.side
        : null;
      const preservedSide = sideFromPosition || previousBias?.side || 'NEUTRAL';
      runtime.latestBias = {
        side: preservedSide,
        confidence: sideFromPosition ? 1 : Number(previousBias?.confidence || 0),
        source: sideFromPosition ? 'POSITION_LOCK' : (previousBias?.source || 'STATE'),
        lockedByPosition: Boolean(sideFromPosition),
        breakConfirm: runtime.trendBreakStreak,
        reason: 'POLICY_RUNTIME_ERROR',
        timestampMs: nowMs,
      };
      const holdDecision = this.buildStrategyDecision(snapshot, {
        intent: 'HOLD',
        side: null,
        confidence: 0,
        riskMultiplier: 1,
        sizeMultiplier: 0,
        reducePct: null,
        maxPositionNotional: 0,
        maxExposureNotional: 0,
        reasons: ['POLICY_RUNTIME_ERROR'],
      }, {
        deterministicState: this.extractor.extract(snapshot),
        policy: { intent: 'HOLD', side: null, confidence: 0, riskMultiplier: 1 },
        policySource: 'LLM',
        policyError: this.lastError,
        policyGateReason: null,
        rawPolicyText: null,
        parsedPolicy: null,
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
      maxExposureNotional: number;
      reasons: string[];
    },
      context: {
      deterministicState: ReturnType<StateExtractor['extract']>;
      policy: PolicyDecision;
      policySource: 'LLM' | 'LOCAL_POLICY';
      policyError: string | null;
      policyGateReason: string | null;
      rawPolicyText: string | null;
      parsedPolicy: PolicyDecision | null;
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
          llmUsed: context.policySource === 'LLM',
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
          strictThreeMMode: STRICT_3M_MODE_ENABLED,
          strictEntryFullNotional: true,
          maxExposureMultiplier: MAX_EXPOSURE_MULTIPLIER,
          riskMultiplier: governed.riskMultiplier,
          confidence: governed.confidence,
          governorReasons: governed.reasons,
        },
      });
    }

    if (governed.intent === 'ADD' && governed.side) {
      const strictAddPct = clamp(governed.riskMultiplier, 0.05, 0.5);
      actions.push({
        type: StrategyActionType.ADD,
        side: governed.side,
        reason: 'AI_ADD',
        expectedPrice: snapshot.market.price,
        sizeMultiplier: governed.sizeMultiplier,
        metadata: {
          aiPolicy: true,
          postOnlyRequired: true,
          strictThreeMMode: STRICT_3M_MODE_ENABLED,
          strictAddPct,
          maxExposureMultiplier: MAX_EXPOSURE_MULTIPLIER,
          riskMultiplier: governed.riskMultiplier,
          confidence: governed.confidence,
          governorReasons: governed.reasons,
        },
      });
    }

    if (governed.intent === 'REDUCE') {
      const allowReduceBelowNotional = governed.reasons.includes('HARD_LIQUIDATION_RISK');
      actions.push({
        type: StrategyActionType.REDUCE,
        reason: 'REDUCE_SOFT',
        reducePct: clamp(Number(governed.reducePct ?? 0.5), 0.1, 1),
        metadata: {
          aiPolicy: true,
          strictThreeMMode: STRICT_3M_MODE_ENABLED,
          allowReduceBelowNotional,
          maxPositionNotional: governed.maxPositionNotional,
          maxExposureNotional: governed.maxExposureNotional,
          governorReasons: governed.reasons,
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
          strictThreeMMode: STRICT_3M_MODE_ENABLED,
          governorReasons: governed.reasons,
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
          llmUsed: context.policySource === 'LLM',
          deterministicState: context.deterministicState,
          policy: context.policy,
          policySource: context.policySource,
          policyError: context.policyError,
          policyGateReason: context.policyGateReason,
          policyRawText: context.rawPolicyText,
          parsedPolicy: context.parsedPolicy,
          finalIntent: governed.intent,
          governorReasons: governed.reasons,
          ready: context.ready,
          confidenceEnough: context.confidenceEnough,
          startupSafetyPass: context.startupSafetyPass,
          directionLock: context.lockEvaluation,
          maxPositionNotional: governed.maxPositionNotional,
          maxExposureNotional: governed.maxExposureNotional,
          trendBreakStreak: context.trendBreakStreak,
          trendBreakConfirmTicks: context.trendBreakConfirmTicks,
          strict3MMode: STRICT_3M_MODE_ENABLED,
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
    const dfsPct = this.toPercentile(snapshot.decision.dfsPercentile);
    const side = this.resolveTrendSide(deterministicState, dfsPct);
    const intact = side != null && deterministicState.executionState === 'HEALTHY';

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
        latestBias: null,
        biasPendingSide: null,
        biasPendingCount: 0,
        biasPendingLastBarId: -1,
        biasStableSinceBarId: -1,
        crashExitPendingBarId: -1,
        crashExitStreak: 0,
        trendBreakStreak: 0,
        lastTrendBreakBarId: -1,
        lastTrendBreakTs: 0,
        lastReduceTs: 0,
        lastBarId: this.toBarId(nowMs),
        positionSide: null,
        lastClosedSide: null,
        entryBarId: -1,
        lastCloseBarId: -1,
        lastReversalEntryBarId: -1,
        trendSide: null,
        trendStartBarId: -1,
        lastDcaBarId: -1,
        lastPyramidBarId: -1,
        dcaCount: 0,
        pyramidCount: 0,
        lastCvdSlope: null,
        lastDfsPct: this.toPercentile(0),
        lastObservedUnrealizedPnlPct: 0,
        activeTradeRegime: null,
        activeTradeDecisionTs: 0,
        activeTradeConfidence: 0,
        activeTradeRiskMultiplier: 0.2,
        activeTradeReasons: [],
        activeTradeRealizedPnlBase: null,
      };
      this.runtime.set(symbol, state);
    }
    return state;
  }

  private updateRuntimeAfterDecision(
    runtime: RuntimeSymbolState,
    decision: {
      intent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT';
      riskMultiplier: number;
      reasons: string[];
    },
    nowMs: number,
    barId: number,
    hadOrders: boolean
  ): void {
    if (decision.intent === 'HOLD') {
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
    if (decision.intent === 'REDUCE') {
      runtime.lastReduceTs = nowMs;
    }
    if (decision.intent === 'ADD' && hadOrders) {
      if (decision.riskMultiplier >= 0.24) {
        runtime.dcaCount += 1;
        runtime.lastDcaBarId = barId;
      } else {
        runtime.pyramidCount += 1;
        runtime.lastPyramidBarId = barId;
      }
    }
    runtime.lastBarId = barId;
    runtime.lastIntent = decision.intent;
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

  private resolveCanonicalBias(
    runtime: RuntimeSymbolState,
    snapshot: AIMetricsSnapshot,
    state: ReturnType<StateExtractor['extract']>,
    finalDecision: {
      intent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT';
      side: StrategySide | null;
      confidence: number;
      reasons: string[];
    },
    dfsPct: number,
    nowMs: number,
    barId: number
  ): AIBiasStatus {
    const positionSide = snapshot.position?.side || null;

    let candidateSide: StrategySide | 'NEUTRAL' = 'NEUTRAL';
    let source: AIBiasStatus['source'] = 'STATE';
    let lockedByPosition = false;
    let reason: string | null = finalDecision.reasons[0] || null;

    if (positionSide) {
      candidateSide = positionSide;
      source = 'POSITION_LOCK';
      lockedByPosition = true;
      reason = reason || 'POSITION_LOCK';
    } else if (runtime.trendSide) {
      candidateSide = runtime.trendSide;
      source = 'TREND_LOCK';
      reason = reason || 'TREND_LOCK';
    } else if (state.directionalBias === 'LONG' || state.directionalBias === 'SHORT') {
      candidateSide = state.directionalBias;
      source = 'STATE';
      reason = reason || 'STATE_DIRECTIONAL_BIAS';
    }

    const previousSide = runtime.latestBias?.side || 'NEUTRAL';
    const previousConfidence = Number(runtime.latestBias?.confidence || 0);
    const previousSource = runtime.latestBias?.source || source;
    const previousReason = runtime.latestBias?.reason || reason;

    if (lockedByPosition) {
      runtime.biasPendingSide = null;
      runtime.biasPendingCount = 0;
      runtime.biasPendingLastBarId = -1;
      runtime.biasStableSinceBarId = barId;
      return {
        side: candidateSide,
        confidence: 1,
        source: 'POSITION_LOCK',
        lockedByPosition: true,
        breakConfirm: runtime.trendBreakStreak,
        reason: reason || 'POSITION_LOCK',
        timestampMs: nowMs,
      };
    }

    let side: StrategySide | 'NEUTRAL' = previousSide;

    if (candidateSide === previousSide) {
      runtime.biasPendingSide = null;
      runtime.biasPendingCount = 0;
      runtime.biasPendingLastBarId = -1;
      if (runtime.biasStableSinceBarId < 0) {
        runtime.biasStableSinceBarId = barId;
      }
      side = candidateSide;
    } else {
      if (runtime.biasPendingSide !== candidateSide) {
        runtime.biasPendingSide = candidateSide;
        runtime.biasPendingCount = 0;
        runtime.biasPendingLastBarId = -1;
      }

      if (runtime.biasPendingLastBarId !== barId) {
        runtime.biasPendingLastBarId = barId;
        runtime.biasPendingCount += 1;
      }

      const fromNeutral = previousSide === 'NEUTRAL' && candidateSide !== 'NEUTRAL';
      const toNeutral = candidateSide === 'NEUTRAL';
      const requiredConfirmations = fromNeutral
        ? BIAS_ENTRY_CONFIRM_BARS
        : toNeutral
          ? BIAS_NEUTRAL_CONFIRM_BARS
          : BIAS_FLIP_CONFIRM_BARS;
      const barsSinceStable = runtime.biasStableSinceBarId >= 0
        ? Math.max(0, barId - runtime.biasStableSinceBarId)
        : Number.MAX_SAFE_INTEGER;
      const holdSatisfied = lockedByPosition || previousSide === 'NEUTRAL' || barsSinceStable >= BIAS_MIN_HOLD_BARS;
      const candidateStrengthPct = candidateSide === 'NEUTRAL' ? 0 : this.sideStrengthPct(candidateSide, dfsPct);
      const strengthSatisfied = candidateSide === 'NEUTRAL' || candidateStrengthPct >= BIAS_MIN_SIDE_STRENGTH_PCT;

      if (runtime.biasPendingCount >= requiredConfirmations && holdSatisfied && strengthSatisfied) {
        side = candidateSide;
        runtime.biasPendingSide = null;
        runtime.biasPendingCount = 0;
        runtime.biasPendingLastBarId = -1;
        runtime.biasStableSinceBarId = barId;
      } else {
        side = previousSide;
      }
    }

    const baseConfidence = positionSide
      ? 1
      : source === 'TREND_LOCK'
        ? Math.max(0.58, Number(state.stateConfidence || 0))
        : Number(state.stateConfidence || 0);
    const confidence = side === candidateSide
      ? clamp(baseConfidence, 0, 1)
      : clamp(Math.max(previousConfidence, baseConfidence * 0.8), 0, 1);
    const finalSource = side === candidateSide ? source : previousSource;
    const finalReason = side === candidateSide ? reason : previousReason;

    return {
      side,
      confidence: Number(confidence.toFixed(4)),
      source: finalSource,
      lockedByPosition,
      breakConfirm: runtime.trendBreakStreak,
      reason: finalReason,
      timestampMs: nowMs,
    };
  }

  private shouldForceCrashExit(
    side: StrategySide,
    state: ReturnType<StateExtractor['extract']>,
    snapshot: AIMetricsSnapshot,
    runtime: RuntimeSymbolState,
    dfsPct: number,
    barId: number
  ): boolean {
    const signal = this.isCrashExitSignal(side, state, snapshot, runtime, dfsPct);
    if (!signal) {
      runtime.crashExitStreak = 0;
      runtime.crashExitPendingBarId = -1;
      return false;
    }
    if (runtime.crashExitPendingBarId !== barId) {
      runtime.crashExitPendingBarId = barId;
      runtime.crashExitStreak += 1;
    }
    return runtime.crashExitStreak >= CRASH_EXIT_CONFIRM_BARS;
  }

  private isCrashExitSignal(
    side: StrategySide,
    state: ReturnType<StateExtractor['extract']>,
    snapshot: AIMetricsSnapshot,
    runtime: RuntimeSymbolState,
    dfsPct: number
  ): boolean {
    const opposingStrength = side === 'LONG' ? (100 - dfsPct) : dfsPct;
    if (opposingStrength < CRASH_EXIT_OPPOSING_STRENGTH) return false;

    const opposingBias = (side === 'LONG' && state.directionalBias === 'SHORT')
      || (side === 'SHORT' && state.directionalBias === 'LONG');
    const oiOpposing = (side === 'LONG' && state.oiDirection === 'DOWN')
      || (side === 'SHORT' && state.oiDirection === 'UP');
    const cvdOpposingAccel = this.isCvdOpposingAccelerating(side, Number(snapshot.market.cvdSlope || 0), runtime.lastCvdSlope);
    const flowBreak = state.flowState === 'EXHAUSTION' || (state.flowState === 'ABSORPTION' && this.isOpposingPressure(side, state));
    const severeVol = Number(state.volatilityPercentile || 0) >= CRASH_EXIT_VOL_PCT;
    const severeExec = state.executionState === 'LOW_RESILIENCY';

    if (!(opposingBias || oiOpposing || cvdOpposingAccel)) return false;
    return severeVol || severeExec || flowBreak;
  }

  private isTrendIntact(
    side: 'LONG' | 'SHORT',
    state: ReturnType<StateExtractor['extract']>,
    snapshot: AIMetricsSnapshot,
    runtime: RuntimeSymbolState
  ): boolean {
    const dfsPct = this.toPercentile(snapshot.decision.dfsPercentile);
    const sideStrength = this.sideStrengthPct(side, dfsPct);
    if (state.regimeState !== 'TREND') return false;
    if (state.directionalBias !== side) return false;
    if (state.volatilityPercentile >= 96) return false;
    if (state.executionState !== 'HEALTHY') return false;
    if (sideStrength <= 58) return false;
    if (this.isOpposingPressure(side, state)) return false;
    if (this.isCvdOpposingAccelerating(side, Number(snapshot.market.cvdSlope || 0), runtime.lastCvdSlope)) return false;
    return true;
  }

  private computeStrict3MPolicy(
    snapshot: AIMetricsSnapshot,
    state: ReturnType<StateExtractor['extract']>,
    runtime: RuntimeSymbolState,
    barId: number,
    dfsPct: number
  ): PolicyDecision {
    const hold = (): PolicyDecision => ({
      intent: 'HOLD',
      side: null,
      riskMultiplier: 0.2,
      confidence: clamp(state.stateConfidence, 0, 1),
    });

    const position = snapshot.position;
    const trendSide = this.resolveTrendSide(state, dfsPct);
    const executionHealthyForOpen = state.executionState === 'HEALTHY';
    const maxNotional = Math.max(
      0,
      Number(snapshot.riskState.startingMarginUser || 0) * Math.max(1, Number(snapshot.riskState.leverage || 1))
    );
    const maxExposureNotional = maxNotional * MAX_EXPOSURE_MULTIPLIER;
    const currentNotional = position ? Math.max(0, Number(position.qty || 0) * Math.max(0, Number(snapshot.market.price || 0))) : 0;

    const slippageHard = Number(state.expectedSlippageBps || 0) >= SLIPPAGE_HARD_BPS;
    const toxicityHard = state.toxicityState === 'TOXIC';
    const volHard = Number(state.volatilityPercentile || 0) >= VOL_HARD_LIMIT;
    const hardLiqRisk = this.isHardLiquidationRisk(snapshot.riskState);

    if (!position) {
      if (!trendSide) return hold();
      if (!executionHealthyForOpen) return hold();
      if (REENTRY_COOLDOWN_BARS > 0 && runtime.lastCloseBarId >= 0 && (barId - runtime.lastCloseBarId) < REENTRY_COOLDOWN_BARS) {
        return hold();
      }
      if (state.flowState === 'EXHAUSTION') return hold();
      if (state.toxicityState === 'TOXIC') return hold();
      if (state.volatilityPercentile >= 95) return hold();
      if (runtime.lastCloseBarId === barId && runtime.lastClosedSide && runtime.lastClosedSide !== trendSide) return hold();
      if (runtime.lastClosedSide && runtime.lastClosedSide !== trendSide) {
        const reversalStrength = this.sideStrengthPct(trendSide, dfsPct);
        const cvdAccelTowardSide = this.isCvdAcceleratingTowardSide(
          trendSide,
          Number(snapshot.market.cvdSlope || 0),
          runtime.lastCvdSlope
        );
        if (reversalStrength <= 75 || !cvdAccelTowardSide) {
          return hold();
        }
      }
      return {
        intent: 'ENTER',
        side: trendSide,
        riskMultiplier: 1,
        confidence: clamp(state.stateConfidence, 0.55, 0.99),
      };
    }

    const side = position.side;
    if (slippageHard || toxicityHard || volHard || hardLiqRisk) {
      return {
        intent: 'REDUCE',
        side,
        riskMultiplier: 0.5,
        confidence: clamp(state.stateConfidence, 0.6, 0.99),
      };
    }

    const barsInCurrentPosition = runtime.entryBarId >= 0 ? Math.max(1, barId - runtime.entryBarId + 1) : 1;
    const reverseSignal = this.isReverseExitSignal(side, state, snapshot, runtime.lastCvdSlope, dfsPct);
    if (reverseSignal) {
      if (barsInCurrentPosition < MIN_TREND_DURATION_BARS) {
        return hold();
      }
      return {
        intent: 'EXIT',
        side,
        riskMultiplier: 0.5,
        confidence: clamp(state.stateConfidence, 0.6, 0.99),
      };
    }

    const reverseAddBlockActive = runtime.lastReversalEntryBarId >= 0 && (barId - runtime.lastReversalEntryBarId) < REVERSE_ADD_BLOCK_BARS;
    const exposureRoom = currentNotional < (maxExposureNotional - 1e-6);
    const sideStrength = this.sideStrengthPct(side, dfsPct);
    const prevStrength = this.sideStrengthPct(side, runtime.lastDfsPct);
    const cvdAligned =
      (side === 'LONG' && Number(snapshot.market.cvdSlope || 0) > 0)
      || (side === 'SHORT' && Number(snapshot.market.cvdSlope || 0) < 0);

    if (Number(position.unrealizedPnlPct || 0) < 0) {
      const directionalAligned = state.directionalBias === side;
      const canDca =
        directionalAligned
        && state.flowState === 'ABSORPTION'
        && state.derivativesState !== 'SQUEEZE_RISK'
        && state.volatilityPercentile < 92
        && !slippageHard
        && !toxicityHard
        && runtime.dcaCount < DCA_MAX_COUNT
        && (runtime.lastDcaBarId < 0 || (barId - runtime.lastDcaBarId) >= DCA_BAR_GAP)
        && exposureRoom
        && executionHealthyForOpen;

      if (canDca) {
        return {
          intent: 'ADD',
          side,
          riskMultiplier: 0.25,
          confidence: clamp(state.stateConfidence, 0.55, 0.95),
        };
      }
    }

    const pullbackAddEligible =
      state.regimeState === 'TREND'
      && state.directionalBias === side
      && state.flowState === 'ABSORPTION'
      && cvdAligned
      && state.derivativesState !== 'SQUEEZE_RISK'
      && state.volatilityPercentile < 93
      && sideStrength >= 58
      && sideStrength >= (prevStrength - 5)
      && Number(position.unrealizedPnlPct || 0) >= -0.01
      && runtime.pyramidCount < PYRAMID_MAX_COUNT
      && (runtime.lastPyramidBarId < 0 || (barId - runtime.lastPyramidBarId) >= PYRAMID_BAR_GAP)
      && !reverseAddBlockActive
      && exposureRoom
      && executionHealthyForOpen;

    if (pullbackAddEligible) {
      return {
        intent: 'ADD',
        side,
        riskMultiplier: 0.2,
        confidence: clamp(state.stateConfidence, 0.54, 0.94),
      };
    }

    if (Number(position.unrealizedPnlPct || 0) > 0) {
      const derivativesSideBuild = state.derivativesState === (side === 'LONG' ? 'LONG_BUILD' : 'SHORT_BUILD');
      const currStrength = sideStrength;
      const dfsSupportive = currStrength >= Math.max(58, prevStrength - 2);

      const canPyramid =
        state.regimeState === 'TREND'
        && state.flowState === 'EXPANSION'
        && dfsSupportive
        && cvdAligned
        && derivativesSideBuild
        && state.volatilityPercentile < 92
        && runtime.pyramidCount < PYRAMID_MAX_COUNT
        && (runtime.lastPyramidBarId < 0 || (barId - runtime.lastPyramidBarId) >= PYRAMID_BAR_GAP)
        && !reverseAddBlockActive
        && exposureRoom
        && executionHealthyForOpen;

      if (canPyramid) {
        return {
          intent: 'ADD',
          side,
          riskMultiplier: 0.2,
          confidence: clamp(state.stateConfidence, 0.55, 0.95),
        };
      }
    }

    return hold();
  }

  private resolveTrendSide(
    state: ReturnType<StateExtractor['extract']>,
    dfsPct: number
  ): StrategySide | null {
    const bias = state.directionalBias;
    if (state.regimeState !== 'TREND') return null;
    if (state.volatilityPercentile >= 96) return null;
    if (bias !== 'LONG' && bias !== 'SHORT') return null;
    const strength = this.sideStrengthPct(bias, dfsPct);
    return strength > 58 ? bias : null;
  }

  private isReverseExitSignal(
    side: StrategySide,
    state: ReturnType<StateExtractor['extract']>,
    snapshot: AIMetricsSnapshot,
    lastCvdSlope: number | null,
    dfsPct: number
  ): boolean {
    const opposingBias = (side === 'LONG' && state.directionalBias === 'SHORT') || (side === 'SHORT' && state.directionalBias === 'LONG');
    if (state.regimeState !== 'TREND' || !opposingBias) return false;
    const opposingStrength = side === 'LONG' ? (100 - dfsPct) : dfsPct;
    if (opposingStrength <= 75) return false;
    return this.isCvdOpposingAccelerating(side, Number(snapshot.market.cvdSlope || 0), lastCvdSlope);
  }

  private isOpposingPressure(side: StrategySide, state: ReturnType<StateExtractor['extract']>): boolean {
    if (side === 'LONG') {
      return state.directionalBias === 'SHORT' || (state.cvdSlopeSign === 'DOWN' && state.oiDirection === 'DOWN');
    }
    return state.directionalBias === 'LONG' || (state.cvdSlopeSign === 'UP' && state.oiDirection === 'UP');
  }

  private isCvdOpposingAccelerating(side: StrategySide, currentCvdSlope: number, lastCvdSlope: number | null): boolean {
    if (!Number.isFinite(currentCvdSlope)) return false;
    if (lastCvdSlope == null || !Number.isFinite(lastCvdSlope)) return false;
    const opposingSign = side === 'LONG' ? currentCvdSlope < 0 : currentCvdSlope > 0;
    if (!opposingSign) return false;
    const absAccelerating = Math.abs(currentCvdSlope) > (Math.abs(lastCvdSlope) * 1.1);
    const directionalAcceleration = side === 'LONG'
      ? currentCvdSlope < lastCvdSlope
      : currentCvdSlope > lastCvdSlope;
    return absAccelerating && directionalAcceleration;
  }

  private isCvdAcceleratingTowardSide(side: StrategySide, currentCvdSlope: number, lastCvdSlope: number | null): boolean {
    if (!Number.isFinite(currentCvdSlope)) return false;
    if (lastCvdSlope == null || !Number.isFinite(lastCvdSlope)) return false;
    const sideSign = side === 'LONG' ? currentCvdSlope > 0 : currentCvdSlope < 0;
    if (!sideSign) return false;
    const absAccelerating = Math.abs(currentCvdSlope) > (Math.abs(lastCvdSlope) * 1.1);
    const directionalAcceleration = side === 'LONG'
      ? currentCvdSlope > lastCvdSlope
      : currentCvdSlope < lastCvdSlope;
    return absAccelerating && directionalAcceleration;
  }

  private isHardLiquidationRisk(riskState: AIMetricsSnapshot['riskState']): boolean {
    const marginHealth = Number(riskState.marginHealth);
    const maintenanceMarginRatio = Number(riskState.maintenanceMarginRatio);
    const liquidationProximityPct = Number(riskState.liquidationProximityPct);
    if (Number.isFinite(marginHealth) && marginHealth <= 0.1) return true;
    if (Number.isFinite(maintenanceMarginRatio) && maintenanceMarginRatio >= 0.9) return true;
    if (Number.isFinite(liquidationProximityPct) && liquidationProximityPct <= 8) return true;
    return false;
  }

  private syncRuntimePositionState(
    runtime: RuntimeSymbolState,
    snapshot: AIMetricsSnapshot,
    barId: number,
    symbol: string,
    nowMs: number
  ): void {
    const currentSide = snapshot.position?.side || null;
    const prevSide = runtime.positionSide;
    if (snapshot.position) {
      runtime.lastObservedUnrealizedPnlPct = Number(snapshot.position.unrealizedPnlPct || 0);
    }
    if (prevSide === currentSide) return;

    runtime.lastBarId = barId;

    if (prevSide && !currentSide) {
      this.recordActiveTradeOutcome(symbol, runtime, prevSide, nowMs);
      runtime.lastClosedSide = prevSide;
      runtime.lastCloseBarId = barId;
      runtime.dcaCount = 0;
      runtime.pyramidCount = 0;
      runtime.lastDcaBarId = -1;
      runtime.lastPyramidBarId = -1;
      runtime.crashExitPendingBarId = -1;
      runtime.crashExitStreak = 0;
    }

    if (!prevSide && currentSide) {
      if (runtime.activeTradeRealizedPnlBase == null) {
        runtime.activeTradeRealizedPnlBase = this.dryRunSession.getSymbolRealizedPnl(symbol);
      }
      runtime.entryBarId = barId;
      runtime.dcaCount = 0;
      runtime.pyramidCount = 0;
      runtime.lastDcaBarId = -1;
      runtime.lastPyramidBarId = -1;
      runtime.crashExitPendingBarId = -1;
      runtime.crashExitStreak = 0;
      runtime.biasPendingSide = null;
      runtime.biasPendingCount = 0;
      runtime.biasPendingLastBarId = -1;
      runtime.biasStableSinceBarId = barId;
      if (runtime.lastClosedSide && runtime.lastClosedSide !== currentSide) {
        runtime.lastReversalEntryBarId = barId;
      }
    }

    if (prevSide && currentSide && prevSide !== currentSide) {
      this.recordActiveTradeOutcome(symbol, runtime, prevSide, nowMs);
      runtime.activeTradeRealizedPnlBase = this.dryRunSession.getSymbolRealizedPnl(symbol);
      runtime.entryBarId = barId;
      runtime.lastReversalEntryBarId = barId;
      runtime.dcaCount = 0;
      runtime.pyramidCount = 0;
      runtime.lastDcaBarId = -1;
      runtime.lastPyramidBarId = -1;
      runtime.crashExitPendingBarId = -1;
      runtime.crashExitStreak = 0;
      runtime.biasPendingSide = null;
      runtime.biasPendingCount = 0;
      runtime.biasPendingLastBarId = -1;
      runtime.biasStableSinceBarId = barId;
    }

    runtime.positionSide = currentSide;
  }

  private updateActiveTradeContext(
    runtime: RuntimeSymbolState,
    symbol: string,
    regime: string,
    decision: {
      intent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT';
      side: StrategySide | null;
      confidence: number;
      riskMultiplier: number;
      reasons: string[];
    },
    nowMs: number,
    hadOrders: boolean
  ): void {
    if (!hadOrders) return;
    if (decision.intent !== 'ENTER' && decision.intent !== 'ADD') return;
    if (!decision.side) return;

    runtime.activeTradeRegime = regime;
    runtime.activeTradeDecisionTs = nowMs;
    runtime.activeTradeConfidence = clamp(Number(decision.confidence || 0), 0, 1);
    runtime.activeTradeRiskMultiplier = Number(decision.riskMultiplier || 0.2);
    runtime.activeTradeReasons = Array.isArray(decision.reasons) ? [...decision.reasons] : [];
    if (runtime.activeTradeRealizedPnlBase == null) {
      runtime.activeTradeRealizedPnlBase = this.dryRunSession.getSymbolRealizedPnl(symbol);
    }
  }

  private recordActiveTradeOutcome(
    symbol: string,
    runtime: RuntimeSymbolState,
    side: StrategySide,
    nowMs: number
  ): void {
    const realizedNow = this.dryRunSession.getSymbolRealizedPnl(symbol);
    const baseline = runtime.activeTradeRealizedPnlBase;
    const pnlFromRealized =
      realizedNow != null && baseline != null
        ? Number(realizedNow) - Number(baseline)
        : null;
    const outcome = Number.isFinite(pnlFromRealized as number)
      ? Number(pnlFromRealized)
      : Number(runtime.lastObservedUnrealizedPnlPct || 0);

    this.performanceTracker.record({
      timestamp: nowMs,
      symbol,
      decision: {
        intent: 'ENTER',
        side,
        riskMultiplier: runtime.activeTradeRiskMultiplier || 0.2,
        confidence: runtime.activeTradeConfidence || 0,
        reasons: runtime.activeTradeReasons,
      },
      outcome,
      regime: runtime.activeTradeRegime || 'UNKNOWN',
    });

    runtime.activeTradeRegime = null;
    runtime.activeTradeDecisionTs = 0;
    runtime.activeTradeConfidence = 0;
    runtime.activeTradeRiskMultiplier = 0.2;
    runtime.activeTradeReasons = [];
    runtime.activeTradeRealizedPnlBase = realizedNow;
  }

  private syncRuntimeTrendState(
    runtime: RuntimeSymbolState,
    state: ReturnType<StateExtractor['extract']>,
    dfsPct: number,
    barId: number
  ): void {
    const trendSide = this.resolveTrendSide(state, dfsPct);
    if (trendSide === runtime.trendSide) return;
    runtime.trendSide = trendSide;
    runtime.trendStartBarId = trendSide ? barId : -1;
    runtime.trendBreakStreak = 0;
    runtime.lastTrendBreakBarId = -1;
    runtime.lastTrendBreakTs = 0;
  }

  private isSameBarDirectionChangeBlocked(runtime: RuntimeSymbolState, barId: number, side: StrategySide): boolean {
    return runtime.lastCloseBarId === barId && runtime.lastClosedSide != null && runtime.lastClosedSide !== side;
  }

  private toBarId(timestampMs: number): number {
    return Math.floor(Math.max(0, Number(timestampMs || 0)) / BAR_MS);
  }

  private toPercentile(value: number): number {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return n <= 1 ? clamp(n * 100, 0, 100) : clamp(n, 0, 100);
  }

  private sideStrengthPct(side: StrategySide, dfsPct: number): number {
    return side === 'LONG' ? dfsPct : (100 - dfsPct);
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
