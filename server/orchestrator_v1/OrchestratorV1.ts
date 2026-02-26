import { ORCHESTRATOR_V1_PARAMS, OrchestratorV1Params } from './params';
import {
  OrchestratorV1AddView,
  OrchestratorV1AtrSource,
  OrchestratorV1CvdState,
  OrchestratorV1Decision,
  OrchestratorV1GateView,
  OrchestratorV1Input,
  OrchestratorV1Order,
  OrchestratorV1RuntimeSnapshot,
  OrchestratorV1RuntimeState,
  OrchestratorV1Side,
} from './types';

const WINDOW_5M_MS = 5 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function nextSide(deltaZ: number, cvdSlope: number, obiDeep: number): OrchestratorV1Side | null {
  const score = (toNumber(deltaZ) * 0.65) + (toNumber(cvdSlope) * 12) + (toNumber(obiDeep) * 0.35);
  if (score > 0) return 'BUY';
  if (score < 0) return 'SELL';
  return null;
}

function buildGate(passed: boolean, reason: string | null, checks: Record<string, boolean>): OrchestratorV1GateView {
  return { passed, reason, checks };
}

function defaultRuntime(): OrchestratorV1RuntimeState {
  return {
    active: false,
    side: null,
    startedAtMs: null,
    lastRepriceAtMs: null,
    repricesUsed: 0,
    takerFallbackUsed: false,
    cooldownUntilMs: 0,
    positionQty: 0,
    entryVwap: null,
    baseQty: 0,
    addsUsed: 0,
    lastAddTs: null,
    cooldownUntilTs: 0,
    lastAtr3m: 0,
    lastAtrSource: 'UNKNOWN',
    exitRiskActive: false,
    exitMakerAttempts: 0,
    exitTakerUsed: false,
    exitRiskTriggeredCount: 0,
    smoothedDeltaZ: 0,
    smoothedCvdSlope: 0,
    smoothedObiWeighted: 0,
    smoothingInitialized: false,
    cvdSlopeWindow: [],
    confirmCountLong: 0,
    confirmCountShort: 0,
    entryConfirmCount: 0,
    lastSideChangeTs: null,
    sideFlipEvents5m: [],
    gateTrueEvents5m: [],
    entryIntentEvents5m: [],
  };
}

export class OrchestratorV1 {
  private readonly runtime = new Map<string, OrchestratorV1RuntimeState>();

  constructor(private readonly params: OrchestratorV1Params = ORCHESTRATOR_V1_PARAMS) {}

