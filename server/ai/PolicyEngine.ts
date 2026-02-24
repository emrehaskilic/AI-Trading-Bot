import { generateContent } from './GoogleAIClient';
import { AIMetricsSnapshot } from './types';
import { DeterministicStateSnapshot } from './StateExtractor';

export type PolicyIntent = 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT';
export type PolicySide = 'LONG' | 'SHORT' | null;

export interface PolicyDecision {
  intent: PolicyIntent;
  side: PolicySide;
  riskMultiplier: number;
  confidence: number;
}

export interface PolicyEvaluationInput {
  symbol: string;
  timestampMs: number;
  state: DeterministicStateSnapshot;
  position: AIMetricsSnapshot['position'];
  directionLockBlocked: boolean;
  lockReason?: string | null;
  startedAtMs: number;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  valid: boolean;
  source: 'LLM' | 'LOCAL_POLICY';
  error: string | null;
  latencyMs: number;
  rawText: string | null;
  parsedPolicy: PolicyDecision | null;
}

type LLMCaller = (input: {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  prompt: string;
  responseSchema: Record<string, unknown>;
  abortSignal?: AbortSignal;
  maxHttpAttempts?: number;
  disableHttpRetries?: boolean;
}) => Promise<{ text: string | null }>;
export type PolicyLLMCaller = LLMCaller;

type PolicyEngineConfig = {
  apiKey?: string;
  model?: string;
  temperature: number;
  maxOutputTokens: number;
  localOnly: boolean;
  llmCaller?: LLMCaller;
  testLocalPolicyEnabled?: boolean;
};

const POLICY_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  required: ['intent', 'side', 'riskMultiplier', 'confidence'],
  properties: {
    intent: { type: 'STRING', enum: ['HOLD', 'ENTER', 'ADD', 'REDUCE', 'EXIT'] },
    side: { type: 'STRING', enum: ['LONG', 'SHORT'], nullable: true },
    riskMultiplier: { type: 'NUMBER' },
    confidence: { type: 'NUMBER' },
  },
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const HOLD_DECISION: PolicyDecision = {
  intent: 'HOLD',
  side: null,
  riskMultiplier: 1,
  confidence: 0,
};

const DEFAULT_POLICY_TIMEOUT_MS = 2_200;
const MIN_POLICY_TIMEOUT_MS = 800;
const MAX_POLICY_TIMEOUT_MS = 10_000;

export class PolicyEngine {
  private readonly llmCaller: LLMCaller;

  constructor(private readonly config: PolicyEngineConfig) {
    this.llmCaller = config.llmCaller || (async (input) => generateContent(
      {
        apiKey: input.apiKey,
        model: input.model,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        responseSchema: input.responseSchema,
        abortSignal: input.abortSignal,
        maxHttpAttempts: input.maxHttpAttempts,
        disableHttpRetries: input.disableHttpRetries,
      },
      input.prompt
    ));
  }

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
    const localPolicyEnabled = Boolean(this.config.testLocalPolicyEnabled);
    if (localPolicyEnabled && this.config.localOnly) {
      return this.localPolicy(input);
    }

    if (!this.config.apiKey || !this.config.model) {
      return this.hold('LLM_NOT_CONFIGURED', 0, null);
    }

    const timeoutMs = this.resolveTimeoutMs();
    const started = Date.now();

