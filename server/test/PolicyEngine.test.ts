import { PolicyEngine } from '../ai/PolicyEngine';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export function runTests() {
  {
    const engine = new PolicyEngine({
      apiKey: '',
      model: '',
      localOnly: true,
      temperature: 0,
      maxOutputTokens: 64,
    }) as any;

    const fallback = engine.hold('llm_unavailable', 0, null);
    assert(fallback.decision.intent === 'HOLD', 'local-only fallback must always hold');
    assert(fallback.source === 'HOLD_FALLBACK', 'hold fallback source must be HOLD_FALLBACK');
  }

  {
    const engine = new PolicyEngine({
      apiKey: 'x',
      model: 'y',
      localOnly: false,
      temperature: 0,
      maxOutputTokens: 64,
    }) as any;

    const valid = engine.validatePolicy(
      {
        intent: 'ADD',
        side: 'LONG',
        riskMultiplier: 0.9,
        confidence: 0.7,
      },
      {
        side: 'LONG',
        qty: 0.1,
        entryPrice: 10,
        unrealizedPnlPct: 0,
        addsUsed: 0,
        timeInPositionMs: 10,
      }
    );
    assert(valid.valid === true, 'valid add policy should pass validation');

    const invalid = engine.validatePolicy(
      {
        intent: 'ENTER',
        side: 'SHORT',
        riskMultiplier: 0.9,
        confidence: 0.7,
      },
      {
        side: 'LONG',
        qty: 0.1,
        entryPrice: 10,
        unrealizedPnlPct: 0,
        addsUsed: 0,
        timeInPositionMs: 10,
      }
    );
    assert(invalid.valid === false, 'enter while in position must be invalid');
  }
}