  public evaluate(inputRaw: OrchestratorV1Input): OrchestratorV1Decision {
    const input: OrchestratorV1Input = {
      ...inputRaw,
      symbol: String(inputRaw.symbol || '').toUpperCase(),
      nowMs: toNumber(inputRaw.nowMs, Date.now()),
      price: toNumber(inputRaw.price, 0),
      bestBid: isFiniteNumber(inputRaw.bestBid) ? inputRaw.bestBid : null,
      bestAsk: isFiniteNumber(inputRaw.bestAsk) ? inputRaw.bestAsk : null,
      spreadPct: isFiniteNumber(inputRaw.spreadPct) ? Math.max(0, Math.abs(inputRaw.spreadPct)) : null,
      printsPerSecond: toNumber(inputRaw.printsPerSecond, 0),
      deltaZ: toNumber(inputRaw.deltaZ, 0),
      cvdSlope: toNumber(inputRaw.cvdSlope, 0),
      cvdTf5mState: ((): OrchestratorV1CvdState => {
        const raw = String((inputRaw as any).cvdTf5mState || '').toUpperCase();
        if (raw === 'BUY' || raw === 'SELL') return raw;
        return 'NEUTRAL';
      })(),
      obiDeep: toNumber(inputRaw.obiDeep, 0),
      obiWeighted: toNumber((inputRaw as any).obiWeighted, 0),
      trendinessScore: toNumber(inputRaw.trendinessScore, 0),
      chopScore: toNumber(inputRaw.chopScore, 0),
      volOfVol: toNumber(inputRaw.volOfVol, 0),
      realizedVol1m: toNumber(inputRaw.realizedVol1m, 0),
      atr3m: toNumber((inputRaw as any).atr3m, 0),
      atrSource: ((): OrchestratorV1AtrSource => {
        const raw = String((inputRaw as any).atrSource || '').toUpperCase();
        if (raw === 'MICRO_ATR') return 'MICRO_ATR';
        if (raw === 'BACKFILL_ATR') return 'BACKFILL_ATR';
        return 'UNKNOWN';
      })(),
      orderbookIntegrityLevel: Math.max(0, Math.trunc(toNumber((inputRaw as any).orderbookIntegrityLevel, 0))),
      oiChangePct: isFiniteNumber(inputRaw.oiChangePct) ? inputRaw.oiChangePct : null,
      sessionVwapValue: isFiniteNumber(inputRaw.sessionVwapValue) ? inputRaw.sessionVwapValue : null,
      htfH1BarStartMs: isFiniteNumber(inputRaw.htfH1BarStartMs) ? inputRaw.htfH1BarStartMs : null,
      htfH4BarStartMs: isFiniteNumber(inputRaw.htfH4BarStartMs) ? inputRaw.htfH4BarStartMs : null,
      backfillDone: Boolean(inputRaw.backfillDone),
      barsLoaded1m: Math.max(0, Math.trunc(toNumber(inputRaw.barsLoaded1m, 0))),
    };

    const symbol = input.symbol;
    const runtime = this.getRuntime(symbol);
    runtime.lastAtr3m = input.atr3m;
    runtime.lastAtrSource = input.atrSource;
    this.pruneTelemetry(runtime, input.nowMs);

    const smoothed = this.computeSmoothed(input, runtime);
    const isPositionOpen = runtime.positionQty > 0 && runtime.entryVwap != null && runtime.side != null;
    const candidateSide = nextSide(smoothed.deltaZ, smoothed.cvdSlope, input.obiDeep);
    const sideForEntry = this.resolveSideWithHysteresis(runtime, candidateSide, input.nowMs, isPositionOpen);

    const readinessReasons: string[] = [];
    if (!input.backfillDone) readinessReasons.push('BACKFILL_NOT_DONE');
    if (input.barsLoaded1m < this.params.readiness.minBarsLoaded1m) readinessReasons.push('INSUFFICIENT_1M_BARS');
    if (!isFiniteNumber(input.sessionVwapValue)) readinessReasons.push('SESSION_VWAP_MISSING');
    if (!isFiniteNumber(input.htfH1BarStartMs) || !isFiniteNumber(input.htfH4BarStartMs)) readinessReasons.push('HTF_BARSTART_MISSING');
    if (!(input.printsPerSecond > this.params.readiness.minPrintsPerSecond)) readinessReasons.push('PRINTS_TOO_LOW');
    const readiness = {
      ready: readinessReasons.length === 0,
      reasons: readinessReasons,
    };

    const gateAChecks = {
      trendiness: input.trendinessScore >= this.params.gateA.trendinessMin,
      chop: input.chopScore <= this.params.gateA.chopMax,
      volOfVol: input.volOfVol <= this.params.gateA.volOfVolMax,
      spread: input.spreadPct != null && input.spreadPct <= this.params.gateA.spreadPctMax,
      oiDrop: input.oiChangePct == null || input.oiChangePct > this.params.gateA.oiDropBlock,
    };
    const gateA = buildGate(
      Object.values(gateAChecks).every(Boolean),
      Object.values(gateAChecks).every(Boolean) ? null : 'GATE_A_BLOCK',
      gateAChecks
    );

    const sideAlignedObi = sideForEntry === 'BUY'
      ? input.obiDeep >= this.params.gateB.obiSupportMinAbs
      : sideForEntry === 'SELL'
        ? input.obiDeep <= -this.params.gateB.obiSupportMinAbs
        : false;
    const sideAlignedCvd = sideForEntry === 'BUY'
      ? smoothed.cvdSlope >= this.params.gateB.cvdSlopeMinAbs
      : sideForEntry === 'SELL'
        ? smoothed.cvdSlope <= -this.params.gateB.cvdSlopeMinAbs
        : false;
    const gateBChecks = {
      side: sideForEntry != null,
      obiSupport: sideAlignedObi,
      deltaZ: Math.abs(smoothed.deltaZ) >= this.params.gateB.deltaZMinAbs,
      cvd: sideAlignedCvd,
    };
    const gateB = buildGate(
      Object.values(gateBChecks).every(Boolean),
      Object.values(gateBChecks).every(Boolean) ? null : 'GATE_B_BLOCK',
      gateBChecks
    );

    const vwapDistancePct = isFiniteNumber(input.sessionVwapValue) && input.sessionVwapValue > 0
      ? Math.abs((input.price - input.sessionVwapValue) / input.sessionVwapValue)
      : Number.POSITIVE_INFINITY;
    const gateCChecks = {
      vwapDistance: vwapDistancePct <= this.params.gateC.vwapDistanceMaxPct,
      vol1m: input.realizedVol1m <= this.params.gateC.maxRealizedVol1m,
    };
    const gateC = buildGate(
      Object.values(gateCChecks).every(Boolean),
      Object.values(gateCChecks).every(Boolean) ? null : 'GATE_C_BLOCK',
      gateCChecks
    );

    const impulseChecks = {
      printsPerSecond: input.printsPerSecond >= this.params.impulse.minPrintsPerSecond,
      deltaZ: Math.abs(smoothed.deltaZ) >= this.params.impulse.minAbsDeltaZ,
      spread: input.spreadPct != null && input.spreadPct <= (this.params.gateA.spreadPctMax * 1.2),
    };
    const impulse = {
      passed: Object.values(impulseChecks).every(Boolean),
      checks: impulseChecks,
    };

    const allGatesRaw = readiness.ready && gateA.passed && gateB.passed && gateC.passed;
    if (allGatesRaw) {
      this.pushWindowEvent(runtime.gateTrueEvents5m, input.nowMs);
    }
    runtime.entryConfirmCount = allGatesRaw && sideForEntry != null
      ? runtime.entryConfirmCount + 1
      : 0;
    const allGatesPassed = allGatesRaw && runtime.entryConfirmCount >= this.params.hysteresis.entryConfirmations;

    const orders: OrchestratorV1Order[] = [];
    const chaseMaxMs = this.params.entry.chaseMaxSeconds * 1000;
    let intent: OrchestratorV1Decision['intent'] = 'HOLD';

    let addView: OrchestratorV1AddView = {
      triggered: false,
      step: null,
      gatePassed: false,
      rateLimitPassed: true,
      thresholdPrice: null,
    };
    let exitRiskTriggeredThisTick = false;
    let exitRiskReason: 'REGIME' | 'FLOW_FLIP' | 'INTEGRITY' | null = null;
    const exitRiskEval = this.evaluateExitRisk(input, runtime);
    if (isPositionOpen && exitRiskEval.triggered) {
      intent = 'EXIT_RISK';
      exitRiskReason = exitRiskEval.reason;
      if (!runtime.exitRiskActive) {
        runtime.exitRiskActive = true;
        runtime.exitMakerAttempts = 0;
        runtime.exitTakerUsed = false;
        runtime.exitRiskTriggeredCount += 1;
        exitRiskTriggeredThisTick = true;
      }

      if (runtime.exitMakerAttempts < this.params.exitRisk.makerAttempts) {
        runtime.exitMakerAttempts += 1;
        orders.push(this.buildExitMakerOrder(input, runtime, runtime.exitMakerAttempts));
      } else if (!runtime.exitTakerUsed) {
        runtime.exitTakerUsed = true;
        orders.push(this.buildExitTakerOrder(runtime));
        this.closePosition(runtime, input.nowMs);
      }
      runtime.active = false;
    } else {
      if (runtime.exitRiskActive) {
        runtime.exitRiskActive = false;
        runtime.exitMakerAttempts = 0;
        runtime.exitTakerUsed = false;
      }

      if (isPositionOpen) {
        addView = this.evaluateAdd(input, runtime, gateA, smoothed);
        if (addView.triggered && addView.step != null && runtime.side) {
          const addQty = addView.step === 1
            ? runtime.baseQty * this.params.add.add1QtyFactor
            : runtime.baseQty * this.params.add.add2QtyFactor;
          const prevQty = runtime.positionQty;
          runtime.positionQty = prevQty + addQty;
          runtime.entryVwap = this.weightedAverage(
            runtime.entryVwap || input.price,
            prevQty,
            input.price,
            addQty
          );
          runtime.addsUsed = addView.step;
          runtime.lastAddTs = input.nowMs;
          orders.push(this.buildAddOrder(input, runtime.side, addView.step, addQty));
          intent = 'ADD';
        }
      } else if (runtime.active) {
        const startedAt = runtime.startedAtMs || input.nowMs;
        const elapsedMs = Math.max(0, input.nowMs - startedAt);
        const expiredByTime = elapsedMs >= chaseMaxMs;
        const expiredByReprices = runtime.repricesUsed >= this.params.entry.maxReprices;
        const canReprice = !expiredByTime
          && !expiredByReprices
          && (runtime.lastRepriceAtMs == null || (input.nowMs - runtime.lastRepriceAtMs) >= this.params.entry.repriceMs);

        if (allGatesPassed && canReprice && runtime.side) {
          runtime.repricesUsed += 1;
          runtime.lastRepriceAtMs = input.nowMs;
          orders.push(...this.buildMakerOrders(input, runtime.side, runtime.repricesUsed, runtime.baseQty));
          intent = 'ENTRY';
        } else if (allGatesPassed && impulse.passed && !runtime.takerFallbackUsed && (expiredByTime || expiredByReprices) && runtime.side) {
          runtime.takerFallbackUsed = true;
          runtime.active = false;
          runtime.cooldownUntilMs = input.nowMs + this.params.entry.cooldownMs;
          runtime.cooldownUntilTs = runtime.cooldownUntilMs;
          const fallbackQty = runtime.baseQty * this.params.fallback.maxNotionalPct;
          orders.push(this.buildTakerFallbackOrder(runtime.side, runtime.repricesUsed, fallbackQty));
          runtime.positionQty = runtime.baseQty;
          runtime.entryVwap = input.price;
          runtime.addsUsed = 0;
          runtime.lastAddTs = null;
          intent = 'ENTRY';
        } else if (expiredByTime || expiredByReprices || !allGatesPassed) {
          runtime.active = false;
          runtime.cooldownUntilMs = input.nowMs + this.params.entry.cooldownMs;
          runtime.cooldownUntilTs = runtime.cooldownUntilMs;
        }
      } else {
        const readyAfterCooldown = input.nowMs >= Math.max(runtime.cooldownUntilMs, runtime.cooldownUntilTs);
        const canEnter = allGatesPassed && sideForEntry != null && readyAfterCooldown;
        if (canEnter && sideForEntry) {
          runtime.active = true;
          runtime.side = sideForEntry;
          runtime.baseQty = Math.max(this.params.entry.baseQty, this.params.atr.minAtr);
          runtime.startedAtMs = input.nowMs;
          runtime.lastRepriceAtMs = input.nowMs;
          runtime.repricesUsed = 0;
          runtime.takerFallbackUsed = false;
          orders.push(...this.buildMakerOrders(input, sideForEntry, 0, runtime.baseQty));
          intent = 'ENTRY';
        }
      }
    }

    if (intent === 'ENTRY') {
      this.pushWindowEvent(runtime.entryIntentEvents5m, input.nowMs);
    }

    const hasPositionAfterTick = runtime.positionQty > 0 && runtime.entryVwap != null;
    if (!runtime.active && !hasPositionAfterTick && intent === 'HOLD') {
      runtime.baseQty = 0;
    }

    this.runtime.set(symbol, runtime);

    const sideFlipCount5m = runtime.sideFlipEvents5m.length;
    const allGatesTrueCount5m = runtime.gateTrueEvents5m.length;
    const entryIntentCount5m = runtime.entryIntentEvents5m.length;

    return {
      symbol,
      timestampMs: input.nowMs,
      intent,
      side: runtime.side || sideForEntry,
      readiness,
      gateA,
      gateB,
      gateC,
      allGatesPassed,
      impulse,
      add: addView,
      exitRisk: {
        triggered: exitRiskEval.triggered,
        triggeredThisTick: exitRiskTriggeredThisTick,
        reason: exitRiskReason,
        makerAttemptsUsed: runtime.exitMakerAttempts,
        takerUsed: runtime.exitTakerUsed,
      },
      position: {
        isOpen: hasPositionAfterTick,
        qty: runtime.positionQty,
        entryVwap: runtime.entryVwap,
        baseQty: runtime.baseQty,
        addsUsed: runtime.addsUsed,
        lastAddTs: runtime.lastAddTs,
        cooldownUntilTs: Math.max(runtime.cooldownUntilTs, runtime.cooldownUntilMs),
        atr3m: runtime.lastAtr3m,
        atrSource: runtime.lastAtrSource,
      },
      orders,
      chase: {
        active: runtime.active,
        startedAtMs: runtime.startedAtMs,
        expiresAtMs: runtime.startedAtMs != null ? runtime.startedAtMs + chaseMaxMs : null,
        repriceMs: this.params.entry.repriceMs,
        maxReprices: this.params.entry.maxReprices,
        repricesUsed: runtime.repricesUsed,
        chaseMaxSeconds: this.params.entry.chaseMaxSeconds,
        ttlMs: this.params.entry.ttlMs,
      },
      telemetry: {
        sideFlipCount5m,
        sideFlipPerMin: Number((sideFlipCount5m / 5).toFixed(4)),
        allGatesTrueCount5m,
        entryIntentCount5m,
        smoothed: {
          deltaZ: smoothed.deltaZ,
          cvdSlope: smoothed.cvdSlope,
          obiWeighted: smoothed.obiWeighted,
        },
        hysteresis: {
          confirmCountLong: runtime.confirmCountLong,
          confirmCountShort: runtime.confirmCountShort,
          entryConfirmCount: runtime.entryConfirmCount,
        },
      },
    };
  }

