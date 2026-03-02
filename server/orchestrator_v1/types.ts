import { OrchestratorV1Params } from './params';

export type OrchestratorV1Intent = 'HOLD' | 'ENTRY' | 'ADD' | 'EXIT_RISK' | 'EXIT_FLIP';
export type OrchestratorV1Side = 'BUY' | 'SELL';
export type OrchestratorV1CvdState = 'BUY' | 'SELL' | 'NEUTRAL';
export type OrchestratorV1AtrSource = 'MICRO_ATR' | 'BACKFILL_ATR' | 'UNKNOWN';

export interface OrchestratorV1BtcContext {
  h1BarStartMs: number | null;
  h4BarStartMs: number | null;
  h1StructureUp: boolean;
  h1StructureDn: boolean;
  h4StructureUp: boolean;
  h4StructureDn: boolean;
  trendiness: number;
  chop: number;
}

export interface OrchestratorV1DryRunPositionSnapshot {
  hasPosition: boolean;
  side: 'LONG' | 'SHORT' | null;
  qty: number;
  entryPrice: number;
  notional: number;
  addsUsed: number;
}

export interface OrchestratorV1Input {
  symbol: string;
  nowMs: number;
  price: number;
  bestBid: number | null;
  bestAsk: number | null;
  spreadPct: number | null; // ratio
  printsPerSecond: number;
  deltaZ: number;
  cvdSlope: number;
  cvdTf5mState: OrchestratorV1CvdState;
  obiDeep: number;
  obiWeighted: number;
  trendinessScore: number;
  chopScore: number;
  volOfVol: number;
  realizedVol1m: number;
  atr3m: number;
  atrSource: OrchestratorV1AtrSource;
  orderbookIntegrityLevel: number;
  oiChangePct: number | null;
  sessionVwapValue: number | null;
  htfH1BarStartMs: number | null;
  htfH1SwingLow?: number | null;
  htfH1SwingHigh?: number | null;
  htfH1StructureBreakUp?: boolean;
  htfH1StructureBreakDn?: boolean;
  htfH4BarStartMs: number | null;
  m15SwingLow?: number | null;
  m15SwingHigh?: number | null;
  superScalpEnabled?: boolean | null;
  backfillDone: boolean;
  barsLoaded1m: number;
  btcContext?: OrchestratorV1BtcContext | null;
  /** Derived at runtime: true only when BTCUSDT is in activeSymbols and cross-market env is enabled. */
  crossMarketActive?: boolean | null;
  /** P0: DryRun position snapshot for this symbol (single source of truth) */
  dryRunPosition?: OrchestratorV1DryRunPositionSnapshot | null;
  /** P1: BTC DryRun position for anchor-side derivation in NEUTRAL btcBias */
  btcDryRunPosition?: OrchestratorV1DryRunPositionSnapshot | null;
}

export interface OrchestratorV1GateView {
  passed: boolean;
  reason: string | null;
  checks: Record<string, boolean>;
}

export interface OrchestratorV1ReadinessView {
  ready: boolean;
  reasons: string[];
}

export interface OrchestratorV1Order {
  id: string;
  kind: 'MAKER' | 'TAKER_ENTRY_FALLBACK' | 'TAKER_RISK_EXIT';
  side: OrchestratorV1Side;
  qty: number;
  notionalPct: number;
  price: number | null;
  postOnly: boolean;
  ttlMs: number;
  repriceMs: number;
  maxReprices: number;
  repriceAttempt: number;
  role: 'ENTRY_L1' | 'ENTRY_L2' | 'ENTRY_FALLBACK' | 'ADD_1' | 'ADD_2' | 'EXIT_RISK_MAKER' | 'EXIT_RISK_TAKER';
}

export interface OrchestratorV1ChaseView {
  active: boolean;
  startedAtMs: number | null;
  expiresAtMs: number | null;
  repriceMs: number;
  maxReprices: number;
  repricesUsed: number;
  chaseMaxSeconds: number;
  ttlMs: number;
}

// ── NEW: per-symbol chase debug view exposed in decision ──────────────────────
export interface OrchestratorV1ChaseDebugView {
  chaseActive: boolean;
  chaseStartTs: number | null;
  chaseElapsedMs: number;
  chaseAttempts: number;
  chaseTimedOut: boolean;
  impulse: boolean;
  fallbackEligible: boolean;
  fallbackBlockedReason: 'NONE' | 'NO_TIMEOUT' | 'IMPULSE_FALSE' | 'GATES_FALSE';
}

