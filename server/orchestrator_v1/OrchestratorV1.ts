import { ORCHESTRATOR_V1_PARAMS, OrchestratorV1Params } from './params';
import {
  OrchestratorV1AddView,
  OrchestratorV1AtrSource,
  OrchestratorV1ChaseDebugView,
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

type SuperScalpEvaluation = {
  sideCandidate: OrchestratorV1Side | null;
  sweepDetected: boolean;
  reclaimDetected: boolean;
};

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
    // ── Chase sticky state ────────────────────────────────────────────────────
    chaseActive: false,
    chaseStartTs: null,
    chaseLastRepriceTs: null,
    chaseAttempts: 0,
    chaseTimedOut: false,
    m15LongSweepTs: null,
    m15ShortSweepTs: null,
    // ── Aggregate telemetry counters ──────────────────────────────────────────
    chaseStartedCount: 0,
    chaseTimedOutCount: 0,
    chaseElapsedMaxMs: 0,
    fallbackEligibleCount: 0,
    fallbackTriggeredCount: 0,
    fallbackBlocked_NO_TIMEOUT: 0,
    fallbackBlocked_IMPULSE_FALSE: 0,
    fallbackBlocked_GATES_FALSE: 0,
    crossMarketVetoCount: 0,
    crossMarketNeutralCount: 0,
    crossMarketAllowedCount: 0,
    crossMarketMismatchSinceMs: null,
    crossMarketMismatchExitTriggeredCount: 0,
    lastExitReasonCode: null,
    // ── flip tracking for 2-step reversal ──
    flipDetectedSide: null,
    flipFirstDetectedMs: null,
    flipPersistenceCount: 0,
    // ── reversal telemetry counters ──
    reversalAttempted: 0,
    reversalBlocked: 0,
    reversalConvertedToExit: 0,
    exitOnFlipCount: 0,
  };
}

export class OrchestratorV1 {
  private readonly runtime = new Map<string, OrchestratorV1RuntimeState>();

