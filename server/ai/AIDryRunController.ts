import { createHash } from 'crypto';
import { DecisionLog } from '../telemetry/DecisionLog';
import { StrategyAction, StrategyActionType, StrategyDecision, StrategyDecisionLog, StrategySide } from '../types/strategy';
import { DryRunSessionService } from '../dryrun/DryRunSessionService';
import { generateContent } from './GoogleAIClient';
import { GuardrailRuntimeContext, SafetyGuardrails, clampPlanNumber } from './SafetyGuardrails';
import {
  AIAddRule,
  AIDecisionIntent,
  AIDecisionPlan,
  AIEntryStyle,
  AIExplanationTag,
  AIForcedAction,
  AIDryRunConfig,
  AIDryRunStatus,
  AIMetricsSnapshot,
  AIUrgency,
  GuardrailReason,
} from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const DEFAULT_MIN_HOLD_MS = Math.max(5_000, Number(process.env.AI_MIN_HOLD_MS || 60_000));
const DEFAULT_FLIP_COOLDOWN_MS = Math.max(2_000, Number(process.env.AI_FLIP_COOLDOWN_MS || 45_000));
const DEFAULT_MIN_ADD_GAP_MS = Math.max(1_000, Number(process.env.AI_MIN_ADD_GAP_MS || 20_000));
const DEFAULT_MAX_DECISION_INTERVAL_MS = 2_500;
const DEFAULT_MIN_DECISION_INTERVAL_MS = 500;
const DEFAULT_ADD_MARGIN_USAGE_CAP = clamp(Number(process.env.AI_ADD_MARGIN_USAGE_CAP || 0.85), 0.3, 0.98);
const DEFAULT_ADD_MIN_UPNL_PCT = clamp(Number(process.env.AI_ADD_MIN_UPNL_PCT || 0.0015), 0, 0.05);
const DEFAULT_FALLBACK_MODELS = String(process.env.AI_FALLBACK_MODELS || 'gemini-2.5-flash-lite,gemini-2.0-flash')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const PLAN_VERSION = 1 as const;

const normalizeSide = (raw?: string | null): StrategySide | null => {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return null;
  if (value === 'LONG' || value === 'BUY') return 'LONG';
  if (value === 'SHORT' || value === 'SELL') return 'SHORT';
  return null;
};

const normalizeJsonCandidate = (value: string): string => {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '"')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
};

const ALLOWED_TAGS: ReadonlySet<AIExplanationTag> = new Set([
  'OBI_UP',
  'OBI_DOWN',
  'DELTA_BURST',
  'CVD_TREND_UP',
  'CVD_TREND_DOWN',
  'VWAP_RECLAIM',
  'VWAP_REJECT',
  'OI_EXPANSION',
  'OI_CONTRACTION',
  'ABSORPTION_BUY',
  'ABSORPTION_SELL',
  'SPREAD_WIDE',
  'ACTIVITY_WEAK',
  'RISK_LOCK',
  'COOLDOWN_ACTIVE',
  'INTEGRITY_FAIL',
  'TREND_INTACT',
  'TREND_BROKEN',
]);

type RuntimeState = {
  lastAction: AIDecisionIntent | 'NONE';
  lastActionSide: StrategySide | null;
  lastEntryTs: number;
  lastAddTs: number;
  lastFlipTs: number;
  lastExitSide: StrategySide | null;
  holdStartTs: number;
};

const toTag = (raw: unknown): AIExplanationTag | null => {
  const value = String(raw || '').trim().toUpperCase() as AIExplanationTag;
  return ALLOWED_TAGS.has(value) ? value : null;
};

export class AIDryRunController {
  private active = false;
  private config: AIDryRunConfig | null = null;
  private symbols = new Set<string>();
  private readonly lastDecisionTs = new Map<string, number>();
  private readonly pending = new Set<string>();
  private readonly holdStreak = new Map<string, number>();
  private readonly runtime = new Map<string, RuntimeState>();
  private readonly guardrails = new SafetyGuardrails();
  private nonceSeq = 0;
  private holdDurationTotalMs = 0;
  private holdDurationSamples = 0;
  private readonly telemetry = {
    invalidLLMResponses: 0,
    repairCalls: 0,
    guardrailBlocks: 0,
    forcedExits: 0,
    flipsCount: 0,
    addsCount: 0,
    avgHoldTimeMs: 0,
    feePct: null as number | null,
  };
  private lastError: string | null = null;

  constructor(
    private readonly dryRunSession: DryRunSessionService,
    private readonly decisionLog?: DecisionLog,
    private readonly log?: (event: string, data?: Record<string, unknown>) => void
  ) { }