export interface OrchestratorV1PositionView {
  isOpen: boolean;
  qty: number;
  entryVwap: number | null;
  baseQty: number;
  addsUsed: number;
  lastAddTs: number | null;
  cooldownUntilTs: number;
  atr3m: number;
  atrSource: OrchestratorV1AtrSource;
}

export interface OrchestratorV1AddView {
  triggered: boolean;
  step: 1 | 2 | null;
  gatePassed: boolean;
  rateLimitPassed: boolean;
  thresholdPrice: number | null;
}

export interface OrchestratorV1ExitRiskView {
  triggered: boolean;
  triggeredThisTick: boolean;
  reason: 'REGIME' | 'FLOW_FLIP' | 'INTEGRITY' | 'CROSSMARKET_MISMATCH' | null;
  makerAttemptsUsed: number;
  takerUsed: boolean;
}

export interface OrchestratorV1Decision {
  symbol: string;
  timestampMs: number;
  intent: OrchestratorV1Intent;
  side: OrchestratorV1Side | null;
  readiness: OrchestratorV1ReadinessView;
  gateA: OrchestratorV1GateView;
  gateB: OrchestratorV1GateView;
  gateC: OrchestratorV1GateView;
  allGatesPassed: boolean;
  impulse: {
    passed: boolean;
    checks: {
      printsPerSecond: boolean;
      deltaZ: boolean;
      spread: boolean;
    };
  };
  add: OrchestratorV1AddView;
  exitRisk: OrchestratorV1ExitRiskView;
  position: OrchestratorV1PositionView;
  orders: OrchestratorV1Order[];
  chase: OrchestratorV1ChaseView;
  // ── NEW ──────────────────────────────────────────────────────────────────────
  chaseDebug: OrchestratorV1ChaseDebugView;
  crossMarketBlockReason?: {
    refSymbol: string;
    btcBias: 'LONG' | 'SHORT' | 'NEUTRAL';
    anchorSide: 'BUY' | 'SELL' | 'NONE';
    anchorMode: 'BIAS' | 'ANCHOR_POSITION' | 'NONE';
    candidateSymbol: string;
    candidateSide: 'BUY' | 'SELL';
    h1BarStartMs: number | null;
    h4BarStartMs: number | null;
    h1Up: boolean;
    h1Dn: boolean;
    h4Up: boolean;
    h4Dn: boolean;
    btcHasPosition: boolean;
  } | null;
  telemetry: {
    sideFlipCount5m: number;
    sideFlipPerMin: number;
    allGatesTrueCount5m: number;
    entryIntentCount5m: number;
    smoothed: {
      deltaZ: number;
      cvdSlope: number;
      obiWeighted: number;
    };
    hysteresis: {
      confirmCountLong: number;
      confirmCountShort: number;
      entryConfirmCount: number;
    };
    // ── NEW: aggregate chase counters ────────────────────────────────────────
    chase: {
      chaseStartedCount: number;
      chaseTimedOutCount: number;
      chaseElapsedMaxMs: number;
      fallbackEligibleCount: number;
      fallbackTriggeredCount: number;
      fallbackBlocked_NO_TIMEOUT: number;
      fallbackBlocked_IMPULSE_FALSE: number;
      fallbackBlocked_GATES_FALSE: number;
    };
    crossMarket: {
      crossMarketVetoCount: number;
      crossMarketNeutralCount: number;
      crossMarketAllowedCount: number;
      active: boolean;
      mode: 'hard_veto' | 'soft_bias' | 'DISABLED_NO_BTC';
      disableReason: 'BTC_NOT_SELECTED' | 'CONFIG_DISABLED' | null;
      anchorSide: 'BUY' | 'SELL' | 'NONE';
      anchorMode: 'BIAS' | 'ANCHOR_POSITION' | 'NONE';
      btcHasPosition: boolean;
      mismatchActive: boolean;
      mismatchSinceMs: number | null;
      exitTriggeredCount: number;
    };
    lastExitReasonCode: 'EXIT_CROSSMARKET_MISMATCH' | 'EXIT_RISK_REGIME' | 'EXIT_RISK_FLOW_FLIP' | 'EXIT_RISK_INTEGRITY' | 'EXIT_FLIP' | null;
    reversal: {
      reversalAttempted: number;
      reversalBlocked: number;
      reversalConvertedToExit: number;
      exitOnFlipCount: number;
      currentPositionSide: 'BUY' | 'SELL' | null;
      sideCandidate: 'BUY' | 'SELL' | null;
      flipPersistenceCount: number;
      flipFirstDetectedMs: number | null;
      minFlipIntervalMs: number;
      entryConfirmations: number;
    };
    htf: {
      price: number;
      h1SwingLow: number | null;
      h1SwingHigh: number | null;
      h1SBUp: boolean;
      h1SBDn: boolean;
      vetoed: boolean;
      softBiasApplied: boolean;
      reason: 'H1_STRUCTURE_BREAK_DN' | 'H1_STRUCTURE_BREAK_UP' | 'H1_SWING_BELOW_SOFT' | 'H1_SWING_ABOVE_SOFT' | null;
    };
    superScalp: {
      active: boolean;
      m15SwingLow: number | null;
      m15SwingHigh: number | null;
      sweepDetected: boolean;
      reclaimDetected: boolean;
      sideCandidate: 'BUY' | 'SELL' | null;
    };
  };
}

