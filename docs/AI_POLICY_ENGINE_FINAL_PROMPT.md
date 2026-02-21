ROLE:
You are a senior quant engineer + backend architect.

You will refactor the AI trading system into a modular AI Policy Engine with deterministic state extraction and deterministic risk/execution governance.

MANDATORY:
- LIMIT-only execution for AI path.
- No fallback trading on invalid/failed LLM output.
- AI_UNRESTRICTED_MODE cannot bypass governance.
- Production-grade TypeScript only.

PHASE 0 — HARD RESET
1) Remove legacy AI strategy/fallback heuristics.
2) Remove hardcoded signal-strength entry/exit heuristics.
3) Remove legacy guardrail branches that bypass deterministic control.
4) If LLM fails/invalid => HOLD.

PHASE 1 — STARTUP
- Evaluate immediately after first valid state snapshot.
- Readiness required: orderbook + OI + volatility state available.
- Max warmup 2 seconds.
- Entry allowed only when stateConfidence >= 0.62 and startup safety filters pass:
  - ExecutionState == HEALTHY
  - ToxicityState != TOXIC
  - volatilityPercentile < 90

PHASE 2 — ARCHITECTURE
LAYER 1: Deterministic StateExtractor
- Raw metrics -> structured states only:
  FlowState: EXPANSION | EXHAUSTION | ABSORPTION | NEUTRAL
  RegimeState: TREND | CHOP | TRANSITION | VOL_EXPANSION
  DerivativesState: LONG_BUILD | SHORT_BUILD | DELEVERAGING | SQUEEZE_RISK
  ToxicityState: CLEAN | AGGRESSIVE | TOXIC
  ExecutionState: HEALTHY | WIDENING_SPREAD | LOW_RESILIENCY
- No raw metrics directly to AI.
- Hysteresis: 2 confirmations for state change, except critical risk states.

LAYER 2: AI PolicyEngine
- Input: structured states + position snapshot only.
- Output strict JSON only:
{
  "intent": "HOLD|ENTER|ADD|REDUCE|EXIT",
  "side": "LONG|SHORT|null",
  "riskMultiplier": 0.2-1.2,
  "confidence": 0.0-1.0
}
Rules:
- ENTER only if flat.
- ADD only if same-side position exists.
- REDUCE partial.
- EXIT full.
- AI cannot define order type/price.
- No free-form reasoning output.
LLM behavior:
- Timeout: boot phase 1200-1500ms; steady state 800ms.
- Retry once.
- Invalid/timeout => HOLD.

LAYER 3: Deterministic RiskGovernor
Hard constraints:
1) maxPositionNotional = initialMarginUsdt * leverage
2) daily loss cap (persistent day-start equity, UTC rollover)
3) volatility limiter (>=95 hard block enter/add; 90-95 haircut)
4) toxicity limiter
5) slippage limiter
6) concave sizing

Sizing must use:
- baseNotional = maxPositionNotional * baseEntryPct
- baseEntryPct configurable (0.25-0.55)
- equityGrowthFactor = max(0, (equity - startEquity)/startEquity)
- sizeNotional = baseNotional * (1 + ln(1 + 4*equityGrowthFactor)) * riskMultiplier
- clamp by maxPositionNotional and symbol precision

ANTI-FLIP DIRECTION LOCK
- No auto close-to-reverse.
- Reversal allowed only if DirectionLock passes.
- Require at least 3/4 confirmations:
  1) RegimeState change
  2) FlowState change
  3) CVD slope sign flip
  4) OI direction flip
- Enforce min flip cooldown and confirmation TTL window.

EXECUTION (LIMIT ONLY)
- ENTRY/ADD: LIMIT + postOnly=true mandatory.
- On postOnly reject: bounded reprice; if still poor => HOLD.
- REDUCE/EXIT: LIMIT IOC reduceOnly.
- Poor execution conditions => HOLD.
- At most 1 live working order per symbol per side.
- Reprice must respect cancel-ack -> replace sequence.

NO FALLBACK TRADING
- LLM invalid/fail => HOLD only.
- No deterministic auto-entry fallback.

TEST/DoD
- Unit: StateExtractor, PolicyEngine parse/validation, RiskGovernor overrides, DirectionLock.
- Integration:
  - boot-to-first-eval under 2s
  - invalid LLM => no trade
  - AI path emits no MARKET entry/add orders
  - reversal suppression works

OUTPUT
- Refactored AIDryRunController
- New StateExtractor/PolicyEngine/RiskGovernor/DirectionLock modules
- Updated execution logic
- Updated tests