  constructor(private readonly params: OrchestratorV1Params = ORCHESTRATOR_V1_PARAMS) { }

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
      htfH1SwingLow: isFiniteNumber(inputRaw.htfH1SwingLow) ? inputRaw.htfH1SwingLow : null,
      htfH1SwingHigh: isFiniteNumber(inputRaw.htfH1SwingHigh) ? inputRaw.htfH1SwingHigh : null,
      htfH1StructureBreakUp: Boolean(inputRaw.htfH1StructureBreakUp),
      htfH1StructureBreakDn: Boolean(inputRaw.htfH1StructureBreakDn),
      htfH4BarStartMs: isFiniteNumber(inputRaw.htfH4BarStartMs) ? inputRaw.htfH4BarStartMs : null,
      m15SwingLow: isFiniteNumber(inputRaw.m15SwingLow) ? inputRaw.m15SwingLow : null,
      m15SwingHigh: isFiniteNumber(inputRaw.m15SwingHigh) ? inputRaw.m15SwingHigh : null,
      superScalpEnabled: inputRaw.superScalpEnabled === true,
      backfillDone: Boolean(inputRaw.backfillDone),
      barsLoaded1m: Math.max(0, Math.trunc(toNumber(inputRaw.barsLoaded1m, 0))),
      crossMarketActive: inputRaw.crossMarketActive !== false,
    };

    const symbol = input.symbol;
    const runtime = this.getRuntime(symbol);
    runtime.lastAtr3m = input.atr3m;
    runtime.lastAtrSource = input.atrSource;
    this.pruneTelemetry(runtime, input.nowMs);

    // ── P0: Sync runtime from DryRun position (single source of truth) ──
    const drp = input.dryRunPosition;
    if (drp && drp.hasPosition && drp.qty > 0 && drp.side) {
      const drpSide: OrchestratorV1Side = drp.side === 'LONG' ? 'BUY' : 'SELL';
      runtime.positionQty = drp.qty;
      runtime.entryVwap = drp.entryPrice;
      runtime.side = drpSide;
      runtime.addsUsed = drp.addsUsed;
    } else if (drp && !drp.hasPosition) {
      // DryRun says flat → reset orchestrator position tracking
      runtime.positionQty = 0;
      runtime.entryVwap = null;
      // NOTE: do NOT reset runtime.side — micro score still tracks direction
    }

    const smoothed = this.computeSmoothed(input, runtime);
    const isPositionOpen = runtime.positionQty > 0 && runtime.entryVwap != null && runtime.side != null;
    const legacyCandidateSide = nextSide(smoothed.deltaZ, smoothed.cvdSlope, input.obiDeep);
    const superScalpEval = this.evaluateSuperScalp(input, runtime, smoothed);
    const candidateSideForEntry = input.superScalpEnabled
      ? superScalpEval.sideCandidate
      : legacyCandidateSide;

    // Pass false for freezeByPosition so we can detect flips in the 2-step state machine
    const sideForEntry = input.superScalpEnabled && candidateSideForEntry == null
      ? null
      : this.resolveSideWithHysteresis(runtime, candidateSideForEntry, input.nowMs, false);

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

    const htfLevelState = {
      price: input.price,
      h1SwingLow: input.htfH1SwingLow ?? null,
      h1SwingHigh: input.htfH1SwingHigh ?? null,
      h1SBUp: Boolean(input.htfH1StructureBreakUp),
      h1SBDn: Boolean(input.htfH1StructureBreakDn),
    };
    let htfVetoed = false;
    let htfSoftBiasApplied = false;
    let htfReason: 'H1_STRUCTURE_BREAK_DN' | 'H1_STRUCTURE_BREAK_UP' | 'H1_SWING_BELOW_SOFT' | 'H1_SWING_ABOVE_SOFT' | null = null;

    if (sideForEntry === 'BUY') {
      if (input.htfH1StructureBreakDn) {
        htfVetoed = true;
        htfReason = 'H1_STRUCTURE_BREAK_DN';
      } else if (input.htfH1SwingLow != null && input.price <= input.htfH1SwingLow) {
        htfSoftBiasApplied = true;
        htfReason = 'H1_SWING_BELOW_SOFT';
      }
    } else if (sideForEntry === 'SELL') {
      if (input.htfH1StructureBreakUp) {
        htfVetoed = true;
        htfReason = 'H1_STRUCTURE_BREAK_UP';
      } else if (input.htfH1SwingHigh != null && input.price >= input.htfH1SwingHigh) {
        htfSoftBiasApplied = true;
        htfReason = 'H1_SWING_ABOVE_SOFT';
      }
    }

    const gateAChecks = {
      trendiness: input.trendinessScore >= this.params.gateA.trendinessMin,
      chop: input.chopScore <= this.params.gateA.chopMax,
      volOfVol: input.volOfVol <= this.params.gateA.volOfVolMax,
      spread: input.spreadPct != null && input.spreadPct <= this.params.gateA.spreadPctMax,
      oiDrop: input.oiChangePct == null || input.oiChangePct > this.params.gateA.oiDropBlock,
      htfLevelAligned: !htfVetoed,
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
    const targetConfirmations = htfSoftBiasApplied
      ? this.params.hysteresis.entryConfirmations + 1
      : this.params.hysteresis.entryConfirmations;
    const allGatesPassed = allGatesRaw && runtime.entryConfirmCount >= targetConfirmations;

    // ── BTC Cross Market Veto Derivation (P1: anchor-side aware) ──
    const btcContext = input.btcContext;
    const crossMarketConfiguredForSymbol = Boolean(
      this.params.crossMarket && this.params.crossMarket.enabled && this.params.crossMarket.applyTo.includes(symbol)
    );
    const crossMarketRuntimeActive = input.crossMarketActive !== false;
    const crossMarketActive = crossMarketConfiguredForSymbol && crossMarketRuntimeActive;
    const hasBtcContext = Boolean(btcContext);
    const crossMarketCanEvaluate = crossMarketActive && hasBtcContext;
    const crossMarketMode = this.params.crossMarket.mode;
    const crossMarketTelemetryMode: 'hard_veto' | 'soft_bias' | 'DISABLED_NO_BTC' = crossMarketCanEvaluate
      ? crossMarketMode
      : (crossMarketConfiguredForSymbol ? 'DISABLED_NO_BTC' : crossMarketMode);
    const crossMarketDisableReason: 'BTC_NOT_SELECTED' | 'CONFIG_DISABLED' | null = crossMarketConfiguredForSymbol
      ? (crossMarketCanEvaluate ? null : (crossMarketRuntimeActive ? null : 'BTC_NOT_SELECTED'))
      : 'CONFIG_DISABLED';
    let btcBias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';

    if (crossMarketCanEvaluate && btcContext) {
      if (!btcContext.h1BarStartMs || !btcContext.h4BarStartMs) {
        btcBias = 'NEUTRAL';
      } else if (btcContext.chop > this.params.gateA.chopMax || btcContext.trendiness < this.params.gateA.trendinessMin) {
        btcBias = 'NEUTRAL';
      } else {
        const h4Up = btcContext.h4StructureUp;
        const h4Dn = btcContext.h4StructureDn;
        const h1Up = btcContext.h1StructureUp;
        const h1Dn = btcContext.h1StructureDn;
        if (h4Up && h1Up && !h4Dn && !h1Dn) btcBias = 'LONG';
        else if (h4Dn && h1Dn && !h4Up && !h1Up) btcBias = 'SHORT';
      }
    }

    // ── P1: Derive anchorSide — fallback to BTC DryRun position when NEUTRAL ──
    const btcDrp = input.btcDryRunPosition;
    const btcHasPosition = Boolean(btcDrp && btcDrp.hasPosition && btcDrp.qty > 0);
    let anchorSide: 'BUY' | 'SELL' | 'NONE' = 'NONE';
    let anchorMode: 'BIAS' | 'ANCHOR_POSITION' | 'NONE' = 'NONE';

    if (crossMarketCanEvaluate) {
      if (btcBias === 'LONG') {
        anchorSide = 'BUY';
        anchorMode = 'BIAS';
      } else if (btcBias === 'SHORT') {
        anchorSide = 'SELL';
        anchorMode = 'BIAS';
      } else if (btcBias === 'NEUTRAL' && btcHasPosition && btcDrp) {
        // NEUTRAL bias but BTC has open position → use position as anchor
        anchorSide = btcDrp.side === 'LONG' ? 'BUY' : btcDrp.side === 'SHORT' ? 'SELL' : 'NONE';
        anchorMode = anchorSide !== 'NONE' ? 'ANCHOR_POSITION' : 'NONE';
      }
    }
    // Otherwise cross-market is disabled or lacks BTC context; anchor stays NONE.

    let isCrossMarketVetoed = false;
    let crossMarketBlockReason: OrchestratorV1Decision['crossMarketBlockReason'] = null;

    if (crossMarketCanEvaluate && sideForEntry) {
      if (crossMarketMode === 'hard_veto' && anchorSide !== 'NONE') {
        if (anchorSide === 'BUY' && sideForEntry === 'SELL') {
          isCrossMarketVetoed = true;
        } else if (anchorSide === 'SELL' && sideForEntry === 'BUY') {
          isCrossMarketVetoed = true;
        }
      }

      if (isCrossMarketVetoed) {
        crossMarketBlockReason = {
          refSymbol: 'BTCUSDT',
          btcBias,
          anchorSide,
          anchorMode,
          candidateSymbol: symbol,
          candidateSide: sideForEntry,
          h1BarStartMs: btcContext?.h1BarStartMs ?? null,
          h4BarStartMs: btcContext?.h4BarStartMs ?? null,
          h1Up: btcContext?.h1StructureUp ?? false,
          h1Dn: btcContext?.h1StructureDn ?? false,
          h4Up: btcContext?.h4StructureUp ?? false,
          h4Dn: btcContext?.h4StructureDn ?? false,
          btcHasPosition,
        };
      }
    }

    // ── P2: Side mismatch guard ──
    // If DryRun has an open position on the OPPOSITE side of sideForEntry,
    // block entry to prevent hedged/conflicting positions.
    let isSideMismatchBlocked = false;
    if (drp && drp.hasPosition && drp.qty > 0 && drp.side && sideForEntry) {
      const posOrchSide: OrchestratorV1Side = drp.side === 'LONG' ? 'BUY' : 'SELL';
      if (posOrchSide !== sideForEntry) {
        isSideMismatchBlocked = true;
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // 2-STEP REVERSAL STATE Machine
    // ══════════════════════════════════════════════════════════════════════
    // When position is open and candidateSide is opposite: track flip,
    // convert to EXIT_FLIP after persistence conditions, never direct ENTRY.
    let isFlipExitTriggered = false;
    const positionSideAsBuySell: OrchestratorV1Side | null = isPositionOpen && runtime.side ? runtime.side : null;
    const crossMarketExitEnabled = this.params.crossMarketExit.enabled
      && crossMarketCanEvaluate
      && symbol !== 'BTCUSDT';
    const isCrossMarketMismatch = Boolean(
      crossMarketExitEnabled
      && isPositionOpen
      && anchorSide !== 'NONE'
      && positionSideAsBuySell != null
      && positionSideAsBuySell !== anchorSide
    );
    if (isCrossMarketMismatch) {
      if (runtime.crossMarketMismatchSinceMs == null) {
        runtime.crossMarketMismatchSinceMs = input.nowMs;
      }
    } else {
      runtime.crossMarketMismatchSinceMs = null;
    }
    const crossMarketMismatchElapsedMs = runtime.crossMarketMismatchSinceMs == null
      ? 0
      : Math.max(0, input.nowMs - runtime.crossMarketMismatchSinceMs);
    const crossMarketMismatchExitTriggered = Boolean(
      isCrossMarketMismatch
      && runtime.crossMarketMismatchSinceMs != null
      && crossMarketMismatchElapsedMs >= this.params.crossMarketExit.persistMs
    );

    if (isPositionOpen && legacyCandidateSide && positionSideAsBuySell && legacyCandidateSide !== positionSideAsBuySell) {
      // Opposite side detected while position open
      if (runtime.flipDetectedSide !== legacyCandidateSide) {
        // New flip direction — reset tracking
        runtime.flipDetectedSide = legacyCandidateSide;
        runtime.flipFirstDetectedMs = input.nowMs;
        runtime.flipPersistenceCount = 1;
      } else {
        // Same flip direction — increment persistence
        runtime.flipPersistenceCount += 1;
      }

      const flipElapsedMs = runtime.flipFirstDetectedMs != null
        ? Math.max(0, input.nowMs - runtime.flipFirstDetectedMs)
        : 0;
      const flipIntervalMet = flipElapsedMs >= this.params.hysteresis.minFlipIntervalMs;
      const flipConfirmMet = runtime.flipPersistenceCount >= this.params.hysteresis.entryConfirmations;

      if (flipIntervalMet && flipConfirmMet) {
        // Persistence conditions met → convert to EXIT_FLIP
        isFlipExitTriggered = true;
        runtime.reversalConvertedToExit += 1;
      } else {
        // Not yet persistent → block, count as reversalBlocked
        runtime.reversalBlocked += 1;
      }
    } else if (isPositionOpen) {
      // Side matches or no candidate → reset flip tracking
      runtime.flipDetectedSide = null;
      runtime.flipFirstDetectedMs = null;
      runtime.flipPersistenceCount = 0;
    } else if (!isPositionOpen) {
      // Position flat → reset flip tracking, allow normal entry
      if (runtime.flipDetectedSide != null) {
        // Was tracking a flip, now flat → this is the re-entry opportunity
        runtime.reversalAttempted += 1;
      }
      runtime.flipDetectedSide = null;
      runtime.flipFirstDetectedMs = null;
      runtime.flipPersistenceCount = 0;
    }

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
    let exitRiskReason: 'REGIME' | 'FLOW_FLIP' | 'INTEGRITY' | 'CROSSMARKET_MISMATCH' | null = null;
    const exitRiskEval = this.evaluateExitRisk(input, runtime);

    // ── EXIT_FLIP takes priority over normal exit risk ──
    if (isFlipExitTriggered) {
      intent = 'EXIT_FLIP';
      runtime.lastExitReasonCode = 'EXIT_FLIP';
      runtime.exitOnFlipCount += 1;
      // Use the exit risk machinery to close the position
      if (!runtime.exitRiskActive) {
        runtime.exitRiskActive = true;
        runtime.exitMakerAttempts = 0;
        runtime.exitTakerUsed = false;
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
      if (isPositionOpen && crossMarketMismatchExitTriggered) {
        intent = 'EXIT_RISK';
        exitRiskReason = 'CROSSMARKET_MISMATCH';
        runtime.lastExitReasonCode = 'EXIT_CROSSMARKET_MISMATCH';
        if (!runtime.exitRiskActive) {
          runtime.exitRiskActive = true;
          runtime.exitMakerAttempts = 0;
          runtime.exitTakerUsed = false;
          runtime.exitRiskTriggeredCount += 1;
          runtime.crossMarketMismatchExitTriggeredCount += 1;
          exitRiskTriggeredThisTick = true;
        }
        const riskEscalated = exitRiskEval.triggered;
        if (riskEscalated && !runtime.exitTakerUsed) {
          runtime.exitTakerUsed = true;
          orders.push(this.buildExitTakerOrder(runtime));
          this.closePosition(runtime, input.nowMs);
        } else if (runtime.exitMakerAttempts < this.params.exitRisk.makerAttempts) {
          runtime.exitMakerAttempts += 1;
          orders.push(this.buildExitMakerOrder(input, runtime, runtime.exitMakerAttempts));
        } else if (!runtime.exitTakerUsed) {
          runtime.exitTakerUsed = true;
          orders.push(this.buildExitTakerOrder(runtime));
          this.closePosition(runtime, input.nowMs);
        }
        runtime.active = false;
      } else if (isPositionOpen && exitRiskEval.triggered) {
        intent = 'EXIT_RISK';
        exitRiskReason = exitRiskEval.reason;
        if (exitRiskEval.reason === 'REGIME') runtime.lastExitReasonCode = 'EXIT_RISK_REGIME';
        else if (exitRiskEval.reason === 'FLOW_FLIP') runtime.lastExitReasonCode = 'EXIT_RISK_FLOW_FLIP';
        else if (exitRiskEval.reason === 'INTEGRITY') runtime.lastExitReasonCode = 'EXIT_RISK_INTEGRITY';
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
          // ════════════════════════════════════════════════════════════════════
          // CHASE STATE MACHINE (with sticky startTs)
          // ════════════════════════════════════════════════════════════════════

          // 1.4 ── Timeout check (INDEPENDENT of fill / reprice)
          const chaseElapsedMs = runtime.chaseStartTs != null
            ? Math.max(0, input.nowMs - runtime.chaseStartTs)
            : 0;

          // Track max elapsed
          if (chaseElapsedMs > runtime.chaseElapsedMaxMs) {
            runtime.chaseElapsedMaxMs = chaseElapsedMs;
          }

          const expiredByTime = chaseElapsedMs >= chaseMaxMs;
          const expiredByReprices = runtime.repricesUsed >= this.params.entry.maxReprices;

          if (expiredByTime && !runtime.chaseTimedOut) {
            // ── Fire TIMEOUT exactly once ──────────────────────────────────
            runtime.chaseTimedOut = true;
            runtime.chaseActive = false;
            runtime.chaseTimedOutCount += 1;

            // ── 2.2 Fallback eligibility ──────────────────────────────────
            const gates = allGatesRaw; // use raw (not confirm-count gated) for fallback
            const fallbackEligible = impulse.passed && gates;

            if (fallbackEligible) {
              runtime.fallbackEligibleCount += 1;

              // ── 2.3 Trigger fallback (<= 25%) ─────────────────────────
              if (!runtime.takerFallbackUsed && runtime.side) {
                runtime.takerFallbackUsed = true;
                runtime.active = false;
                runtime.cooldownUntilMs = input.nowMs + this.params.entry.cooldownMs;
                runtime.cooldownUntilTs = runtime.cooldownUntilMs;

                // Guarantee <= 25%
                const fallbackNotionalPct = Math.min(this.params.fallback.maxNotionalPct, 0.25);
                const fallbackQty = runtime.baseQty * fallbackNotionalPct;

                orders.push(this.buildTakerFallbackOrder(runtime.side, runtime.repricesUsed, fallbackQty, fallbackNotionalPct));
                runtime.positionQty = runtime.baseQty;
                runtime.entryVwap = input.price;
                runtime.addsUsed = 0;
                runtime.lastAddTs = null;
                runtime.fallbackTriggeredCount += 1;
                intent = 'ENTRY';
              }
            } else {
              // Not eligible — record blocked reason
              if (!impulse.passed) {
                runtime.fallbackBlocked_IMPULSE_FALSE += 1;
              } else {
                runtime.fallbackBlocked_GATES_FALSE += 1;
              }
              // Deactivate chase, go to cooldown
              runtime.active = false;
              runtime.cooldownUntilMs = input.nowMs + this.params.entry.cooldownMs;
              runtime.cooldownUntilTs = runtime.cooldownUntilMs;
            }
          } else if (!expiredByTime) {
            // ── Still within chase window: reprice if possible ───────────
            const canReprice = !expiredByReprices
              && (runtime.chaseLastRepriceTs == null
                || (input.nowMs - runtime.chaseLastRepriceTs) >= this.params.entry.repriceMs);

            if (allGatesPassed && canReprice && runtime.side && !isCrossMarketVetoed) {
              runtime.repricesUsed += 1;
              runtime.chaseAttempts += 1;
              // NOTE: chaseLastRepriceTs updates, but chaseStartTs NEVER changes (sticky)
              runtime.chaseLastRepriceTs = input.nowMs;
              runtime.lastRepriceAtMs = input.nowMs;
              orders.push(...this.buildMakerOrders(input, runtime.side, runtime.repricesUsed, runtime.baseQty));
              intent = 'ENTRY';
            } else if (expiredByReprices && !runtime.chaseTimedOut) {
              // Max reprices hit before time: treat like timeout for fallback path
              runtime.chaseTimedOut = true;
              runtime.chaseActive = false;
              runtime.chaseTimedOutCount += 1;

              const gates = allGatesRaw;
              const fallbackEligible = impulse.passed && gates;

              if (fallbackEligible) {
                runtime.fallbackEligibleCount += 1;
                if (!runtime.takerFallbackUsed && runtime.side) {
                  runtime.takerFallbackUsed = true;
                  runtime.active = false;
                  runtime.cooldownUntilMs = input.nowMs + this.params.entry.cooldownMs;
                  runtime.cooldownUntilTs = runtime.cooldownUntilMs;
                  const fallbackNotionalPct = Math.min(this.params.fallback.maxNotionalPct, 0.25);
                  const fallbackQty = runtime.baseQty * fallbackNotionalPct;
                  orders.push(this.buildTakerFallbackOrder(runtime.side, runtime.repricesUsed, fallbackQty, fallbackNotionalPct));
                  runtime.positionQty = runtime.baseQty;
                  runtime.entryVwap = input.price;
                  runtime.addsUsed = 0;
                  runtime.lastAddTs = null;
                  runtime.fallbackTriggeredCount += 1;
                  intent = 'ENTRY';
                }
              } else {
                if (!impulse.passed) {
                  runtime.fallbackBlocked_IMPULSE_FALSE += 1;
                } else {
                  runtime.fallbackBlocked_GATES_FALSE += 1;
                }
                runtime.active = false;
                runtime.cooldownUntilMs = input.nowMs + this.params.entry.cooldownMs;
                runtime.cooldownUntilTs = runtime.cooldownUntilMs;
              }
            } else if (!allGatesPassed || isCrossMarketVetoed) {
              // Gates dropped or vetoed while chasing: abort chase
              runtime.active = false;
              runtime.chaseActive = false;
              runtime.cooldownUntilMs = input.nowMs + this.params.entry.cooldownMs;
              runtime.cooldownUntilTs = runtime.cooldownUntilMs;
            }
          }
          // if expiredByTime && chaseTimedOut already → do nothing (fallback path already executed)

        } else {
          // ── NEW CHASE: idle state, try to start ──────────────────────────
          const readyAfterCooldown = input.nowMs >= Math.max(runtime.cooldownUntilMs, runtime.cooldownUntilTs);
          const canEnterRaw = allGatesPassed && sideForEntry != null && readyAfterCooldown;
          const canEnter = canEnterRaw && !isCrossMarketVetoed && !isSideMismatchBlocked;

          // Telemetry
          if (canEnterRaw && crossMarketCanEvaluate && sideForEntry) {
            if (isCrossMarketVetoed) {
              runtime.crossMarketVetoCount += 1;
            } else if (btcBias === 'NEUTRAL') {
              runtime.crossMarketNeutralCount += 1;
            } else {
              runtime.crossMarketAllowedCount += 1;
            }
          }

          if (canEnter && sideForEntry) {
            runtime.active = true;

            // 1.2 ── Start chase (sticky: only set chaseStartTs on false→true)
            if (!runtime.chaseActive) {
              runtime.chaseActive = true;
              runtime.chaseStartTs = input.nowMs;         // STICKY – never reset during reprice
              runtime.chaseAttempts = 0;
              runtime.chaseTimedOut = false;
              runtime.chaseLastRepriceTs = input.nowMs;
              runtime.chaseStartedCount += 1;
            }

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

    } // end of `else` block for isFlipExitTriggered

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

    // ── Compute chase debug view for this tick ────────────────────────────────
    const nowChaseElapsedMs = runtime.chaseStartTs != null
      ? Math.max(0, input.nowMs - runtime.chaseStartTs)
      : 0;

    let fallbackBlockedReason: OrchestratorV1ChaseDebugView['fallbackBlockedReason'] = 'NONE';
    if (!runtime.chaseTimedOut && !runtime.active) {
      fallbackBlockedReason = 'NO_TIMEOUT';
    } else if (runtime.chaseTimedOut && !runtime.takerFallbackUsed) {
      if (!impulse.passed) fallbackBlockedReason = 'IMPULSE_FALSE';
      else fallbackBlockedReason = 'GATES_FALSE';
    }

    const chaseDebug: OrchestratorV1ChaseDebugView = {
      chaseActive: runtime.chaseActive,
      chaseStartTs: runtime.chaseStartTs,
      chaseElapsedMs: nowChaseElapsedMs,
      chaseAttempts: runtime.chaseAttempts,
      chaseTimedOut: runtime.chaseTimedOut,
      impulse: impulse.passed,
      fallbackEligible: runtime.chaseTimedOut && impulse.passed && allGatesRaw,
      fallbackBlockedReason,
    };

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
        expiresAtMs: runtime.chaseStartTs != null ? runtime.chaseStartTs + chaseMaxMs : null,
        repriceMs: this.params.entry.repriceMs,
        maxReprices: this.params.entry.maxReprices,
        repricesUsed: runtime.repricesUsed,
        chaseMaxSeconds: this.params.entry.chaseMaxSeconds,
        ttlMs: this.params.entry.ttlMs,
      },
      chaseDebug,
      crossMarketBlockReason,
      telemetry: {
        sideFlipCount5m: runtime.sideFlipEvents5m.length,
        sideFlipPerMin: Number((runtime.sideFlipEvents5m.length / 5).toFixed(4)),
        allGatesTrueCount5m: runtime.gateTrueEvents5m.length,
        entryIntentCount5m: runtime.entryIntentEvents5m.length,
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
        chase: {
          chaseStartedCount: runtime.chaseStartedCount,
          chaseTimedOutCount: runtime.chaseTimedOutCount,
          chaseElapsedMaxMs: runtime.chaseElapsedMaxMs,
          fallbackEligibleCount: runtime.fallbackEligibleCount,
          fallbackTriggeredCount: runtime.fallbackTriggeredCount,
          fallbackBlocked_NO_TIMEOUT: runtime.fallbackBlocked_NO_TIMEOUT,
          fallbackBlocked_IMPULSE_FALSE: runtime.fallbackBlocked_IMPULSE_FALSE,
          fallbackBlocked_GATES_FALSE: runtime.fallbackBlocked_GATES_FALSE,
        },
        crossMarket: {
          crossMarketVetoCount: runtime.crossMarketVetoCount,
          crossMarketNeutralCount: runtime.crossMarketNeutralCount,
          crossMarketAllowedCount: runtime.crossMarketAllowedCount,
          active: crossMarketCanEvaluate,
          mode: crossMarketTelemetryMode,
          disableReason: crossMarketDisableReason,
          anchorSide,
          anchorMode,
          btcHasPosition,
          mismatchActive: isCrossMarketMismatch,
          mismatchSinceMs: runtime.crossMarketMismatchSinceMs,
          exitTriggeredCount: runtime.crossMarketMismatchExitTriggeredCount,
        },
        lastExitReasonCode: runtime.lastExitReasonCode,
        reversal: {
          reversalAttempted: runtime.reversalAttempted,
          reversalBlocked: runtime.reversalBlocked,
          reversalConvertedToExit: runtime.reversalConvertedToExit,
          exitOnFlipCount: runtime.exitOnFlipCount,
          currentPositionSide: positionSideAsBuySell,
          sideCandidate: legacyCandidateSide,
          flipPersistenceCount: runtime.flipPersistenceCount,
          flipFirstDetectedMs: runtime.flipFirstDetectedMs,
          minFlipIntervalMs: this.params.hysteresis.minFlipIntervalMs,
          entryConfirmations: this.params.hysteresis.entryConfirmations,
        },
        htf: {
          ...htfLevelState,
          vetoed: htfVetoed,
          softBiasApplied: htfSoftBiasApplied,
          reason: htfReason,
        },
        superScalp: {
          active: input.superScalpEnabled === true,
          m15SwingLow: input.m15SwingLow ?? null,
          m15SwingHigh: input.m15SwingHigh ?? null,
          sweepDetected: superScalpEval.sweepDetected,
          reclaimDetected: superScalpEval.reclaimDetected,
          sideCandidate: input.superScalpEnabled ? candidateSideForEntry : null,
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
    // Chase state reset
    runtime.chaseActive = false;
    runtime.chaseStartTs = null;
    runtime.chaseLastRepriceTs = null;
    runtime.chaseAttempts = 0;
    runtime.chaseTimedOut = false;
    runtime.m15LongSweepTs = null;
    runtime.m15ShortSweepTs = null;
    runtime.crossMarketMismatchSinceMs = null;
    runtime.lastExitReasonCode = null;
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

  private evaluateSuperScalp(
    input: OrchestratorV1Input,
    runtime: OrchestratorV1RuntimeState,
    smoothed: { deltaZ: number; cvdSlope: number }
  ): SuperScalpEvaluation {
    const swingLow = input.m15SwingLow;
    const swingHigh = input.m15SwingHigh;
    if (!input.superScalpEnabled) {
      return { sideCandidate: null, sweepDetected: false, reclaimDetected: false };
    }
    if (!isFiniteNumber(swingLow) || !isFiniteNumber(swingHigh)) {
      runtime.m15LongSweepTs = null;
      runtime.m15ShortSweepTs = null;
      return { sideCandidate: null, sweepDetected: false, reclaimDetected: false };
    }

    const sweepWindowMs = clamp(this.params.superScalp.sweepWindowMs, 60_000, 120_000);

    if (input.price <= swingLow) {
      runtime.m15LongSweepTs = input.nowMs;
    }
    if (input.price >= swingHigh) {
      runtime.m15ShortSweepTs = input.nowMs;
    }

    const longSweepRecent = runtime.m15LongSweepTs != null && (input.nowMs - runtime.m15LongSweepTs) <= sweepWindowMs;
    const shortSweepRecent = runtime.m15ShortSweepTs != null && (input.nowMs - runtime.m15ShortSweepTs) <= sweepWindowMs;
    const longReclaim = longSweepRecent && input.price > swingLow;
    const shortReclaim = shortSweepRecent && input.price < swingHigh;

    const longFlow = smoothed.deltaZ > 0 && smoothed.cvdSlope > 0 && input.obiDeep >= 0;
    const shortFlow = smoothed.deltaZ < 0 && smoothed.cvdSlope < 0 && input.obiDeep <= 0;
    const longReady = longReclaim && longFlow;
    const shortReady = shortReclaim && shortFlow;

    let sideCandidate: OrchestratorV1Side | null = null;
    if (longReady && !shortReady) {
      sideCandidate = 'BUY';
    } else if (shortReady && !longReady) {
      sideCandidate = 'SELL';
    } else if (longReady && shortReady) {
      const longTs = runtime.m15LongSweepTs ?? 0;
      const shortTs = runtime.m15ShortSweepTs ?? 0;
      if (longTs > shortTs) sideCandidate = 'BUY';
      else if (shortTs > longTs) sideCandidate = 'SELL';
    }

    return {
      sideCandidate,
      sweepDetected: longSweepRecent || shortSweepRecent,
      reclaimDetected: longReclaim || shortReclaim,
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
  ): { triggered: boolean; reason: 'REGIME' | 'FLOW_FLIP' | 'INTEGRITY' | 'CROSSMARKET_MISMATCH' | null } {
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
    // Chase state reset on position close
    runtime.chaseActive = false;
    runtime.chaseStartTs = null;
    runtime.chaseLastRepriceTs = null;
    runtime.chaseAttempts = 0;
    runtime.chaseTimedOut = false;
    runtime.m15LongSweepTs = null;
    runtime.m15ShortSweepTs = null;
    runtime.crossMarketMismatchSinceMs = null;
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

  private buildTakerFallbackOrder(side: OrchestratorV1Side, repriceAttempt: number, qty: number, notionalPct: number): OrchestratorV1Order {
    return {
      id: `fallback-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      kind: 'TAKER_ENTRY_FALLBACK',
      side,
      qty,
      notionalPct,
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