  start(input: {
    symbols: string[];
    apiKey?: string;
    model?: string;
    decisionIntervalMs?: number;
    temperature?: number;
    maxOutputTokens?: number;
    localOnly?: boolean;
  }): void {
    const symbols = input.symbols.map((s) => s.toUpperCase()).filter(Boolean);
    const apiKey = String(input.apiKey || '').trim();
    const model = String(input.model || '').trim();
    const localOnly = Boolean(input.localOnly) || !apiKey || !model;
    this.symbols = new Set(symbols);
    this.config = {
      apiKey,
      model,
      decisionIntervalMs: clamp(Number(input.decisionIntervalMs ?? 1000), DEFAULT_MIN_DECISION_INTERVAL_MS, DEFAULT_MAX_DECISION_INTERVAL_MS),
      temperature: Number.isFinite(input.temperature as number) ? Number(input.temperature) : 0,
      maxOutputTokens: Math.max(128, Number(input.maxOutputTokens ?? 512)),
      localOnly,
      minHoldMs: DEFAULT_MIN_HOLD_MS,
      flipCooldownMs: DEFAULT_FLIP_COOLDOWN_MS,
      minAddGapMs: DEFAULT_MIN_ADD_GAP_MS,
    };
    this.active = true;
    this.lastError = null;
    this.pending.clear();
    this.lastDecisionTs.clear();
    this.runtime.clear();
    this.holdStreak.clear();
    this.nonceSeq = 0;
    this.holdDurationTotalMs = 0;
    this.holdDurationSamples = 0;
    this.telemetry.invalidLLMResponses = 0;
    this.telemetry.repairCalls = 0;
    this.telemetry.guardrailBlocks = 0;
    this.telemetry.forcedExits = 0;
    this.telemetry.flipsCount = 0;
    this.telemetry.addsCount = 0;
    this.telemetry.avgHoldTimeMs = 0;
    this.telemetry.feePct = null;
    this.log?.('AI_DRY_RUN_START', { symbols, model: this.config.model || null, localOnly });
  }

  stop(): void {
    this.active = false;
    this.symbols.clear();
    this.pending.clear();
    this.holdStreak.clear();
    this.runtime.clear();
    this.log?.('AI_DRY_RUN_STOP', {});
  }

  isActive(): boolean {
    return this.active && !!this.config;
  }

  isTrackingSymbol(symbol: string): boolean {
    return this.isActive() && this.symbols.has(symbol.toUpperCase());
  }

  getStatus(): AIDryRunStatus {
    this.telemetry.avgHoldTimeMs = this.holdDurationSamples > 0
      ? Number((this.holdDurationTotalMs / this.holdDurationSamples).toFixed(2))
      : 0;
    return {
      active: this.isActive(),
      model: this.config?.model ? this.config.model : null,
      decisionIntervalMs: this.config?.decisionIntervalMs ?? 0,
      temperature: this.config?.temperature ?? 0,
      maxOutputTokens: this.config?.maxOutputTokens ?? 0,
      apiKeySet: Boolean(this.config?.apiKey),
      localOnly: Boolean(this.config?.localOnly),
      lastError: this.lastError,
      symbols: [...this.symbols],
      telemetry: { ...this.telemetry },
    };
  }

  async onMetrics(snapshot: AIMetricsSnapshot): Promise<void> {
    if (!this.isActive() || !this.config) return;
    if (!this.isTrackingSymbol(snapshot.symbol)) return;

    const nowMs = Number(snapshot.timestampMs || Date.now());
    const intervalMs = this.computeAdaptiveDecisionInterval(snapshot);
    const lastTs = this.lastDecisionTs.get(snapshot.symbol) || 0;
    if (nowMs - lastTs < intervalMs) return;
    if (this.pending.has(snapshot.symbol)) return;

    const runtime = this.getRuntimeState(snapshot.symbol);
    const runtimeContext = this.buildRuntimeContext(snapshot, runtime, nowMs);
    const preGuard = this.guardrails.evaluate(snapshot, runtimeContext, null);
    const blockedReasons = [...new Set([...(snapshot.blockedReasons || []), ...preGuard.blockedReasons])];
    const enrichedSnapshot = this.enrichSnapshot(snapshot, runtime, blockedReasons, runtimeContext);
    const promptNonce = this.generatePromptNonce(snapshot.symbol, nowMs);
    const snapshotHash = this.hashSnapshot(enrichedSnapshot, promptNonce);

    this.log?.('AI_DECISION_START', {
      symbol: snapshot.symbol,
      gatePassed: snapshot.decision.gatePassed,
      nowMs,
      lastTs,
      interval: intervalMs,
      promptNonce,
      blockedReasons,
      snapshotHash,
    });

    this.pending.add(snapshot.symbol);
    try {
      let proposedPlan: AIDecisionPlan;
      if (this.config.localOnly || !this.config.apiKey || !this.config.model) {
        proposedPlan = this.buildSafeHoldPlan(promptNonce, 'LOCAL_ONLY');
      } else {
        const prompt = this.buildPrompt(enrichedSnapshot, promptNonce);
        const resolved = await this.resolvePlanWithFallback(prompt, promptNonce, snapshot.symbol);
        const plan = resolved.plan;
        if (!plan) {
          this.telemetry.invalidLLMResponses += 1;
          this.lastError = resolved.error || 'ai_invalid_or_unparseable_response';
          proposedPlan = this.buildSafeHoldPlan(promptNonce, 'INVALID_AI_RESPONSE');
        } else {
          proposedPlan = plan;
          this.lastError = null;
        }
      }

      const postGuard = this.guardrails.evaluate(enrichedSnapshot, runtimeContext, proposedPlan);
      const resolvedPlan = this.applyGuardrails(enrichedSnapshot, proposedPlan, postGuard);
      const decision = this.buildDecision(enrichedSnapshot, resolvedPlan, {
        promptNonce,
        blockedReasons: postGuard.blockedReasons,
        forcedAction: postGuard.forcedAction,
        snapshotHash,
      });

      const positionBefore = enrichedSnapshot.position ? { ...enrichedSnapshot.position } : null;
      const orders = this.dryRunSession.submitStrategyDecision(snapshot.symbol, decision, snapshot.timestampMs);
      const positionAfter = this.dryRunSession.getStrategyPosition(snapshot.symbol);
      const orderDetails = Array.isArray(orders)
        ? orders.map((order: any) => ({
          type: String(order?.type || ''),
          side: String(order?.side || ''),
          qty: Number(order?.qty || 0),
          price: Number.isFinite(Number(order?.price)) ? Number(order?.price) : null,
          reduceOnly: Boolean(order?.reduceOnly),
          postOnly: Boolean(order?.postOnly),
        }))
        : [];
      this.updateRuntime(enrichedSnapshot, runtime, resolvedPlan, nowMs, postGuard.forcedAction);
      this.lastDecisionTs.set(snapshot.symbol, nowMs);

      this.log?.('AI_DECISION_RESULT', {
        symbol: snapshot.symbol,
        promptNonce,
        intent: resolvedPlan.intent,
        confidence: resolvedPlan.confidence,
        tags: resolvedPlan.explanationTags,
        blockedReasons: postGuard.blockedReasons,
        forcedAction: postGuard.forcedAction,
        ordersCreated: orderDetails.length,
        orders: orderDetails,
        positionBefore,
        positionAfter,
        snapshotHash,
      });
    } catch (error: any) {
      this.lastError = error?.message || 'ai_decision_failed';
      this.telemetry.invalidLLMResponses += 1;
      this.log?.('AI_DRY_RUN_ERROR', { symbol: snapshot.symbol, error: this.lastError });
      const forced = this.guardrails.evaluate(enrichedSnapshot, runtimeContext, null).forcedAction;
      const safePlan = forced
        ? this.planFromForcedAction(promptNonce, forced)
        : this.buildSafeHoldPlan(promptNonce, 'INVALID_AI_RESPONSE');
      const safeDecision = this.buildDecision(enrichedSnapshot, safePlan, {
        promptNonce,
        blockedReasons: forced ? ['RISK_LOCK'] : ['COOLDOWN_ACTIVE'],
        forcedAction: forced,
        snapshotHash,
      });
      this.dryRunSession.submitStrategyDecision(snapshot.symbol, safeDecision, snapshot.timestampMs);
      this.lastDecisionTs.set(snapshot.symbol, nowMs);
    } finally {
      this.pending.delete(snapshot.symbol);
    }
  }