export interface OrchestratorV1RuntimeState {
  active: boolean;
  side: OrchestratorV1Side | null;
  startedAtMs: number | null;
  lastRepriceAtMs: number | null;
  repricesUsed: number;
  takerFallbackUsed: boolean;
  cooldownUntilMs: number;
  positionQty: number;
  entryVwap: number | null;
  baseQty: number;
  addsUsed: number;
  lastAddTs: number | null;
  cooldownUntilTs: number;
  lastAtr3m: number;
  lastAtrSource: OrchestratorV1AtrSource;
  exitRiskActive: boolean;
  exitMakerAttempts: number;
  exitTakerUsed: boolean;
  exitRiskTriggeredCount: number;
  smoothedDeltaZ: number;
  smoothedCvdSlope: number;
  smoothedObiWeighted: number;
  smoothingInitialized: boolean;
  cvdSlopeWindow: number[];
  confirmCountLong: number;
  confirmCountShort: number;
  entryConfirmCount: number;
  lastSideChangeTs: number | null;
  sideFlipEvents5m: number[];
  gateTrueEvents5m: number[];
  entryIntentEvents5m: number[];
  // ── NEW: sticky chase state ──────────────────────────────────────────────────
  chaseActive: boolean;
  chaseStartTs: number | null;
  chaseLastRepriceTs: number | null;
  chaseAttempts: number;
  chaseTimedOut: boolean;
  m15LongSweepTs: number | null;
  m15ShortSweepTs: number | null;
  // ── NEW: aggregate telemetry counters ────────────────────────────────────────
  chaseStartedCount: number;
  chaseTimedOutCount: number;
  chaseElapsedMaxMs: number;
  fallbackEligibleCount: number;
  fallbackTriggeredCount: number;
  fallbackBlocked_NO_TIMEOUT: number;
  fallbackBlocked_IMPULSE_FALSE: number;
  fallbackBlocked_GATES_FALSE: number;
  // ── aggregate counters for cross market
  crossMarketVetoCount: number;
  crossMarketNeutralCount: number;
  crossMarketAllowedCount: number;
  crossMarketMismatchSinceMs: number | null;
  crossMarketMismatchExitTriggeredCount: number;
  lastExitReasonCode: 'EXIT_CROSSMARKET_MISMATCH' | 'EXIT_RISK_REGIME' | 'EXIT_RISK_FLOW_FLIP' | 'EXIT_RISK_INTEGRITY' | 'EXIT_FLIP' | null;
  // ── flip tracking for 2-step reversal ──
  flipDetectedSide: OrchestratorV1Side | null;
  flipFirstDetectedMs: number | null;
  flipPersistenceCount: number;
  // ── reversal telemetry counters ──
  reversalAttempted: number;
  reversalBlocked: number;
  reversalConvertedToExit: number;
  exitOnFlipCount: number;
}

export interface OrchestratorV1RuntimeSnapshot {
  params: OrchestratorV1Params;
  symbols: Record<string, OrchestratorV1RuntimeState>;
}
