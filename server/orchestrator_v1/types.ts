import { OrchestratorV1Params } from './params';

export type OrchestratorV1Intent = 'HOLD' | 'ENTRY' | 'ADD' | 'EXIT_RISK';
export type OrchestratorV1Side = 'BUY' | 'SELL';
export type OrchestratorV1CvdState = 'BUY' | 'SELL' | 'NEUTRAL';
export type OrchestratorV1AtrSource = 'MICRO_ATR' | 'BACKFILL_ATR' | 'UNKNOWN';

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
  htfH4BarStartMs: number | null;
  backfillDone: boolean;
  barsLoaded1m: number;
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
  reason: 'REGIME' | 'FLOW_FLIP' | 'INTEGRITY' | null;
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
}

export interface OrchestratorV1RuntimeSnapshot {
  params: OrchestratorV1Params;
  symbols: Record<string, OrchestratorV1RuntimeState>;
}