  public seedPosition(symbolRaw: string, side: OrchestratorV1Side, entryVwap: number, baseQty = 1): void {
    const symbol = String(symbolRaw || '').toUpperCase();
    const runtime = this.getRuntime(symbol);
    runtime.active = false;
    runtime.side = side;
    runtime.startedAtMs = null;
    runtime.lastRepriceAtMs = null;
    runtime.repricesUsed = 0;
    runtime.takerFallbackUsed = false;
    runtime.cooldownUntilMs = 0;
    runtime.positionQty = Math.max(this.params.atr.minAtr, Number(baseQty) || 1);
    runtime.entryVwap = Number(entryVwap) || 0;
    runtime.baseQty = Math.max(this.params.atr.minAtr, Number(baseQty) || 1);
    runtime.addsUsed = 0;
    runtime.lastAddTs = null;
    runtime.cooldownUntilTs = 0;
    runtime.exitRiskActive = false;
    runtime.exitMakerAttempts = 0;
    runtime.exitTakerUsed = false;
    runtime.entryConfirmCount = 0;
    runtime.confirmCountLong = 0;
    runtime.confirmCountShort = 0;
    runtime.sideFlipEvents5m = [];
    runtime.gateTrueEvents5m = [];
    runtime.entryIntentEvents5m = [];
    runtime.lastSideChangeTs = null;
    this.runtime.set(symbol, runtime);
  }