  private async resolvePlanWithFallback(
    prompt: string,
    promptNonce: string,
    symbol: string
  ): Promise<{ plan: AIDecisionPlan | null; error: string | null }> {
    if (!this.config || !this.config.apiKey || !this.config.model) {
      return { plan: null, error: 'ai_config_missing' };
    }

    const modelSequence = this.buildModelSequence(this.config.model);
    let lastError: string | null = null;

    for (const model of modelSequence) {
      try {
        this.log?.('AI_CALLING_GEMINI', { symbol, promptLen: prompt.length, promptNonce, model });
        const response = await generateContent({
          apiKey: this.config.apiKey,
          model,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxOutputTokens,
          responseSchema: this.buildResponseSchema(),
        }, prompt);
        this.log?.('AI_GEMINI_RESPONSE', {
          symbol,
          model,
          promptNonce,
          finishReason: response.meta?.finishReason || null,
          blockReason: response.meta?.blockReason || null,
          hasText: Boolean(response.text),
          textLen: response.text ? response.text.length : 0,
        });

        let plan = this.parsePlan(response.text, promptNonce);
        if (!plan && response.text) {
          plan = await this.retryParsePlan(promptNonce, response.text, model);
        }
        if (plan) {
          return { plan, error: null };
        }

        lastError = 'ai_invalid_or_unparseable_response';
        this.log?.('AI_PARSE_FAILED', { symbol, model, promptNonce });
      } catch (error: any) {
        const message = String(error?.message || 'ai_decision_failed');
        lastError = message;
        this.log?.('AI_MODEL_CALL_FAILED', { symbol, model, promptNonce, error: message });
        if (!this.shouldTryNextModel(message)) {
          break;
        }
      }
    }

    return { plan: null, error: lastError || 'ai_invalid_or_unparseable_response' };
  }

  private buildModelSequence(primaryModel: string): string[] {
    const normalizedPrimary = String(primaryModel || '').trim();
    const sequence: string[] = [];
    if (normalizedPrimary) {
      sequence.push(normalizedPrimary);
    }
    for (const fallback of DEFAULT_FALLBACK_MODELS) {
      if (!fallback) continue;
      if (!sequence.some((item) => item.toLowerCase() === fallback.toLowerCase())) {
        sequence.push(fallback);
      }
    }
    return sequence;
  }

  private shouldTryNextModel(errorMessage: string): boolean {
    const msg = String(errorMessage || '').toLowerCase();
    if (!msg) return true;
    return (
      msg.includes('ai_http_429')
      || msg.includes('ai_http_500')
      || msg.includes('ai_http_502')
      || msg.includes('ai_http_503')
      || msg.includes('ai_http_504')
      || msg.includes('ai_http_404')
      || msg.includes('not found')
      || msg.includes('unavailable')
      || msg.includes('resource exhausted')
      || msg.includes('deadline exceeded')
    );
  }

