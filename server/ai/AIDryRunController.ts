import { DecisionLog } from '../telemetry/DecisionLog';
import { StrategyAction, StrategyActionType, StrategyDecision, StrategyDecisionLog, StrategySide } from '../types/strategy';
import { DryRunSessionService } from '../dryrun/DryRunSessionService';
import { generateContent } from './GoogleAIClient';
import { AutonomousMetricsPolicy, AutonomousPolicyDecision } from './AutonomousMetricsPolicy';
import { AIAction, AIDryRunConfig, AIDryRunStatus, AIMetricsSnapshot } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeSide = (raw?: string | null): StrategySide | null => {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return null;
  if (value === 'LONG' || value === 'BUY') return 'LONG';
  if (value === 'SHORT' || value === 'SELL') return 'SHORT';
  return null;
};

const parseFloatSafe = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const normalizeJsonCandidate = (value: string): string => {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '"')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
};

export class AIDryRunController {
  private active = false;
  private config: AIDryRunConfig | null = null;
  private symbols = new Set<string>();
  private readonly lastDecisionTs = new Map<string, number>();
  private readonly pending = new Set<string>();
  private readonly holdStreak = new Map<string, number>();
  private readonly policy = new AutonomousMetricsPolicy();
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
      decisionIntervalMs: Math.max(500, Number(input.decisionIntervalMs ?? 2000)),
      temperature: Number.isFinite(input.temperature as number) ? Number(input.temperature) : 0.3,
      maxOutputTokens: Math.max(64, Number(input.maxOutputTokens ?? 256)),
      localOnly,
    };
    this.active = true;
    this.lastError = null;
    this.holdStreak.clear();
    this.log?.('AI_DRY_RUN_START', { symbols, model: this.config.model || null, localOnly });
  }

  stop(): void {
    this.active = false;
    this.symbols.clear();
    this.pending.clear();
    this.holdStreak.clear();
    this.log?.('AI_DRY_RUN_STOP', {});
  }

  isActive(): boolean {
    return this.active && !!this.config;
  }

  isTrackingSymbol(symbol: string): boolean {
    return this.isActive() && this.symbols.has(symbol.toUpperCase());
  }

  getStatus(): AIDryRunStatus {
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
    };
  }

  async onMetrics(snapshot: AIMetricsSnapshot): Promise<void> {
    if (!this.isActive() || !this.config) return;
    if (!this.isTrackingSymbol(snapshot.symbol)) return;

    const nowMs = snapshot.timestampMs;
    const lastTs = this.lastDecisionTs.get(snapshot.symbol) || 0;
    if (nowMs - lastTs < this.config.decisionIntervalMs) return;
    if (this.pending.has(snapshot.symbol)) return;

    this.log?.('AI_DECISION_START', { symbol: snapshot.symbol, gatePassed: snapshot.decision.gatePassed, nowMs, lastTs, interval: this.config.decisionIntervalMs });

    this.pending.add(snapshot.symbol);
    try {
      const policyDecision = this.policy.decide(snapshot);
      if (this.config.localOnly || !this.config.apiKey || !this.config.model) {
        this.applyResolvedAction(snapshot, policyDecision.action, {
          source: 'policy_local_only',
          policy: policyDecision,
        });
        this.lastDecisionTs.set(snapshot.symbol, nowMs);
        this.lastError = null;
        return;
      }

      const prompt = this.buildPrompt(snapshot);
      this.log?.('AI_CALLING_GEMINI', { symbol: snapshot.symbol, promptLen: prompt.length });
      const aiConfig = {
        apiKey: this.config.apiKey,
        model: this.config.model,
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
      };

      const response = await generateContent(aiConfig, prompt);
      this.log?.('AI_GEMINI_RESPONSE', {
        symbol: snapshot.symbol,
        text: response.text?.slice(0, 300) || null,
        finishReason: response.meta?.finishReason || null,
        blockReason: response.meta?.blockReason || null,
      });

      if (!response.text) {
        const blockReason = response.meta?.blockReason || 'none';
        const finishReason = response.meta?.finishReason || 'none';
        this.lastError = `ai_empty_response:block=${blockReason};finish=${finishReason}`;
        this.log?.('AI_DRY_RUN_ERROR', {
          symbol: snapshot.symbol,
          error: this.lastError,
          meta: response.meta || null,
        });
        this.submitFallbackPolicy(snapshot, 'empty_response', policyDecision);
        return;
      }

      let action = this.parseAction(response.text);
      this.log?.('AI_PARSED_ACTION', { symbol: snapshot.symbol, action });

      if (!action) {
        this.log?.('AI_PARSE_RETRY', { symbol: snapshot.symbol });
        action = await this.retryParseAction(snapshot, response.text);
      }

      if (!action) {
        this.lastError = 'ai_parse_failed';
        this.log?.('AI_DRY_RUN_ERROR', {
          symbol: snapshot.symbol,
          error: this.lastError,
          text: response.text.slice(0, 500),
        });
        this.submitFallbackPolicy(snapshot, 'parse_failed', policyDecision);
        return;
      }

      if (action.action === 'ENTRY' && !action.side) {
        this.lastError = 'ai_invalid_side';
        this.log?.('AI_DRY_RUN_ERROR', { symbol: snapshot.symbol, error: this.lastError, action });
        this.submitFallbackPolicy(snapshot, 'invalid_side', policyDecision);
        return;
      }

      const resolved = this.applyPolicyGuardrails(snapshot, action, policyDecision);
      this.applyResolvedAction(snapshot, resolved.action, {
        source: resolved.source,
        policy: policyDecision,
      });
      this.lastDecisionTs.set(snapshot.symbol, nowMs);
      this.lastError = null;
    } catch (error: any) {
      this.lastError = error?.message || 'ai_decision_failed';
      this.log?.('AI_DRY_RUN_ERROR', { symbol: snapshot.symbol, error: this.lastError });
      this.submitFallbackPolicy(
        snapshot,
        'runtime_error',
        this.policy.decide(snapshot),
        { error: this.lastError }
      );
    } finally {
      this.pending.delete(snapshot.symbol);
    }
  }

  private buildPrompt(snapshot: AIMetricsSnapshot): string {
    const pos = snapshot.position;
    const payload = {
      symbol: snapshot.symbol,
      timestampMs: snapshot.timestampMs,
      market: snapshot.market,
      trades: snapshot.trades,
      openInterest: snapshot.openInterest,
      absorption: snapshot.absorption,
      volatility: snapshot.volatility,
      position: pos
        ? {
            side: pos.side,
            qty: pos.qty,
            entryPrice: pos.entryPrice,
            unrealizedPnlPct: pos.unrealizedPnlPct,
            addsUsed: pos.addsUsed,
        }
        : null,
    };

    return [
      'You are an AI decision engine for a futures paper-trading simulation.',
      'Use only the provided metrics and current position.',
      '',
      'Goal: maximize simulated risk-adjusted returns.',
      '',
      'Return exactly ONE JSON object. No markdown. No extra text.',
      'Allowed actions: HOLD, ENTRY, ADD, REDUCE, EXIT.',
      '',
      'Rules:',
      '- ENTRY requires side LONG or SHORT.',
      '- ADD uses current position direction.',
      '- sizeMultiplier range: 0.1 to 2.0.',
      '- reducePct range: 0.1 to 1.0.',
      '- If signal quality is weak, choose HOLD.',
      '- Avoid repeated HOLD when flat and directional evidence is strong.',
      '',
      'Available metrics:',
      '- market.price, vwap: Price level',
      '- market.delta1s, delta5s, deltaZ: Momentum',
      '- market.cvdSlope, obiWeighted, obiDeep, obiDivergence: Order flow',
      '- trades.printsPerSecond, burstCount, burstSide: Activity',
      '- openInterest.oiChangePct: Market positioning',
      '- absorption.value, side: Large order absorption',
      '- volatility: Risk level',
      '',
      'Current position:',
      pos
        ? `You have a ${pos.side} position: qty=${pos.qty}, entry=${pos.entryPrice}, PnL=${pos.unrealizedPnlPct.toFixed(4)}%`
        : 'No open position.',
      '',
      'Output examples:',
      '{"action":"HOLD"}',
      '{"action":"ENTRY","side":"LONG","sizeMultiplier":0.5,"reason":"..."}',
      '{"action":"ENTRY","side":"SHORT","sizeMultiplier":0.5,"reason":"..."}',
      '{"action":"ADD","sizeMultiplier":0.3,"reason":"..."}',
      '{"action":"REDUCE","reducePct":0.5,"reason":"..."}',
      '{"action":"EXIT","reason":"..."}',
      '',
      'Snapshot:',
      JSON.stringify(payload),
    ].join('\n');
  }

  private parseAction(text: string): AIAction | null {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const toAction = (raw: unknown): AIAction | null => {
      if (!raw || typeof raw !== 'object') return null;
      const parsed = raw as Record<string, unknown>;
      const rawActionValue =
        (typeof parsed.action === 'string' && parsed.action) ||
        (typeof parsed.decision === 'string' && parsed.decision) ||
        (typeof parsed.tradeAction === 'string' && parsed.tradeAction) ||
        (typeof parsed.type === 'string' && parsed.type) ||
        null;
      if (!rawActionValue) return null;

      const rawAction = rawActionValue.trim().toUpperCase();
      let action: AIAction['action'] | null = null;
      let side = normalizeSide(
        (parsed.side as string | undefined) ||
        (parsed.direction as string | undefined) ||
        (parsed.positionSide as string | undefined)
      );

      if (['HOLD', 'ENTRY', 'EXIT', 'REDUCE', 'ADD'].includes(rawAction)) {
        action = rawAction as AIAction['action'];
      } else if (rawAction === 'ENTRY_LONG' || rawAction === 'LONG_ENTRY' || rawAction === 'OPEN_LONG') {
        action = 'ENTRY';
        side = side ?? 'LONG';
      } else if (rawAction === 'ENTRY_SHORT' || rawAction === 'SHORT_ENTRY' || rawAction === 'OPEN_SHORT') {
        action = 'ENTRY';
        side = side ?? 'SHORT';
      } else if (rawAction === 'BUY' || rawAction === 'LONG') {
        action = 'ENTRY';
        side = side ?? 'LONG';
      } else if (rawAction === 'SELL' || rawAction === 'SHORT') {
        action = 'ENTRY';
        side = side ?? 'SHORT';
      } else if (rawAction === 'NOOP' || rawAction === 'WAIT') {
        action = 'HOLD';
      } else {
        return null;
      }

      return {
        action,
        side: side ?? undefined,
        sizeMultiplier: parseFloatSafe(parsed.sizeMultiplier),
        reducePct: parseFloatSafe(parsed.reducePct),
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    };

    const extractFromParsed = (parsed: unknown): AIAction | null => {
      const stack: unknown[] = [parsed];
      const seen = new Set<unknown>();
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object') continue;
        if (seen.has(current)) continue;
        seen.add(current);

        const direct = toAction(current);
        if (direct) return direct;

        if (Array.isArray(current)) {
          for (let i = current.length - 1; i >= 0; i -= 1) {
            stack.push(current[i]);
          }
          continue;
        }

        for (const value of Object.values(current as Record<string, unknown>)) {
          if (value && typeof value === 'object') {
            stack.push(value);
          }
        }
      }
      return null;
    };

    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (value: string) => {
      const raw = value.trim();
      if (!raw) return;
      const normalized = normalizeJsonCandidate(raw);
      for (const candidate of [raw, normalized]) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        candidates.push(candidate);
      }
    };

    pushCandidate(trimmed);

    const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (const match of fenceMatches) {
      if (match[1]) pushCandidate(match[1]);
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      pushCandidate(trimmed.slice(start, end + 1));
    }

    const objectMatches = trimmed.match(/\{[\s\S]*?\}/g);
    if (objectMatches) {
      for (const m of objectMatches) {
        pushCandidate(m);
      }
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const action = extractFromParsed(parsed);
        if (action) return action;
      } catch {
        continue;
      }
    }

    if (/^\s*(HOLD|WAIT|NOOP)\s*$/i.test(trimmed)) {
      return { action: 'HOLD' };
    }
    if (/\b(BUY|LONG)\b/i.test(trimmed)) {
      return { action: 'ENTRY', side: 'LONG' };
    }
    if (/\b(SELL|SHORT)\b/i.test(trimmed)) {
      return { action: 'ENTRY', side: 'SHORT' };
    }

    return null;
  }

  private buildRepairPrompt(rawText: string): string {
    return [
      'Convert the following content into ONE valid JSON action object only.',
      'Allowed action values: HOLD, ENTRY, ADD, REDUCE, EXIT.',
      'For ENTRY include side LONG or SHORT.',
      'Return only JSON with no markdown and no explanation.',
      'Input:',
      rawText.slice(0, 4000),
    ].join('\n');
  }

  private async retryParseAction(snapshot: AIMetricsSnapshot, rawText: string): Promise<AIAction | null> {
    if (!this.config || !this.config.apiKey || !this.config.model) return null;
    try {
      const retryPrompt = this.buildRepairPrompt(rawText);
      const retryResponse = await generateContent({
        apiKey: this.config.apiKey,
        model: this.config.model,
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
      }, retryPrompt);
      this.log?.('AI_GEMINI_RESPONSE', {
        symbol: snapshot.symbol,
        text: retryResponse.text?.slice(0, 300) || null,
        finishReason: retryResponse.meta?.finishReason || null,
        blockReason: retryResponse.meta?.blockReason || null,
        retry: true,
      });
      if (!retryResponse.text) return null;
      return this.parseAction(retryResponse.text);
    } catch {
      return null;
    }
  }

  private submitFallbackPolicy(
    snapshot: AIMetricsSnapshot,
    fallback: 'empty_response' | 'parse_failed' | 'invalid_side' | 'runtime_error',
    policy: AutonomousPolicyDecision,
    details?: Record<string, unknown>
  ): void {
    const action = policy.action;
    const source = action.action === 'HOLD' ? 'policy_fallback_hold' : 'policy_fallback_trade';
    this.applyResolvedAction(snapshot, action, {
      source,
      fallback,
      policy,
      extraMeta: details,
    });
    this.lastDecisionTs.set(snapshot.symbol, snapshot.timestampMs);
    this.log?.('AI_FALLBACK_POLICY', {
      symbol: snapshot.symbol,
      fallback,
      action: action.action,
      side: action.side || null,
      confidence: policy.confidence,
    });
  }

  private applyPolicyGuardrails(
    snapshot: AIMetricsSnapshot,
    aiAction: AIAction,
    policy: AutonomousPolicyDecision
  ): { action: AIAction; source: string } {
    if (!snapshot.position && (aiAction.action === 'ADD' || aiAction.action === 'REDUCE' || aiAction.action === 'EXIT')) {
      return { action: policy.action, source: 'policy_flat_state_override' };
    }

    if (aiAction.action === 'HOLD') {
      const nextHoldStreak = (this.holdStreak.get(snapshot.symbol) || 0) + 1;
      const allowOverride = policy.action.action !== 'HOLD'
        && policy.confidence >= 0.78
        && (nextHoldStreak >= 2 || !snapshot.position);
      if (allowOverride) {
        return { action: policy.action, source: 'policy_override_ai_hold' };
      }
      return { action: aiAction, source: 'ai' };
    }
    return { action: aiAction, source: 'ai' };
  }

  private applyResolvedAction(
    snapshot: AIMetricsSnapshot,
    action: AIAction,
    context: {
      source: string;
      fallback?: string;
      policy?: AutonomousPolicyDecision;
      extraMeta?: Record<string, unknown>;
    }
  ): void {
    if (action.action === 'HOLD') {
      this.holdStreak.set(snapshot.symbol, (this.holdStreak.get(snapshot.symbol) || 0) + 1);
    } else {
      this.holdStreak.set(snapshot.symbol, 0);
    }

    const decision = this.buildDecision(snapshot, action, {
      source: context.source,
      fallback: context.fallback,
      policyConfidence: context.policy?.confidence,
      policyDiagnostics: context.policy?.diagnostics,
      ...(context.extraMeta || {}),
    });
    if (decision.actions.length > 0 || decision.reasons.includes('NOOP')) {
      if (decision.actions.length > 0) {
        this.log?.('AI_SUBMITTING_DECISION', {
          symbol: snapshot.symbol,
          source: context.source,
          actions: decision.actions.map((a) => ({ type: a.type, side: (a as any).side, reason: a.reason })),
          policyConfidence: context.policy?.confidence ?? null,
        });
      }
      this.dryRunSession.submitStrategyDecision(snapshot.symbol, decision, snapshot.timestampMs);
    }
    this.recordDecisionLog(snapshot, decision, action);
  }

  private buildDecision(
    snapshot: AIMetricsSnapshot,
    aiAction: AIAction,
    contextMeta?: Record<string, unknown>
  ): StrategyDecision {
    const actions: StrategyAction[] = [];
    const nowMs = snapshot.timestampMs;
    const regime = snapshot.decision.regime;

    if (aiAction.action === 'HOLD') {
      actions.push({
        type: StrategyActionType.NOOP,
        reason: 'NOOP',
        metadata: {
          ai: true,
          note: aiAction.reason || null,
          ...(contextMeta || {}),
        },
      });
    }

    if (aiAction.action === 'ENTRY' && aiAction.side) {
      actions.push({
        type: StrategyActionType.ENTRY,
        side: aiAction.side as StrategySide,
        reason: 'ENTRY_TR',
        expectedPrice: snapshot.market.price,
        sizeMultiplier: clamp(Number(aiAction.sizeMultiplier ?? 1), 0.1, 2),
        metadata: { ai: true, note: aiAction.reason || null, ...(contextMeta || {}) },
      });
    }

    if (aiAction.action === 'ADD') {
      actions.push({
        type: StrategyActionType.ADD,
        side: undefined,
        reason: 'AI_ADD',
        expectedPrice: snapshot.market.price,
        sizeMultiplier: clamp(Number(aiAction.sizeMultiplier ?? 0.5), 0.1, 2),
        metadata: { ai: true, note: aiAction.reason || null, ...(contextMeta || {}) },
      });
    }

    if (aiAction.action === 'REDUCE') {
      actions.push({
        type: StrategyActionType.REDUCE,
        reason: 'REDUCE_SOFT',
        reducePct: clamp(Number(aiAction.reducePct ?? 0.5), 0.1, 1),
        metadata: { ai: true, note: aiAction.reason || null, ...(contextMeta || {}) },
      });
    }

    if (aiAction.action === 'EXIT') {
      actions.push({
        type: StrategyActionType.EXIT,
        reason: 'EXIT_HARD',
        metadata: { ai: true, note: aiAction.reason || null, ...(contextMeta || {}) },
      });
    }

    if (actions.length === 0 && aiAction.action !== 'HOLD') {
      actions.push({ type: StrategyActionType.NOOP, reason: 'NOOP', metadata: { ai: true, note: 'invalid_action_fallback' } });
    }

    const log: StrategyDecisionLog = {
      timestampMs: nowMs,
      symbol: snapshot.symbol,
      regime,
      gate: { passed: snapshot.decision.gatePassed, reason: null, details: { ai: true } },
      dfs: snapshot.decision.dfs,
      dfsPercentile: snapshot.decision.dfsPercentile,
      volLevel: snapshot.decision.volLevel,
      thresholds: snapshot.decision.thresholds,
      reasons: actions.map((a) => a.reason),
      actions,
      stats: {
        aiDecision: 1,
        policyConfidence: Number(contextMeta?.policyConfidence ?? 0) || null,
      },
    };

    return {
      symbol: snapshot.symbol,
      timestampMs: nowMs,
      regime,
      dfs: snapshot.decision.dfs,
      dfsPercentile: snapshot.decision.dfsPercentile,
      volLevel: snapshot.decision.volLevel,
      gatePassed: snapshot.decision.gatePassed,
      reasons: actions.map((a) => a.reason),
      actions,
      log,
    };
  }

  private recordDecisionLog(snapshot: AIMetricsSnapshot, decision: StrategyDecision, action: AIAction): void {
    if (!this.decisionLog) return;
    const payload: StrategyDecisionLog = {
      ...decision.log,
      stats: {
        ...decision.log.stats,
        aiAction: ['HOLD', 'ENTRY', 'EXIT', 'REDUCE', 'ADD'].indexOf(action.action),
      },
    };
    this.decisionLog.record(payload);
  }
}