  public getRuntimeSnapshot(): OrchestratorV1RuntimeSnapshot {
    const symbols: Record<string, OrchestratorV1RuntimeState> = {};
    for (const [symbol, state] of this.runtime.entries()) {
      symbols[symbol] = {
        ...state,
        cvdSlopeWindow: [...state.cvdSlopeWindow],
        sideFlipEvents5m: [...state.sideFlipEvents5m],
        gateTrueEvents5m: [...state.gateTrueEvents5m],
        entryIntentEvents5m: [...state.entryIntentEvents5m],
      };
    }
    return {
      params: this.params,
      symbols,
    };
  }

  private getRuntime(symbol: string): OrchestratorV1RuntimeState {
    const existing = this.runtime.get(symbol);
    if (existing) return existing;
    const created = defaultRuntime();
    this.runtime.set(symbol, created);
    return created;
  }

  private computeSmoothed(
    input: OrchestratorV1Input,
    runtime: OrchestratorV1RuntimeState
  ): { deltaZ: number; cvdSlope: number; obiWeighted: number } {
    const deltaAlpha = clamp(this.params.smoothing.deltaZEwmaAlpha, 0.01, 1);
    const obiAlpha = clamp(this.params.smoothing.obiWeightedEwmaAlpha, 0.01, 1);
    const medianWindow = Math.max(1, Math.trunc(this.params.smoothing.cvdSlopeMedianWindow));

    if (!runtime.smoothingInitialized) {
      runtime.smoothedDeltaZ = input.deltaZ;
      runtime.smoothedCvdSlope = input.cvdSlope;
      runtime.smoothedObiWeighted = input.obiWeighted;
      runtime.cvdSlopeWindow = [input.cvdSlope];
      runtime.smoothingInitialized = true;
    } else {
      runtime.smoothedDeltaZ = (deltaAlpha * input.deltaZ) + ((1 - deltaAlpha) * runtime.smoothedDeltaZ);
      runtime.smoothedObiWeighted = (obiAlpha * input.obiWeighted) + ((1 - obiAlpha) * runtime.smoothedObiWeighted);
      runtime.cvdSlopeWindow.push(input.cvdSlope);
      while (runtime.cvdSlopeWindow.length > medianWindow) {
        runtime.cvdSlopeWindow.shift();
      }
      runtime.smoothedCvdSlope = median(runtime.cvdSlopeWindow);
    }

    return {
      deltaZ: runtime.smoothedDeltaZ,
      cvdSlope: runtime.smoothedCvdSlope,
      obiWeighted: runtime.smoothedObiWeighted,
    };
  }