  private buildPrompt(snapshot: AIMetricsSnapshot, nonce: string): string {
    const payload = {
      nonce,
      symbol: snapshot.symbol,
      timestampMs: snapshot.timestampMs,
      regime: snapshot.decision.regime,
      gatePassed: snapshot.decision.gatePassed,
      blockedReasons: snapshot.blockedReasons,
      riskState: snapshot.riskState,
      executionState: snapshot.executionState,
      market: snapshot.market,
      trades: snapshot.trades,
      openInterest: snapshot.openInterest,
      absorption: snapshot.absorption,
      volatility: snapshot.volatility,
      position: snapshot.position,
    };

    return [
      'You are the autonomous decision authority for a futures paper-trading system.',
      'Return exactly one JSON object and no markdown.',
      '',
      'Hard rules:',
      '- Echo the nonce exactly.',
      '- version must be 1.',
      '- intent must be one of HOLD, ENTER, MANAGE, EXIT.',
      '- ENTER requires side LONG or SHORT.',
      '- side must be null when intent is HOLD unless explicitly needed for context.',
      '- sizeMultiplier must stay in [0.1, 2.0].',
      '- maxAdds must stay in [0, 5].',
      '- reducePct is null or in [0.1, 1.0].',
      '- explanationTags max length is 5.',
      '- Keep numbers short (max 4 decimal places).',
      '- If uncertain, return HOLD.',
      '',
      'You should manage full lifecycle: entry, add, reduce, exit.',
      'Prefer add-on only when winner conditions and trend integrity hold.',
      '',
      'JSON schema fields:',
      '{"version":1,"nonce":"...","intent":"HOLD|ENTER|MANAGE|EXIT","side":"LONG|SHORT|null","urgency":"LOW|MED|HIGH","entryStyle":"LIMIT|MARKET_SMALL|HYBRID","sizeMultiplier":0.1,"maxAdds":0,"addRule":"WINNER_ONLY|TREND_INTACT|NEVER","addTrigger":{"minUnrealizedPnlPct":0.0015,"trendIntact":true,"obiSupportMin":0.1,"deltaConfirm":true},"reducePct":null,"invalidationHint":"VWAP|ATR|OBI_FLIP|ABSORPTION_BREAK|NONE","explanationTags":["TREND_INTACT"],"confidence":0.0}',
      '',
      'Snapshot:',
      JSON.stringify(payload),
    ].join('\n');
  }

  private buildResponseSchema(): Record<string, unknown> {
    return {
      type: 'OBJECT',
      required: ['version', 'nonce', 'intent'],
      properties: {
        // Gemini schema validator expects string enums; keep version numeric and validate value in parser.
        version: { type: 'NUMBER' },
        nonce: { type: 'STRING' },
        intent: { type: 'STRING', enum: ['HOLD', 'ENTER', 'MANAGE', 'EXIT'] },
        side: { type: 'STRING', enum: ['LONG', 'SHORT'] },
        urgency: { type: 'STRING', enum: ['LOW', 'MED', 'HIGH'] },
        entryStyle: { type: 'STRING', enum: ['LIMIT', 'MARKET_SMALL', 'HYBRID'] },
        sizeMultiplier: { type: 'NUMBER' },
        maxAdds: { type: 'NUMBER' },
        addRule: { type: 'STRING', enum: ['WINNER_ONLY', 'TREND_INTACT', 'NEVER'] },
        addTrigger: {
          type: 'OBJECT',
          required: ['minUnrealizedPnlPct', 'trendIntact', 'obiSupportMin', 'deltaConfirm'],
          properties: {
            minUnrealizedPnlPct: { type: 'NUMBER' },
            trendIntact: { type: 'BOOLEAN' },
            obiSupportMin: { type: 'NUMBER' },
            deltaConfirm: { type: 'BOOLEAN' },
          },
        },
        reducePct: { type: 'NUMBER' },
        invalidationHint: { type: 'STRING', enum: ['VWAP', 'ATR', 'OBI_FLIP', 'ABSORPTION_BREAK', 'NONE'] },
        explanationTags: { type: 'ARRAY', items: { type: 'STRING' } },
        confidence: { type: 'NUMBER' },
      },
    };
  }

  private parsePlan(text: string | null, expectedNonce: string): AIDecisionPlan | null {
    const raw = this.extractJsonObject(text);
    if (!raw) {
      return this.parseLoosePlan(text, expectedNonce);
    }

    let parsed: Record<string, unknown>;
    try {
      const json = JSON.parse(raw);
      if (!json || typeof json !== 'object') {
        return this.parseLoosePlan(text, expectedNonce);
      }
      if (Array.isArray(json)) {
        const firstObject = json.find((item) => item && typeof item === 'object' && !Array.isArray(item));
        if (!firstObject || typeof firstObject !== 'object') {
          return this.parseLoosePlan(text, expectedNonce);
        }
        parsed = firstObject as Record<string, unknown>;
      } else {
        parsed = json as Record<string, unknown>;
      }
    } catch {
      return this.parseLoosePlan(text, expectedNonce);
    }

    const version = Number(parsed.version ?? PLAN_VERSION);
    if (version !== PLAN_VERSION) return null;

    const nonceRaw = String(parsed.nonce || '').trim();
    const nonce = nonceRaw || expectedNonce;
    if (nonce !== expectedNonce) return null;

    const actionLike = parsed.intent ?? parsed.action ?? parsed.decision ?? parsed.tradeAction ?? parsed.type;
    const intent = this.parseIntent(actionLike);
    if (!intent) return null;

    const sideFromFields = normalizeSide(
      String(parsed.side ?? parsed.direction ?? parsed.positionSide ?? '')
    ) as 'LONG' | 'SHORT' | null;
    const sideFromAction = normalizeSide(String(actionLike || '')) as 'LONG' | 'SHORT' | null;
    const side = sideFromFields ?? sideFromAction;
    if (intent === 'ENTER' && !side) return null;

    const urgency = this.parseUrgency(parsed.urgency);
    const entryStyle = this.parseEntryStyle(parsed.entryStyle);
    const addRule = this.parseAddRule(parsed.addRule);
    const invalidationHint = this.parseInvalidationHint(parsed.invalidationHint);
    const confidence = clampPlanNumber(Number(parsed.confidence), 0, 1);
    const sizeMultiplier = clampPlanNumber(Number(parsed.sizeMultiplier ?? 1), 0.1, 2);
    const maxAdds = clamp(Math.trunc(Number(parsed.maxAdds ?? 0)), 0, 5);

    const addTriggerInput = parsed.addTrigger && typeof parsed.addTrigger === 'object'
      ? parsed.addTrigger as Record<string, unknown>
      : {};
    const addTrigger = {
      minUnrealizedPnlPct: clampPlanNumber(Number(addTriggerInput.minUnrealizedPnlPct ?? DEFAULT_ADD_MIN_UPNL_PCT), 0, 0.05),
      trendIntact: Boolean(addTriggerInput.trendIntact),
      obiSupportMin: clampPlanNumber(Number(addTriggerInput.obiSupportMin ?? 0.1), -1, 1),
      deltaConfirm: Boolean(addTriggerInput.deltaConfirm),
    };

    const reduceRaw = parsed.reducePct;
    const reducePct = reduceRaw == null
      ? null
      : clampPlanNumber(Number(reduceRaw), 0.1, 1);

    const explanationTags = Array.isArray(parsed.explanationTags)
      ? parsed.explanationTags.map(toTag).filter((v): v is AIExplanationTag => Boolean(v)).slice(0, 5)
      : typeof parsed.explanationTags === 'string'
        ? String(parsed.explanationTags).split(',').map((tag) => toTag(tag)).filter((v): v is AIExplanationTag => Boolean(v)).slice(0, 5)
        : [];

    return {
      version: PLAN_VERSION,
      nonce,
      intent,
      side: side ?? null,
      urgency,
      entryStyle,
      sizeMultiplier,
      maxAdds,
      addRule,
      addTrigger,
      reducePct,
      invalidationHint,
      explanationTags,
      confidence,
    };
  }

