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
  source: 'LLM' | 'LOCAL_POLICY' | 'HOLD_FALLBACK';
  error: string | null;
  latencyMs: number;
  rawText: string | null;
}

type PolicyEngineConfig = {
  apiKey?: string;
  model?: string;
  temperature: number;
  maxOutputTokens: number;
  localOnly: boolean;
  fallbackLocalOnLLMFailure?: boolean;
};

const POLICY_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  required: ['intent', 'side', 'riskMultiplier', 'confidence'],
  properties: {
    intent: { type: 'STRING', enum: ['HOLD', 'ENTER', 'ADD', 'REDUCE', 'EXIT'] },
    side: { type: 'STRING', enum: ['LONG', 'SHORT'] },
    riskMultiplier: { type: 'NUMBER' },
    confidence: { type: 'NUMBER' },
  },
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const HOLD_DECISION: PolicyDecision = {
  intent: 'HOLD',
  side: null,
  riskMultiplier: 0.2,
  confidence: 0,
};

export class PolicyEngine {
  constructor(private readonly config: PolicyEngineConfig) {}

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
    const fallbackLocalOnFailure =
      this.config.fallbackLocalOnLLMFailure != null
        ? Boolean(this.config.fallbackLocalOnLLMFailure)
        : !['0', 'false', 'no', 'off'].includes(String(process.env.AI_LLM_FAILURE_USE_LOCAL_POLICY || 'true').trim().toLowerCase());

    if (this.config.localOnly || !this.config.apiKey || !this.config.model) {
      return this.localPolicy(input);
    }

    const timeoutMs = this.resolveTimeout(input);
    const prompt = this.buildPrompt(input);
    const started = Date.now();

    const tryGenerate = async (): Promise<{ text: string | null }> => {
      return await Promise.race([
        generateContent(
          {
            apiKey: this.config.apiKey as string,
            model: this.config.model as string,
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxOutputTokens,
            responseSchema: POLICY_SCHEMA,
          },
          prompt
        ),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            clearTimeout(timer);
            reject(new Error('policy_timeout'));
          }, timeoutMs);
        }),
      ]);
    };

    let rawText: string | null = null;
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await tryGenerate();
        rawText = response.text || null;
        const parsed = this.parsePolicyJson(rawText);
        if (!parsed) {
          lastError = 'invalid_policy_json';
          continue;
        }
        const validated = this.validatePolicy(parsed, input.position);
        if (!validated.valid) {
          lastError = validated.error;
          continue;
        }

        const latencyMs = Math.max(0, Date.now() - started);
        return {
          decision: validated.decision,
          valid: true,
          source: 'LLM',
          error: null,
          latencyMs,
          rawText,
        };
      } catch (e: any) {
        lastError = String(e?.message || 'policy_eval_failed');
      }
    }

    if (fallbackLocalOnFailure) {
      const local = this.localPolicy(input);
      return {
        ...local,
        source: 'LOCAL_POLICY',
        error: null,
        latencyMs: Math.max(0, Date.now() - started),
        rawText,
      };
    }

    return this.hold(lastError || 'policy_eval_failed', Math.max(0, Date.now() - started), rawText);
  }

  private resolveTimeout(input: PolicyEvaluationInput): number {
    const elapsed = Math.max(0, input.timestampMs - input.startedAtMs);
    const bootWindowMs = Math.max(1_000, Number(process.env.AI_BOOT_TIMEOUT_WINDOW_MS || 20_000));
    const bootTimeoutMs = Math.max(1_000, Number(process.env.AI_POLICY_TIMEOUT_BOOT_MS || 1_800));
    const steadyTimeoutMs = Math.max(700, Number(process.env.AI_POLICY_TIMEOUT_MS || 1_400));
    return elapsed <= bootWindowMs ? bootTimeoutMs : steadyTimeoutMs;
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
      'You are a policy engine. Return JSON only, no text.',
      'Allowed output:',
      '{"intent":"HOLD|ENTER|ADD|REDUCE|EXIT","side":"LONG|SHORT|null","riskMultiplier":0.2-1.2,"confidence":0.0-1.0}',
      'Hard constraints:',
      '- ENTER only if flat',
      '- ADD only if same direction position exists',
      '- REDUCE must be partial',
      '- EXIT is full close intent',
      '- Never output reasoning or extra keys',
      'Input:',
      JSON.stringify(payload),
    ].join('\n');
  }

  private parsePolicyJson(text: string | null): Record<string, unknown> | null {
    if (!text) return null;
    const trimmed = String(text).trim();
    if (!trimmed) return null;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ? fenced[1].trim() : trimmed;

    const direct = this.tryJson(candidate);
    if (direct) return direct;

    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return this.tryJson(candidate.slice(firstBrace, lastBrace + 1));
    }

    return null;
  }

  private tryJson(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
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
    const riskMultiplier = clamp(Number(raw.riskMultiplier ?? 0.2), 0.2, 1.2);
    const confidence = clamp(Number(raw.confidence ?? 0), 0, 1);

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

  private hold(error: string, latencyMs: number, rawText: string | null): PolicyEvaluationResult {
    return {
      decision: { ...HOLD_DECISION },
      valid: false,
      source: 'HOLD_FALLBACK',
      error,
      latencyMs,
      rawText,
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
        };
      }

      return {
        decision: { ...HOLD_DECISION },
        valid: true,
        source: 'LOCAL_POLICY',
        error: null,
        latencyMs: 0,
        rawText: null,
      };
    }

    const side = position.side;
    const sameBias = state.directionalBias === side || state.directionalBias === 'NEUTRAL';
    const trendIntact =
      (state.regimeState === 'TREND' || state.regimeState === 'TRANSITION')
      && sameBias
      && state.executionState !== 'LOW_RESILIENCY';

    const hardRisk =
      state.executionState === 'LOW_RESILIENCY'
      || state.volatilityPercentile >= 97;

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
    };
  }
}