  private resolveSideWithHysteresis(
    runtime: OrchestratorV1RuntimeState,
    candidateSide: OrchestratorV1Side | null,
    nowMs: number,
    freezeByPosition: boolean
  ): OrchestratorV1Side | null {
    if (freezeByPosition) {
      runtime.confirmCountLong = 0;
      runtime.confirmCountShort = 0;
      return runtime.side;
    }

    if (candidateSide == null) {
      runtime.confirmCountLong = 0;
      runtime.confirmCountShort = 0;
      return runtime.side;
    }

    if (candidateSide === runtime.side) {
      runtime.confirmCountLong = 0;
      runtime.confirmCountShort = 0;
      return runtime.side;
    }

    if (candidateSide === 'BUY') {
      runtime.confirmCountLong += 1;
      runtime.confirmCountShort = 0;
    } else {
      runtime.confirmCountShort += 1;
      runtime.confirmCountLong = 0;
    }

    const confirmCount = candidateSide === 'BUY' ? runtime.confirmCountLong : runtime.confirmCountShort;
    const holdPassed = runtime.lastSideChangeTs == null
      || (nowMs - runtime.lastSideChangeTs) >= this.params.hysteresis.minHoldMs;
    const flipIntervalPassed = runtime.lastSideChangeTs == null
      || (nowMs - runtime.lastSideChangeTs) >= this.params.hysteresis.minFlipIntervalMs;

    if (
      confirmCount >= this.params.hysteresis.consecutiveConfirmations
      && holdPassed
      && flipIntervalPassed
    ) {
      const previousSide = runtime.side;
      runtime.side = candidateSide;
      runtime.lastSideChangeTs = nowMs;
      runtime.confirmCountLong = 0;
      runtime.confirmCountShort = 0;
      if (previousSide != null && previousSide !== candidateSide) {
        this.pushWindowEvent(runtime.sideFlipEvents5m, nowMs);
      }
    }

    return runtime.side;
  }