    const tryGenerate = async (prompt: string): Promise<{ text: string | null }> => {
      const abortController = new AbortController();
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          abortController.abort();
          reject(new Error('policy_timeout'));
        }, timeoutMs);
      });

      try {
        return await Promise.race([
          this.llmCaller({
            apiKey: this.config.apiKey as string,
            model: this.config.model as string,
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxOutputTokens,
            prompt,
            responseSchema: POLICY_SCHEMA,
            abortSignal: abortController.signal,
            maxHttpAttempts: 1,
            disableHttpRetries: true,
          }),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    };

    let rawText: string | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const prompt = attempt === 0
          ? this.buildPrompt(input)
          : this.buildRetryPrompt(input);
        const response = await tryGenerate(prompt);
        rawText = response.text || null;
        const parsed = this.parsePolicyJson(rawText);
        if (!parsed) {
          lastError = 'invalid_policy_json';
          if (attempt < 1) continue;
          break;
        }
        const validated = this.validatePolicy(parsed, input.position);
        if (!validated.valid) {
          lastError = validated.error;
          if (attempt < 1) continue;
          break;
        }

        const latencyMs = Math.max(0, Date.now() - started);
        return {
          decision: validated.decision,
          valid: true,
          source: 'LLM',
          error: null,
          latencyMs,
          rawText,
          parsedPolicy: validated.decision,
        };
      } catch (e: any) {
        lastError = this.normalizePolicyError(e);
        if (!this.isRetryableLlmError(lastError) || attempt >= 1) break;
      }
    }

    return this.hold(lastError || 'policy_eval_failed', Math.max(0, Date.now() - started), rawText);
  }

  private resolveTimeoutMs(): number {
    const rawText = String(process.env.AI_POLICY_TIMEOUT_MS ?? '').trim();
    if (!rawText) {
      return DEFAULT_POLICY_TIMEOUT_MS;
    }
    const rawValue = Number(rawText);
    if (!Number.isFinite(rawValue)) {
      return DEFAULT_POLICY_TIMEOUT_MS;
    }
    return Math.trunc(clamp(rawValue, MIN_POLICY_TIMEOUT_MS, MAX_POLICY_TIMEOUT_MS));
  }

  private buildPrompt(input: PolicyEvaluationInput): string {
    const payload = {
      symbol: input.symbol,
      timestampMs: input.timestampMs,
      state: {
        flowState: input.state.flowState,
        regimeState: input.state.regimeState,
        derivativesState: input.state.derivativesState,
        toxicityState: input.state.toxicityState,
        executionState: input.state.executionState,
        stateConfidence: input.state.stateConfidence,
        directionalBias: input.state.directionalBias,
        cvdSlopeSign: input.state.cvdSlopeSign,
        oiDirection: input.state.oiDirection,
        volatilityPercentile: input.state.volatilityPercentile,
        expectedSlippageBps: input.state.expectedSlippageBps,
        spreadBps: input.state.spreadBps,
      },
      position: input.position
        ? {
          side: input.position.side,
          qty: input.position.qty,
          entryPrice: input.position.entryPrice,
          unrealizedPnlPct: input.position.unrealizedPnlPct,
          addsUsed: input.position.addsUsed,
        }
        : null,
      directionLockBlocked: input.directionLockBlocked,
      directionLockReason: input.lockReason || null,
    };

    return [
      'Return ONLY minified JSON. No markdown, no prose, no code fences.',
      'Required schema:',
      '{"intent":"HOLD|ENTER|ADD|REDUCE|EXIT","side":"LONG|SHORT|null","riskMultiplier":number,"confidence":number}',
      'Rules:',
      '- ENTER only when position is null.',
      '- ADD only when position exists and side matches position side.',
      '- REDUCE/EXIT only when position exists.',
      '- HOLD must use side=null.',
      '- Output must contain exactly these keys: intent, side, riskMultiplier, confidence.',
      'Input:',
      JSON.stringify(payload),
    ].join('\n');
  }

  private buildRetryPrompt(input: PolicyEvaluationInput): string {
    const payload = {
      symbol: input.symbol,
      timestampMs: input.timestampMs,
      position: input.position
        ? {
          side: input.position.side,
          qty: input.position.qty,
          entryPrice: input.position.entryPrice,
          unrealizedPnlPct: input.position.unrealizedPnlPct,
          addsUsed: input.position.addsUsed,
        }
        : null,
      state: {
        directionalBias: input.state.directionalBias,
        regimeState: input.state.regimeState,
        flowState: input.state.flowState,
        derivativesState: input.state.derivativesState,
        executionState: input.state.executionState,
        stateConfidence: input.state.stateConfidence,
        volatilityPercentile: input.state.volatilityPercentile,
      },
    };

    return [
      'Output must be a single JSON object.',
      'First character must be { and last character must be }.',
      'Do NOT include backticks, "Here is", comments, or extra text.',
      'JSON keys exactly: intent, side, riskMultiplier, confidence.',
      'Allowed intent: HOLD|ENTER|ADD|REDUCE|EXIT.',
      'Allowed side: LONG|SHORT|null.',
      'If uncertain, return {"intent":"HOLD","side":null,"riskMultiplier":1,"confidence":0}.',
      JSON.stringify(payload),
    ].join('\n');
  }

  private parsePolicyJson(text: string | null): Record<string, unknown> | null {
    if (!text) return null;
    const trimmed = this.normalizePolicyText(text);
    if (!trimmed) return null;
    const candidates = this.collectJsonCandidates(trimmed);
    for (const candidate of candidates) {
      const parsed = this.tryJson(candidate);
      if (parsed) return parsed;
    }

    const looseParsed = this.tryLoosePolicyParse(trimmed);
    if (looseParsed) return looseParsed;

    return null;
  }

  private normalizePolicyText(rawText: string): string {
    return String(rawText || '')
      .replace(/^\uFEFF/, '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();
  }

  private collectJsonCandidates(text: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: string | null): void => {
      const next = String(value || '').trim();
      if (!next || seen.has(next)) return;
      seen.add(next);
      out.push(next);
    };

    push(text);

    const fencedComplete = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedComplete?.[1]) {
      push(fencedComplete[1]);
    }

    const fencedOpen = text.match(/```(?:json)?\s*([\s\S]*)$/i);
    if (fencedOpen?.[1]) {
      push(fencedOpen[1]);
    }

    const strictObject = this.extractJsonObject(text, false);
    push(strictObject);
    const repairedObject = this.extractJsonObject(text, true);
    push(repairedObject);

    return out;
  }

  private extractJsonObject(text: string, allowRepair: boolean): string | null {
    const start = text.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
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
          return text.slice(start, i + 1).trim();
        }
      }
    }

    if (!allowRepair || depth <= 0) {
      return null;
    }

    const tail = text.slice(start).trim();
    if (!tail) return null;
    return `${tail}${'}'.repeat(Math.min(depth, 4))}`;
  }

  private tryJson(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      const withoutTrailingCommas = raw.replace(/,\s*([}\]])/g, '$1');
      if (withoutTrailingCommas !== raw) {
        try {
          const parsed = JSON.parse(withoutTrailingCommas);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
          return parsed as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private tryLoosePolicyParse(text: string): Record<string, unknown> | null {
    const source = String(text || '');
    if (!source) return null;

    const intentMatch = source.match(/\b(?:intent|action)\b\s*[:=]?\s*["']?(HOLD|ENTER|ADD|REDUCE|EXIT)["']?/i)
      || source.match(/\b(HOLD|ENTER|ADD|REDUCE|EXIT)\b/i);
    if (!intentMatch) return null;
    const intent = String(intentMatch[1] || '').toUpperCase();
    if (!intent) return null;

    const sideMatch = source.match(/\bside\b\s*[:=]?\s*["']?(LONG|SHORT|NULL)["']?/i);
    const sideRaw = String(sideMatch?.[1] || '').toUpperCase();
    const side: 'LONG' | 'SHORT' | null =
      sideRaw === 'LONG' || sideRaw === 'SHORT'
        ? sideRaw
        : null;

    const riskMatch = source.match(/\brisk(?:Multiplier)?\b\s*[:=]?\s*([-+]?\d*\.?\d+)/i);
    const confMatch = source.match(/\bconfidence\b\s*[:=]?\s*([-+]?\d*\.?\d+)/i);
    const riskMultiplier = Number.isFinite(Number(riskMatch?.[1])) ? Number(riskMatch?.[1]) : 1;
    const confidence = Number.isFinite(Number(confMatch?.[1])) ? Number(confMatch?.[1]) : 0;

    return {
      intent,
      side: intent === 'HOLD' ? null : side,
      riskMultiplier,
      confidence,
    };
  }

  private validatePolicy(
    raw: Record<string, unknown>,
    position: AIMetricsSnapshot['position']
  ): { valid: boolean; decision: PolicyDecision; error: string | null } {
    const intent = String(raw.intent || '').trim().toUpperCase() as PolicyIntent;
    const allowedIntents: PolicyIntent[] = ['HOLD', 'ENTER', 'ADD', 'REDUCE', 'EXIT'];
    if (!allowedIntents.includes(intent)) {
      return { valid: false, decision: HOLD_DECISION, error: 'invalid_intent' };
    }

    const sideRaw = String(raw.side ?? '').trim().toUpperCase();
    const side: PolicySide = sideRaw === 'LONG' || sideRaw === 'SHORT' ? sideRaw : null;
    const riskMultiplier = clamp(Number(raw.riskMultiplier ?? 1), 0.2, 2.0);
    const confidence = clamp(Number(raw.confidence ?? 0), 0, 1);

    if (intent === 'HOLD' && side !== null) {
      return { valid: false, decision: HOLD_DECISION, error: 'hold_requires_null_side' };
    }

    if (intent === 'ENTER' && !side) {
      return { valid: false, decision: HOLD_DECISION, error: 'enter_requires_side' };
    }

    if (intent === 'ENTER' && position) {
      return { valid: false, decision: HOLD_DECISION, error: 'enter_requires_flat' };
    }

    if (intent === 'ADD') {
      if (!position) {
        return { valid: false, decision: HOLD_DECISION, error: 'add_requires_position' };
      }
      if (!side || side !== position.side) {
        return { valid: false, decision: HOLD_DECISION, error: 'add_requires_same_side' };
      }
    }

    if (intent === 'REDUCE') {
      if (!position) {
        return { valid: false, decision: HOLD_DECISION, error: 'reduce_requires_position' };
      }
    }

    if (intent === 'EXIT' && !position) {
      return { valid: false, decision: HOLD_DECISION, error: 'exit_requires_position' };
    }

    const decision: PolicyDecision = {
      intent,
      side,
      riskMultiplier,
      confidence,
    };

    return { valid: true, decision, error: null };
  }

  private normalizePolicyError(error: unknown): string {
    const message = String((error as any)?.message || 'policy_eval_failed').trim();
    return message || 'policy_eval_failed';
  }

  private isRetryableLlmError(message: string): boolean {
    const text = String(message || '').toLowerCase();
    return text.includes('timeout')
      || text.includes('network')
      || text.includes('fetch failed')
      || text.includes('econnreset')
      || text.includes('etimedout')
      || text.includes('enotfound')
      || text.includes('ai_http_429')
      || text.includes('ai_http_503')
      || text.includes('ai_http_504');
  }

  private hold(error: string, latencyMs: number, rawText: string | null): PolicyEvaluationResult {
    return {
      decision: { ...HOLD_DECISION },
      valid: false,
      source: 'LLM',
      error,
      latencyMs,
      rawText,
      parsedPolicy: null,
    };
  }

  private localPolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
    const state = input.state;
    const position = input.position;

    const canEnter =
      state.stateConfidence >= 0.55
      && state.executionState !== 'LOW_RESILIENCY'
      && state.toxicityState !== 'TOXIC'
      && state.volatilityPercentile < 97
      && state.directionalBias !== 'NEUTRAL';

    if (!position) {
      if (canEnter) {
        const entrySide: PolicySide = state.directionalBias === 'LONG' || state.directionalBias === 'SHORT'
          ? state.directionalBias
          : null;
        if (!entrySide) {
          return {
            decision: { ...HOLD_DECISION },
            valid: true,
            source: 'LOCAL_POLICY',
            error: null,
            latencyMs: 0,
            rawText: null,
            parsedPolicy: null,
          };
        }
        return {
          decision: {
            intent: 'ENTER',
            side: entrySide,
            riskMultiplier: state.regimeState === 'TREND' ? 1 : 0.75,
            confidence: clamp(state.stateConfidence, 0.45, 0.95),
          },
          valid: true,
          source: 'LOCAL_POLICY',
          error: null,
          latencyMs: 0,
          rawText: null,
          parsedPolicy: null,
        };
      }

      return {
        decision: { ...HOLD_DECISION },
        valid: true,
        source: 'LOCAL_POLICY',
        error: null,
        latencyMs: 0,
        rawText: null,
        parsedPolicy: null,
      };
    }

    const side = position.side;
    const sameBias = state.directionalBias === side || state.directionalBias === 'NEUTRAL';
    const trendIntact =
      (state.regimeState === 'TREND' || state.regimeState === 'TRANSITION')
      && sameBias
      && state.executionState !== 'LOW_RESILIENCY';

    const lowExecutionRisk =
      state.executionState === 'LOW_RESILIENCY'
      && (state.expectedSlippageBps >= 8 || state.spreadBps >= 12);
    const hardRisk =
      state.volatilityPercentile >= 97
      || lowExecutionRisk;

    if (hardRisk) {
      return {
        decision: {
          intent: 'REDUCE',
          side,
          riskMultiplier: 0.3,
          confidence: 0.75,
        },
        valid: true,
        source: 'LOCAL_POLICY',
        error: null,
        latencyMs: 0,
        rawText: null,
        parsedPolicy: null,
      };
    }

    const opposingBias = state.directionalBias !== 'NEUTRAL' && state.directionalBias !== side;
    const opposingPressure =
      side === 'LONG'
        ? state.cvdSlopeSign === 'DOWN' && state.oiDirection === 'DOWN'
        : state.cvdSlopeSign === 'UP' && state.oiDirection === 'UP';
    const trendBroken =
      (opposingBias
        && opposingPressure
        && (
          state.flowState === 'EXHAUSTION'
          || state.regimeState === 'TRANSITION'
          || state.regimeState === 'VOL_EXPANSION'
        ));

    if (trendBroken) {
      return {
        decision: {
          intent: 'EXIT',
          side,
          riskMultiplier: 0.4,
          confidence: 0.7,
        },
        valid: true,
        source: 'LOCAL_POLICY',
        error: null,
        latencyMs: 0,
        rawText: null,
        parsedPolicy: null,
      };
    }

    if (trendIntact) {
      const canAdd =
        state.stateConfidence >= 0.75
        && state.flowState === 'EXPANSION'
        && state.regimeState === 'TREND'
        && state.derivativesState === (side === 'LONG' ? 'LONG_BUILD' : 'SHORT_BUILD')
        && state.volatilityPercentile < 90;

      if (canAdd) {
        return {
          decision: {
            intent: 'ADD',
            side,
            riskMultiplier: 0.55,
            confidence: clamp(state.stateConfidence, 0.6, 0.95),
          },
          valid: true,
          source: 'LOCAL_POLICY',
          error: null,
          latencyMs: 0,
          rawText: null,
          parsedPolicy: null,
        };
      }

      return {
        decision: {
          intent: 'HOLD',
          side: null,
          riskMultiplier: 0.45,
          confidence: clamp(state.stateConfidence, 0.5, 0.95),
        },
        valid: true,
        source: 'LOCAL_POLICY',
        error: null,
        latencyMs: 0,
        rawText: null,
        parsedPolicy: null,
      };
    }

    return {
      decision: {
        intent: 'HOLD',
        side: null,
        riskMultiplier: 0.35,
        confidence: clamp(state.stateConfidence, 0.35, 0.85),
      },
      valid: true,
      source: 'LOCAL_POLICY',
      error: null,
      latencyMs: 0,
      rawText: null,
      parsedPolicy: null,
    };
  }
}