  private extractJsonObject(text: string | null): string | null {
    const trimmed = normalizeJsonCandidate(String(text || '').trim());
    if (!trimmed) return null;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced && fenced[1] ? normalizeJsonCandidate(fenced[1]) : trimmed;

    const direct = this.tryParseJsonObject(candidate);
    if (direct) return direct;

    const balanced = this.extractBalancedJsonObject(candidate);
    if (balanced) return balanced;

    return null;
  }

  private tryParseJsonObject(candidate: string): string | null {
    const normalized = normalizeJsonCandidate(candidate);
    if (!normalized) return null;
    try {
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed)) {
          const firstObject = parsed.find((item) => item && typeof item === 'object' && !Array.isArray(item));
          if (!firstObject || typeof firstObject !== 'object') return null;
          return JSON.stringify(firstObject);
        }
        return JSON.stringify(parsed);
      }
    } catch {
      // ignore and continue to balanced extraction
    }
    return null;
  }

  private extractBalancedJsonObject(text: string): string | null {
    const source = String(text || '');
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] !== '{') continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let j = i; j < source.length; j += 1) {
        const ch = source[j];
        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === '\\') {
            escaped = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '{') {
          depth += 1;
          continue;
        }
        if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const candidate = normalizeJsonCandidate(source.slice(i, j + 1));
            const parsed = this.tryParseJsonObject(candidate);
            if (parsed) return parsed;
            break;
          }
        }
      }
    }
    return null;
  }

  private parseLoosePlan(text: string | null, expectedNonce: string): AIDecisionPlan | null {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const upper = raw.toUpperCase();
    const intent =
      upper.includes('ENTER') || upper.includes('ENTRY') || upper.includes('"ACTION":"BUY"') || upper.includes('"ACTION":"SELL"')
        ? 'ENTER'
        : upper.includes('ADD') || upper.includes('REDUCE') || upper.includes('MANAGE')
          ? 'MANAGE'
          : upper.includes('EXIT') || upper.includes('CLOSE')
            ? 'EXIT'
            : upper.includes('HOLD') || upper.includes('WAIT') || upper.includes('NOOP')
              ? 'HOLD'
              : null;
    if (!intent) return null;

    const side = intent === 'ENTER'
      ? (normalizeSide(upper.includes('SHORT') || upper.includes('SELL') ? 'SHORT' : upper.includes('LONG') || upper.includes('BUY') ? 'LONG' : '') as 'LONG' | 'SHORT' | null)
      : null;
    if (intent === 'ENTER' && !side) return null;

    return {
      version: PLAN_VERSION,
      nonce: expectedNonce,
      intent,
      side,
      urgency: 'MED',
      entryStyle: 'HYBRID',
      sizeMultiplier: 0.5,
      maxAdds: 1,
      addRule: 'WINNER_ONLY',
      addTrigger: {
        minUnrealizedPnlPct: DEFAULT_ADD_MIN_UPNL_PCT,
        trendIntact: false,
        obiSupportMin: 0.1,
        deltaConfirm: false,
      },
      reducePct: intent === 'MANAGE' && upper.includes('REDUCE') ? 0.5 : null,
      invalidationHint: 'NONE',
      explanationTags: [],
      confidence: 0.25,
    };
  }

  private async retryParsePlan(expectedNonce: string, rawText: string, modelOverride?: string): Promise<AIDecisionPlan | null> {
    if (!this.config || !this.config.apiKey || !this.config.model) return null;
    this.telemetry.repairCalls += 1;
    const retryPrompt = [
      'Return one valid JSON object only.',
      'Do not include markdown or explanation.',
      `Nonce must be exactly: ${expectedNonce}`,
      'version must be 1.',
      'intent must be HOLD, ENTER, MANAGE, or EXIT.',
      'Optional fields may be omitted.',
      'Use short numeric values.',
      `Minimal valid example: {"version":1,"nonce":"${expectedNonce}","intent":"HOLD","confidence":0.2}`,
      'Input:',
      rawText.slice(0, 4000),
    ].join('\n');
    try {
      const retryResponse = await generateContent({
        apiKey: this.config.apiKey,
        model: modelOverride || this.config.model,
        temperature: 0,
        maxOutputTokens: this.config.maxOutputTokens,
        responseSchema: this.buildResponseSchema(),
      }, retryPrompt);
      return this.parsePlan(retryResponse.text, expectedNonce);
    } catch {
      return null;
    }
  }

  private applyGuardrails(
    snapshot: AIMetricsSnapshot,
    plan: AIDecisionPlan,
    guardrails: ReturnType<SafetyGuardrails['evaluate']>
  ): AIDecisionPlan {
    if (guardrails.forcedAction) {
      this.telemetry.forcedExits += 1;
      return this.planFromForcedAction(plan.nonce, guardrails.forcedAction);
    }

    if (plan.intent === 'ENTER') {
      if (guardrails.blockEntry) {
        this.telemetry.guardrailBlocks += 1;
        return this.buildSafeHoldPlan(plan.nonce, 'RISK_LOCK');
      }
      if (snapshot.position && plan.side && snapshot.position.side !== plan.side && guardrails.blockFlip) {
        this.telemetry.guardrailBlocks += 1;
        return this.buildSafeHoldPlan(plan.nonce, 'FLIP_COOLDOWN_ACTIVE');
      }
    }

    if (plan.intent === 'MANAGE') {
      const isAddIntent = this.planImpliesAdd(plan);
      if (isAddIntent && guardrails.blockAdd) {
        this.telemetry.guardrailBlocks += 1;
        return this.buildSafeHoldPlan(plan.nonce, 'ADD_GAP_ACTIVE');
      }
    }

    if (plan.intent === 'EXIT' && guardrails.blockFlip) {
      this.telemetry.guardrailBlocks += 1;
      return this.buildSafeHoldPlan(plan.nonce, 'MIN_HOLD_ACTIVE');
    }

    return plan;
  }

  private buildDecision(
    snapshot: AIMetricsSnapshot,
    plan: AIDecisionPlan,
    context: {
      promptNonce: string;
      blockedReasons: GuardrailReason[];
      forcedAction: AIForcedAction | null;
      snapshotHash: string;
    }
  ): StrategyDecision {
    const actions: StrategyAction[] = [];
    const side = plan.side ? (plan.side as StrategySide) : null;

    if (plan.intent === 'HOLD') {
      actions.push({
        type: StrategyActionType.NOOP,
        reason: 'NOOP',
        metadata: { ai: true, plan, context },
      });
    } else if (plan.intent === 'ENTER' && side) {
      actions.push({
        type: StrategyActionType.ENTRY,
        side,
        reason: 'ENTRY_TR',
        expectedPrice: snapshot.market.price,
        sizeMultiplier: clampPlanNumber(Number(plan.sizeMultiplier ?? 1), 0.1, 2),
        metadata: { ai: true, plan, context },
      });
    } else if (plan.intent === 'MANAGE') {
      if (plan.reducePct != null) {
        actions.push({
          type: StrategyActionType.REDUCE,
          reason: 'REDUCE_SOFT',
          reducePct: clampPlanNumber(plan.reducePct, 0.1, 1),
          metadata: { ai: true, plan, context },
        });
      } else if (this.shouldAllowAdd(snapshot, plan)) {
        actions.push({
          type: StrategyActionType.ADD,
          side: snapshot.position?.side,
          reason: 'AI_ADD',
          expectedPrice: snapshot.market.price,
          sizeMultiplier: clampPlanNumber(Number(plan.sizeMultiplier ?? 0.5), 0.1, 2),
          metadata: {
            ai: true,
            plan,
            context,
            incrementalRiskCapPct: 0.25,
          },
        });
      } else {
        actions.push({
          type: StrategyActionType.NOOP,
          reason: 'NOOP',
          metadata: { ai: true, plan, context, note: 'manage_add_conditions_not_met' },
        });
      }
    } else if (plan.intent === 'EXIT') {
      if (plan.reducePct != null && plan.reducePct < 1) {
        actions.push({
          type: StrategyActionType.REDUCE,
          reason: 'REDUCE_SOFT',
          reducePct: clampPlanNumber(plan.reducePct, 0.1, 1),
          metadata: { ai: true, plan, context },
        });
      } else {
        actions.push({
          type: StrategyActionType.EXIT,
          reason: 'EXIT_HARD',
          metadata: { ai: true, plan, context },
        });
      }
    }

    if (actions.length === 0) {
      actions.push({
        type: StrategyActionType.NOOP,
        reason: 'NOOP',
        metadata: { ai: true, plan, context, note: 'empty_action_fallback' },
      });
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
          ai: true,
          promptNonce: context.promptNonce,
          blockedReasons: context.blockedReasons,
          forcedAction: context.forcedAction,
          snapshotHash: context.snapshotHash,
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
        aiConfidence: plan.confidence,
      },
    };

    const decision: StrategyDecision = {
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

    this.recordDecisionLog(decision, plan.intent);
    return decision;
  }

  private shouldAllowAdd(snapshot: AIMetricsSnapshot, plan: AIDecisionPlan): boolean {
    const position = snapshot.position;
    if (!position) return false;
    if (plan.addRule === 'NEVER') return false;
    if (position.addsUsed >= plan.maxAdds) return false;
    if (!snapshot.decision.gatePassed) return false;

    const marginUsage = snapshot.riskState.equity > 0
      ? snapshot.riskState.marginInUse / snapshot.riskState.equity
      : 0;
    if (marginUsage >= DEFAULT_ADD_MARGIN_USAGE_CAP) return false;

    const minUpnl = clampPlanNumber(plan.addTrigger.minUnrealizedPnlPct, 0, 0.05);
    const upnl = Number(position.unrealizedPnlPct || 0);
    const sideSign = position.side === 'LONG' ? 1 : -1;

    const deltaAligned = plan.addTrigger.deltaConfirm
      ? sideSign * (snapshot.market.delta5s + snapshot.market.delta1s) > 0
      : true;

    const obiSupport = sideSign > 0
      ? snapshot.market.obiDeep >= plan.addTrigger.obiSupportMin
      : snapshot.market.obiDeep <= -Math.abs(plan.addTrigger.obiSupportMin);

    if (!deltaAligned || !obiSupport) return false;

    if (plan.addRule === 'WINNER_ONLY') {
      return upnl >= Math.max(minUpnl, DEFAULT_ADD_MIN_UPNL_PCT) && Boolean(plan.addTrigger.trendIntact);
    }

    if (plan.addRule === 'TREND_INTACT') {
      return Boolean(plan.addTrigger.trendIntact) && upnl >= 0;
    }

    return false;
  }

  private updateRuntime(
    snapshot: AIMetricsSnapshot,
    runtime: RuntimeState,
    plan: AIDecisionPlan,
    nowMs: number,
    forcedAction: AIForcedAction | null
  ): void {
    const previousAction = runtime.lastAction;
    if (plan.intent === 'HOLD') {
      this.holdStreak.set(snapshot.symbol, (this.holdStreak.get(snapshot.symbol) || 0) + 1);
      if (runtime.holdStartTs <= 0) {
        runtime.holdStartTs = nowMs;
      }
    } else {
      this.holdStreak.set(snapshot.symbol, 0);
      if (runtime.holdStartTs > 0) {
        const holdDuration = Math.max(0, nowMs - runtime.holdStartTs);
        this.holdDurationTotalMs += holdDuration;
        this.holdDurationSamples += 1;
        runtime.holdStartTs = 0;
      }
    }

    if (plan.intent === 'ENTER' && plan.side) {
      const targetSide = plan.side as StrategySide;
      if (snapshot.position && snapshot.position.side !== targetSide) {
        runtime.lastFlipTs = nowMs;
        runtime.lastExitSide = snapshot.position.side;
        this.telemetry.flipsCount += 1;
      }
      runtime.lastEntryTs = nowMs;
      runtime.lastActionSide = targetSide;
    }

    if (plan.intent === 'MANAGE' && this.planImpliesAdd(plan) && this.shouldAllowAdd(snapshot, plan)) {
      runtime.lastAddTs = nowMs;
      this.telemetry.addsCount += 1;
    }

    if (plan.intent === 'EXIT' && snapshot.position) {
      runtime.lastFlipTs = nowMs;
      runtime.lastExitSide = snapshot.position.side;
    }

    if (forcedAction && forcedAction.intent === 'EXIT') {
      runtime.lastFlipTs = nowMs;
      if (snapshot.position) {
        runtime.lastExitSide = snapshot.position.side;
      }
    }

    runtime.lastAction = plan.intent;
    if (previousAction === 'HOLD' && plan.intent !== 'HOLD' && runtime.holdStartTs > 0) {
      const holdDuration = Math.max(0, nowMs - runtime.holdStartTs);
      this.holdDurationTotalMs += holdDuration;
      this.holdDurationSamples += 1;
      runtime.holdStartTs = 0;
    }
  }

  private buildSafeHoldPlan(nonce: string, tag: GuardrailReason | 'LOCAL_ONLY' | 'INVALID_AI_RESPONSE'): AIDecisionPlan {
    return {
      version: PLAN_VERSION,
      nonce,
      intent: 'HOLD',
      side: null,
      urgency: 'LOW',
      entryStyle: 'LIMIT',
      sizeMultiplier: 0.1,
      maxAdds: 0,
      addRule: 'NEVER',
      addTrigger: {
        minUnrealizedPnlPct: DEFAULT_ADD_MIN_UPNL_PCT,
        trendIntact: false,
        obiSupportMin: 0,
        deltaConfirm: false,
      },
      reducePct: null,
      invalidationHint: 'NONE',
      explanationTags: [tag === 'INVALID_AI_RESPONSE' ? 'RISK_LOCK' : 'COOLDOWN_ACTIVE'],
      confidence: 0,
    };
  }

  private planFromForcedAction(nonce: string, forced: AIForcedAction): AIDecisionPlan {
    if (forced.intent === 'EXIT') {
      return {
        ...this.buildSafeHoldPlan(nonce, forced.reason),
        intent: 'EXIT',
        confidence: 1,
      };
    }
    if (forced.intent === 'MANAGE') {
      return {
        ...this.buildSafeHoldPlan(nonce, forced.reason),
        intent: 'MANAGE',
        reducePct: clampPlanNumber(Number(forced.reducePct ?? 0.5), 0.1, 1),
        confidence: 1,
      };
    }
    return this.buildSafeHoldPlan(nonce, forced.reason);
  }

  private planImpliesAdd(plan: AIDecisionPlan): boolean {
    return plan.intent === 'MANAGE' && plan.reducePct == null && plan.addRule !== 'NEVER';
  }

  private parseIntent(raw: unknown): AIDecisionIntent | null {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'HOLD' || value === 'WAIT' || value === 'NOOP') return 'HOLD';
    if (value === 'ENTER' || value === 'ENTRY' || value === 'BUY' || value === 'SELL' || value === 'LONG' || value === 'SHORT') return 'ENTER';
    if (value === 'MANAGE' || value === 'ADD' || value === 'REDUCE') return 'MANAGE';
    if (value === 'EXIT' || value === 'CLOSE') return 'EXIT';
    return null;
  }

  private parseUrgency(raw: unknown): AIUrgency {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'LOW' || value === 'MED' || value === 'HIGH') return value;
    return 'MED';
  }

  private parseEntryStyle(raw: unknown): AIEntryStyle {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'LIMIT' || value === 'MARKET_SMALL' || value === 'HYBRID') return value;
    return 'HYBRID';
  }

  private parseAddRule(raw: unknown): AIAddRule {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'WINNER_ONLY' || value === 'TREND_INTACT' || value === 'NEVER') return value;
    return 'WINNER_ONLY';
  }

  private parseInvalidationHint(raw: unknown): AIDecisionPlan['invalidationHint'] {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'VWAP' || value === 'ATR' || value === 'OBI_FLIP' || value === 'ABSORPTION_BREAK' || value === 'NONE') {
      return value;
    }
    return 'NONE';
  }

  private getRuntimeState(symbol: string): RuntimeState {
    let state = this.runtime.get(symbol);
    if (!state) {
      state = {
        lastAction: 'NONE',
        lastActionSide: null,
        lastEntryTs: 0,
        lastAddTs: 0,
        lastFlipTs: 0,
        lastExitSide: null,
        holdStartTs: 0,
      };
      this.runtime.set(symbol, state);
    }
    return state;
  }

  private computeAdaptiveDecisionInterval(snapshot: AIMetricsSnapshot): number {
    if (!this.config) return 1000;
    const base = clamp(this.config.decisionIntervalMs, DEFAULT_MIN_DECISION_INTERVAL_MS, DEFAULT_MAX_DECISION_INTERVAL_MS);
    const prints = snapshot.trades.printsPerSecond;
    const burst = snapshot.trades.burstCount;
    const tradeCount = snapshot.trades.tradeCount;

    let factor = 1;
    if (prints >= 8 || burst >= 6 || tradeCount >= 40) {
      factor = 0.6;
    } else if (prints <= 1 || tradeCount <= 6) {
      factor = 1.8;
    } else if (prints >= 4 || burst >= 3) {
      factor = 0.8;
    }

    return clamp(Math.round(base * factor), DEFAULT_MIN_DECISION_INTERVAL_MS, DEFAULT_MAX_DECISION_INTERVAL_MS);
  }

  private buildRuntimeContext(snapshot: AIMetricsSnapshot, runtime: RuntimeState, nowMs: number): GuardrailRuntimeContext {
    if (!this.config) {
      return { nowMs, minHoldMsRemaining: 0, flipCooldownMsRemaining: 0, addGapMsRemaining: 0 };
    }
    const minHoldMsRemaining = runtime.lastEntryTs > 0
      ? Math.max(0, this.config.minHoldMs - Math.max(0, nowMs - runtime.lastEntryTs))
      : Math.max(0, Number(snapshot.riskState.cooldownMsRemaining || 0));
    const flipCooldownMsRemaining = runtime.lastFlipTs > 0
      ? Math.max(0, this.config.flipCooldownMs - Math.max(0, nowMs - runtime.lastFlipTs))
      : 0;
    const addGapMsRemaining = runtime.lastAddTs > 0
      ? Math.max(0, this.config.minAddGapMs - Math.max(0, nowMs - runtime.lastAddTs))
      : 0;
    return { nowMs, minHoldMsRemaining, flipCooldownMsRemaining, addGapMsRemaining };
  }

  private enrichSnapshot(
    snapshot: AIMetricsSnapshot,
    runtime: RuntimeState,
    blockedReasons: string[],
    runtimeContext: GuardrailRuntimeContext
  ): AIMetricsSnapshot {
    const nowMs = Number(snapshot.timestampMs || Date.now());
    const holdStreak = this.holdStreak.get(snapshot.symbol) || 0;
    return {
      ...snapshot,
      blockedReasons,
      riskState: {
        ...snapshot.riskState,
        cooldownMsRemaining: Math.max(
          Number(snapshot.riskState.cooldownMsRemaining || 0),
          runtimeContext.minHoldMsRemaining,
          runtimeContext.flipCooldownMsRemaining
        ),
      },
      executionState: {
        lastAction: runtime.lastAction,
        holdStreak,
        lastAddMsAgo: runtime.lastAddTs > 0 ? Math.max(0, nowMs - runtime.lastAddTs) : null,
        lastFlipMsAgo: runtime.lastFlipTs > 0 ? Math.max(0, nowMs - runtime.lastFlipTs) : null,
      },
      position: snapshot.position
        ? {
          ...snapshot.position,
          timeInPositionMs: Math.max(0, Number(snapshot.position.timeInPositionMs || 0)),
        }
        : null,
    };
  }

  private generatePromptNonce(symbol: string, nowMs: number): string {
    this.nonceSeq += 1;
    return `${symbol}-${nowMs}-${this.nonceSeq}`;
  }

  private hashSnapshot(snapshot: AIMetricsSnapshot, nonce: string): string {
    return createHash('sha256')
      .update(JSON.stringify({ nonce, snapshot }))
      .digest('hex')
      .slice(0, 16);
  }

  private recordDecisionLog(decision: StrategyDecision, intent: AIDecisionIntent): void {
    if (!this.decisionLog) return;
    const payload: StrategyDecisionLog = {
      ...decision.log,
      stats: {
        ...decision.log.stats,
        aiIntent: ['HOLD', 'ENTER', 'MANAGE', 'EXIT'].indexOf(intent),
      },
    };
    this.decisionLog.record(payload);
  }
}