  private pruneTelemetry(runtime: OrchestratorV1RuntimeState, nowMs: number): void {
    this.pruneWindowEvents(runtime.sideFlipEvents5m, nowMs);
    this.pruneWindowEvents(runtime.gateTrueEvents5m, nowMs);
    this.pruneWindowEvents(runtime.entryIntentEvents5m, nowMs);
  }

  private pushWindowEvent(events: number[], nowMs: number): void {
    events.push(nowMs);
    this.pruneWindowEvents(events, nowMs);
  }

  private pruneWindowEvents(events: number[], nowMs: number): void {
    const minTs = nowMs - WINDOW_5M_MS;
    while (events.length > 0 && events[0] < minTs) {
      events.shift();
    }
  }

  private evaluateAdd(
    input: OrchestratorV1Input,
    runtime: OrchestratorV1RuntimeState,
    gateA: OrchestratorV1GateView,
    smoothed: { cvdSlope: number; obiWeighted: number }
  ): OrchestratorV1AddView {
    const atr = input.atr3m > this.params.atr.minAtr ? input.atr3m : 0;
    if (!runtime.side || runtime.entryVwap == null || runtime.baseQty <= 0 || atr <= 0) {
      return {
        triggered: false,
        step: null,
        gatePassed: false,
        rateLimitPassed: true,
        thresholdPrice: null,
      };
    }
    if (runtime.addsUsed >= this.params.add.maxAdds) {
      return {
        triggered: false,
        step: null,
        gatePassed: false,
        rateLimitPassed: true,
        thresholdPrice: null,
      };
    }

    const nextStep = runtime.addsUsed === 0 ? 1 : 2;
    const stepAtr = nextStep === 1 ? this.params.add.add1AtrMultiple : this.params.add.add2AtrMultiple;
    const thresholdPrice = runtime.side === 'BUY'
      ? runtime.entryVwap - (stepAtr * atr)
      : runtime.entryVwap + (stepAtr * atr);
    const priceTriggered = runtime.side === 'BUY'
      ? input.price <= thresholdPrice
      : input.price >= thresholdPrice;
    const rateLimitPassed = runtime.lastAddTs == null || (input.nowMs - runtime.lastAddTs) >= this.params.add.minIntervalMs;
    const flowPassed = runtime.side === 'BUY'
      ? (
        smoothed.obiWeighted >= this.params.add.longFlowObiWeightedMin
        && smoothed.cvdSlope >= this.params.add.longFlowCvdSlopeMin
        && (input.oiChangePct == null || input.oiChangePct >= this.params.add.longFlowOiChangePctMin)
      )
      : (
        smoothed.obiWeighted <= -this.params.add.longFlowObiWeightedMin
        && smoothed.cvdSlope <= -this.params.add.longFlowCvdSlopeMin
        && (input.oiChangePct == null || input.oiChangePct <= -this.params.add.longFlowOiChangePctMin)
      );
    const gatePassed = gateA.passed && flowPassed;
    const triggered = gatePassed && rateLimitPassed && priceTriggered;
    return {
      triggered,
      step: triggered ? (nextStep as 1 | 2) : null,
      gatePassed,
      rateLimitPassed,
      thresholdPrice,
    };
  }

