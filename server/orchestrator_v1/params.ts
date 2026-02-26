export interface OrchestratorV1ReadinessParams {
  minBarsLoaded1m: number;
  minPrintsPerSecond: number;
}

export interface OrchestratorV1AtrParams {
  source: 'MICRO_ATR_THEN_BACKFILL';
  minAtr: number;
}

export interface OrchestratorV1GateAParams {
  trendinessMin: number;
  chopMax: number;
  volOfVolMax: number;
  spreadPctMax: number; // ratio (0.0008 = 8 bps)
  oiDropBlock: number;
}

export interface OrchestratorV1GateBParams {
  obiSupportMinAbs: number;
  deltaZMinAbs: number;
  cvdSlopeMinAbs: number;
}

export interface OrchestratorV1GateCParams {
  vwapDistanceMaxPct: number;
  maxRealizedVol1m: number;
}

export interface OrchestratorV1EntryExecParams {
  postOnly: boolean;
  ttlMs: number;
  repriceMs: number;
  maxReprices: number;
  chaseMaxSeconds: number;
  baseQty: number;
  layerOneNotionalPct: number;
  layerTwoNotionalPct: number;
  cooldownMs: number;
}

export interface OrchestratorV1AddParams {
  maxAdds: number;
  add1AtrMultiple: number;
  add2AtrMultiple: number;
  add1QtyFactor: number;
  add2QtyFactor: number;
  minIntervalMs: number;
  longFlowObiWeightedMin: number;
  longFlowCvdSlopeMin: number;
  longFlowOiChangePctMin: number;
}

export interface OrchestratorV1ExitRiskParams {
  trendinessMin: number;
  chopMax: number;
  flowFlipObiThreshold: number;
  flowFlipDeltaZThreshold: number;
  integrityFailLevel: number;
  makerAttempts: number;
  makerTtlMs: number;
}

export interface OrchestratorV1ImpulseParams {
  minPrintsPerSecond: number;
  minAbsDeltaZ: number;
}

export interface OrchestratorV1FallbackParams {
  maxNotionalPct: number;
}

export interface OrchestratorV1HysteresisParams {
  consecutiveConfirmations: number;
  entryConfirmations: number;
  minHoldMs: number;
  minFlipIntervalMs: number;
}

export interface OrchestratorV1SmoothingParams {
  deltaZEwmaAlpha: number;
  cvdSlopeMedianWindow: number;
  obiWeightedEwmaAlpha: number;
}

export interface OrchestratorV1Params {
  readiness: OrchestratorV1ReadinessParams;
  atr: OrchestratorV1AtrParams;
  gateA: OrchestratorV1GateAParams;
  gateB: OrchestratorV1GateBParams;
  gateC: OrchestratorV1GateCParams;
  entry: OrchestratorV1EntryExecParams;
  add: OrchestratorV1AddParams;
  exitRisk: OrchestratorV1ExitRiskParams;
  impulse: OrchestratorV1ImpulseParams;
  fallback: OrchestratorV1FallbackParams;
  hysteresis: OrchestratorV1HysteresisParams;
  smoothing: OrchestratorV1SmoothingParams;
}

export const ORCHESTRATOR_V1_PARAMS: OrchestratorV1Params = {
  readiness: {
    minBarsLoaded1m: 360,
    minPrintsPerSecond: 3,
  },
  atr: {
    source: 'MICRO_ATR_THEN_BACKFILL',
    minAtr: 0.000001,
  },
  gateA: {
    trendinessMin: 0.10,
    chopMax: 0.50,
    volOfVolMax: 0.65,
    spreadPctMax: 0.0008,
    oiDropBlock: -0.25,
  },
  gateB: {
    obiSupportMinAbs: 0.05,
    deltaZMinAbs: 0.6,
    cvdSlopeMinAbs: 0.003,
  },
  gateC: {
    vwapDistanceMaxPct: 0.004,
    maxRealizedVol1m: 0.12,
  },
  entry: {
    postOnly: true,
    ttlMs: 8000,
    repriceMs: 1200,
    maxReprices: 6,
    chaseMaxSeconds: 18,
    baseQty: 1,
    layerOneNotionalPct: 0.6,
    layerTwoNotionalPct: 0.4,
    cooldownMs: 30_000,
  },
  add: {
    maxAdds: 2,
    add1AtrMultiple: 0.55,
    add2AtrMultiple: 1.10,
    add1QtyFactor: 0.60,
    add2QtyFactor: 0.40,
    minIntervalMs: 90_000,
    longFlowObiWeightedMin: -0.05,
    longFlowCvdSlopeMin: -0.05,
    longFlowOiChangePctMin: -0.25,
  },
  exitRisk: {
    trendinessMin: 0.52,
    chopMax: 0.55,
    flowFlipObiThreshold: 0.08,
    flowFlipDeltaZThreshold: 0.5,
    integrityFailLevel: 1,
    makerAttempts: 2,
    makerTtlMs: 6000,
  },
  impulse: {
    minPrintsPerSecond: 6,
    minAbsDeltaZ: 0.8,
  },
  fallback: {
    maxNotionalPct: 0.25,
  },
  hysteresis: {
    consecutiveConfirmations: 3,
    entryConfirmations: 2,
    minHoldMs: 90_000,
    minFlipIntervalMs: 30_000,
  },
  smoothing: {
    deltaZEwmaAlpha: 0.30,
    cvdSlopeMedianWindow: 3,
    obiWeightedEwmaAlpha: 0.35,
  },
};