  private evaluateExitRisk(
    input: OrchestratorV1Input,
    runtime: OrchestratorV1RuntimeState
  ): { triggered: boolean; reason: 'REGIME' | 'FLOW_FLIP' | 'INTEGRITY' | null } {
    const integrityFail = input.orderbookIntegrityLevel > this.params.exitRisk.integrityFailLevel;
    if (integrityFail) return { triggered: true, reason: 'INTEGRITY' };

    const regimeFail = input.trendinessScore < this.params.exitRisk.trendinessMin
      || input.chopScore > this.params.exitRisk.chopMax;
    if (regimeFail) return { triggered: true, reason: 'REGIME' };

    if (runtime.side === 'BUY') {
      const flowFlipLong = input.cvdTf5mState === 'SELL'
        && input.obiWeighted < -this.params.exitRisk.flowFlipObiThreshold
        && input.deltaZ < -this.params.exitRisk.flowFlipDeltaZThreshold;
      if (flowFlipLong) return { triggered: true, reason: 'FLOW_FLIP' };
    } else if (runtime.side === 'SELL') {
      const flowFlipShort = input.cvdTf5mState === 'BUY'
        && input.obiWeighted > this.params.exitRisk.flowFlipObiThreshold
        && input.deltaZ > this.params.exitRisk.flowFlipDeltaZThreshold;
      if (flowFlipShort) return { triggered: true, reason: 'FLOW_FLIP' };
    }

    return { triggered: false, reason: null };
  }

  private weightedAverage(prevPrice: number, prevQty: number, fillPrice: number, fillQty: number): number {
    const totalQty = Math.max(0, prevQty) + Math.max(0, fillQty);
    if (totalQty <= 0) return fillPrice;
    return ((prevPrice * prevQty) + (fillPrice * fillQty)) / totalQty;
  }

  private closePosition(runtime: OrchestratorV1RuntimeState, nowMs: number): void {
    runtime.active = false;
    runtime.side = null;
    runtime.startedAtMs = null;
    runtime.lastRepriceAtMs = null;
    runtime.repricesUsed = 0;
    runtime.takerFallbackUsed = false;
    runtime.cooldownUntilMs = nowMs + this.params.entry.cooldownMs;
    runtime.positionQty = 0;
    runtime.entryVwap = null;
    runtime.baseQty = 0;
    runtime.addsUsed = 0;
    runtime.lastAddTs = null;
    runtime.cooldownUntilTs = runtime.cooldownUntilMs;
    runtime.exitRiskActive = false;
    runtime.exitMakerAttempts = 0;
    runtime.exitTakerUsed = false;
    runtime.entryConfirmCount = 0;
    runtime.confirmCountLong = 0;
    runtime.confirmCountShort = 0;
  }

  private buildMakerOrders(input: OrchestratorV1Input, side: OrchestratorV1Side, repriceAttempt: number, baseQty: number): OrchestratorV1Order[] {
    const spread = input.spreadPct != null && input.spreadPct > 0
      ? input.spreadPct
      : 0.0003;
    const entryBuffer = clamp(spread * 0.25, 0.00002, 0.00035);
    const bestBid = isFiniteNumber(input.bestBid) && input.bestBid > 0 ? input.bestBid : input.price;
    const bestAsk = isFiniteNumber(input.bestAsk) && input.bestAsk > 0 ? input.bestAsk : input.price;

    const layerOnePrice = side === 'BUY'
      ? bestBid
      : bestAsk;
    const layerTwoPrice = side === 'BUY'
      ? Math.max(0, layerOnePrice * (1 - entryBuffer))
      : layerOnePrice * (1 + entryBuffer);

    return [
      {
        id: `${input.symbol}-maker-l1-${input.nowMs}-${repriceAttempt}`,
        kind: 'MAKER',
        side,
        qty: baseQty * this.params.entry.layerOneNotionalPct,
        notionalPct: this.params.entry.layerOneNotionalPct,
        price: layerOnePrice,
        postOnly: this.params.entry.postOnly,
        ttlMs: this.params.entry.ttlMs,
        repriceMs: this.params.entry.repriceMs,
        maxReprices: this.params.entry.maxReprices,
        repriceAttempt,
        role: 'ENTRY_L1',
      },
      {
        id: `${input.symbol}-maker-l2-${input.nowMs}-${repriceAttempt}`,
        kind: 'MAKER',
        side,
        qty: baseQty * this.params.entry.layerTwoNotionalPct,
        notionalPct: this.params.entry.layerTwoNotionalPct,
        price: layerTwoPrice,
        postOnly: this.params.entry.postOnly,
        ttlMs: this.params.entry.ttlMs,
        repriceMs: this.params.entry.repriceMs,
        maxReprices: this.params.entry.maxReprices,
        repriceAttempt,
        role: 'ENTRY_L2',
      },
    ];
  }

  private buildAddOrder(input: OrchestratorV1Input, side: OrchestratorV1Side, step: 1 | 2, qty: number): OrchestratorV1Order {
    const bestBid = isFiniteNumber(input.bestBid) && input.bestBid > 0 ? input.bestBid : input.price;
    const bestAsk = isFiniteNumber(input.bestAsk) && input.bestAsk > 0 ? input.bestAsk : input.price;
    return {
      id: `${input.symbol}-add-${step}-${input.nowMs}`,
      kind: 'MAKER',
      side,
      qty,
      notionalPct: step === 1 ? this.params.add.add1QtyFactor : this.params.add.add2QtyFactor,
      price: side === 'BUY' ? bestBid : bestAsk,
      postOnly: this.params.entry.postOnly,
      ttlMs: this.params.entry.ttlMs,
      repriceMs: this.params.entry.repriceMs,
      maxReprices: this.params.entry.maxReprices,
      repriceAttempt: step,
      role: step === 1 ? 'ADD_1' : 'ADD_2',
    };
  }

  private buildExitMakerOrder(input: OrchestratorV1Input, runtime: OrchestratorV1RuntimeState, attempt: number): OrchestratorV1Order {
    const side = runtime.side === 'BUY' ? 'SELL' : 'BUY';
    const bestBid = isFiniteNumber(input.bestBid) && input.bestBid > 0 ? input.bestBid : input.price;
    const bestAsk = isFiniteNumber(input.bestAsk) && input.bestAsk > 0 ? input.bestAsk : input.price;
    return {
      id: `${input.symbol}-exit-maker-${attempt}-${input.nowMs}`,
      kind: 'MAKER',
      side,
      qty: runtime.positionQty,
      notionalPct: 1,
      price: side === 'BUY' ? bestBid : bestAsk,
      postOnly: true,
      ttlMs: this.params.exitRisk.makerTtlMs,
      repriceMs: this.params.entry.repriceMs,
      maxReprices: this.params.entry.maxReprices,
      repriceAttempt: attempt,
      role: 'EXIT_RISK_MAKER',
    };
  }

  private buildTakerFallbackOrder(side: OrchestratorV1Side, repriceAttempt: number, qty: number): OrchestratorV1Order {
    return {
      id: `fallback-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      kind: 'TAKER_ENTRY_FALLBACK',
      side,
      qty,
      notionalPct: this.params.fallback.maxNotionalPct,
      price: null,
      postOnly: false,
      ttlMs: this.params.entry.ttlMs,
      repriceMs: this.params.entry.repriceMs,
      maxReprices: this.params.entry.maxReprices,
      repriceAttempt,
      role: 'ENTRY_FALLBACK',
    };
  }

  private buildExitTakerOrder(runtime: OrchestratorV1RuntimeState): OrchestratorV1Order {
    const side = runtime.side === 'BUY' ? 'SELL' : 'BUY';
    return {
      id: `exit-risk-taker-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      kind: 'TAKER_RISK_EXIT',
      side,
      qty: runtime.positionQty,
      notionalPct: 1,
      price: null,
      postOnly: false,
      ttlMs: this.params.exitRisk.makerTtlMs,
      repriceMs: this.params.entry.repriceMs,
      maxReprices: this.params.entry.maxReprices,
      repriceAttempt: runtime.exitMakerAttempts,
      role: 'EXIT_RISK_TAKER',
    };
  }
}
