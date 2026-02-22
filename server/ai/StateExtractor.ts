import { StrategySide } from '../types/strategy';
import { AIMetricsSnapshot } from './types';

export type FlowState = 'EXPANSION' | 'EXHAUSTION' | 'ABSORPTION' | 'NEUTRAL';
export type RegimeState = 'TREND' | 'CHOP' | 'TRANSITION' | 'VOL_EXPANSION';
export type DerivativesState = 'LONG_BUILD' | 'SHORT_BUILD' | 'DELEVERAGING' | 'SQUEEZE_RISK';
export type ToxicityState = 'CLEAN' | 'AGGRESSIVE' | 'TOXIC';
export type ExecutionHealthState = 'HEALTHY' | 'WIDENING_SPREAD' | 'LOW_RESILIENCY';
export type TrendSign = 'UP' | 'DOWN' | 'FLAT';
export type DirectionalBias = StrategySide | 'NEUTRAL';

export interface DeterministicStateSnapshot {
  symbol: string;
  timestampMs: number;
  flowState: FlowState;
  regimeState: RegimeState;
  derivativesState: DerivativesState;
  toxicityState: ToxicityState;
  executionState: ExecutionHealthState;
  stateConfidence: number;
  directionalBias: DirectionalBias;
  cvdSlopeSign: TrendSign;
  oiDirection: TrendSign;
  volatilityPercentile: number;
  expectedSlippageBps: number;
  spreadBps: number;
}

type StateKey = 'flowState' | 'regimeState' | 'derivativesState' | 'toxicityState' | 'executionState';

type StableState<T extends string> = {
  current: T;
  pending: T | null;
  pendingCount: number;
};

type SymbolMemory = {
  flowState: StableState<FlowState>;
  regimeState: StableState<RegimeState>;
  derivativesState: StableState<DerivativesState>;
  toxicityState: StableState<ToxicityState>;
  executionState: StableState<ExecutionHealthState>;
  volWindow: number[];
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const initializeStableState = <T extends string>(initial: T): StableState<T> => ({
  current: initial,
  pending: null,
  pendingCount: 0,
});

const defaultMemory = (): SymbolMemory => ({
  flowState: initializeStableState<FlowState>('NEUTRAL'),
  regimeState: initializeStableState<RegimeState>('TRANSITION'),
  derivativesState: initializeStableState<DerivativesState>('DELEVERAGING'),
  toxicityState: initializeStableState<ToxicityState>('CLEAN'),
  executionState: initializeStableState<ExecutionHealthState>('HEALTHY'),
  volWindow: [],
});

export class StateExtractor {
  private readonly memory = new Map<string, SymbolMemory>();
  private readonly windowSize: number;

  constructor(windowSize = Math.max(5, Math.min(20, Number(process.env.AI_STATE_WINDOW_SIZE || 20)))) {
    this.windowSize = windowSize;
  }

  extract(snapshot: AIMetricsSnapshot): DeterministicStateSnapshot {
    const symbol = String(snapshot.symbol || '').toUpperCase();
    const nowMs = Number(snapshot.timestampMs || Date.now());
    const state = this.getMemory(symbol);

    const volatility = Math.max(0, Number(snapshot.volatility || 0));
    state.volWindow.push(volatility);
    if (state.volWindow.length > this.windowSize) {
      state.volWindow.splice(0, state.volWindow.length - this.windowSize);
    }

    const volPercentile = this.computePercentile(state.volWindow, volatility);
    const spreadPct = Number.isFinite(snapshot.market.spreadPct as number)
      ? Math.max(0, Math.abs(Number(snapshot.market.spreadPct || 0)))
      : 0;
    const spreadBps = spreadPct * 10_000;
    const expectedSlippageBps = Math.max(
      0,
      Number(snapshot.liquidityMetrics.expectedSlippageBuy || 0),
      Number(snapshot.liquidityMetrics.expectedSlippageSell || 0)
    );

    const flow = this.classifyFlow(snapshot);
    const regime = this.classifyRegime(snapshot, volPercentile);
    const derivatives = this.classifyDerivatives(snapshot);
    const toxicity = this.classifyToxicity(snapshot);
    const execution = this.classifyExecution(snapshot, spreadBps, expectedSlippageBps);

    const directionalBias = this.resolveDirectionalBias(snapshot);
    const cvdSlopeSign = this.resolveSign(Number(snapshot.market.cvdSlope || 0), 10_000);
    const oiDirection = this.resolveSign(Number(snapshot.openInterest.oiChangePct || 0), 0.05);

    const flowState = this.stabilize(state, 'flowState', flow.state);
    const regimeState = this.stabilize(state, 'regimeState', regime.state, new Set<RegimeState>(['VOL_EXPANSION']));
    const derivativesState = this.stabilize(state, 'derivativesState', derivatives.state);
    const toxicityState = this.stabilize(state, 'toxicityState', toxicity.state, new Set<ToxicityState>(['TOXIC']));
    const executionState = this.stabilize(state, 'executionState', execution.state, new Set<ExecutionHealthState>(['LOW_RESILIENCY']));

    const directionalConfidence = directionalBias === 'NEUTRAL' ? 0.35 : 0.72;
    const confidence = clamp(
      (flow.confidence + regime.confidence + derivatives.confidence + toxicity.confidence + execution.confidence + directionalConfidence) / 6,
      0,
      1
    );

    return {
      symbol,
      timestampMs: nowMs,
      flowState,
      regimeState,
      derivativesState,
      toxicityState,
      executionState,
      stateConfidence: Number(confidence.toFixed(4)),
      directionalBias,
      cvdSlopeSign,
      oiDirection,
      volatilityPercentile: Number(volPercentile.toFixed(4)),
      expectedSlippageBps: Number(expectedSlippageBps.toFixed(4)),
      spreadBps: Number(spreadBps.toFixed(4)),
    };
  }

  private getMemory(symbol: string): SymbolMemory {
    let state = this.memory.get(symbol);
    if (!state) {
      state = defaultMemory();
      this.memory.set(symbol, state);
    }
    return state;
  }

  private classifyFlow(snapshot: AIMetricsSnapshot): { state: FlowState; confidence: number } {
    const deltaZ = Number(snapshot.market.deltaZ || 0);
    const cvd = Number(snapshot.market.cvdSlope || 0);
    const obi = Number(snapshot.market.obiDeep || 0);
    const absorptionSide = snapshot.absorption.side;
    const absorptionValue = Math.max(0, Number(snapshot.absorption.value || 0));

    if (absorptionSide && absorptionValue >= 0.55) {
      return { state: 'ABSORPTION', confidence: clamp(0.65 + (absorptionValue * 0.25), 0, 1) };
    }

    const deltaStrong = Math.abs(deltaZ) >= 1.2;
    const cvdStrong = Math.abs(cvd) >= 12_000;
    const sameDirection = (deltaZ >= 0 && cvd >= 0) || (deltaZ <= 0 && cvd <= 0);

    if (deltaStrong && cvdStrong && sameDirection) {
      return {
        state: 'EXPANSION',
        confidence: clamp(0.55 + Math.min(0.35, (Math.abs(deltaZ) / 4) + (Math.abs(cvd) / 80_000)), 0, 1),
      };
    }

    const conflicting = (deltaZ > 0 && cvd < 0) || (deltaZ < 0 && cvd > 0);
    const weakBookImbalance = Math.abs(obi) < 0.04 && Math.abs(deltaZ) < 1;
    if (conflicting || weakBookImbalance) {
      return {
        state: 'EXHAUSTION',
        confidence: clamp(0.5 + Math.min(0.35, Math.abs(deltaZ) / 5), 0, 1),
      };
    }

    return { state: 'NEUTRAL', confidence: 0.45 };
  }

  private classifyRegime(snapshot: AIMetricsSnapshot, volPercentile: number): { state: RegimeState; confidence: number } {
    const trend = Number(snapshot.regimeMetrics.trendinessScore || 0);
    const chop = Number(snapshot.regimeMetrics.chopScore || 0);
    const volOfVol = Number(snapshot.regimeMetrics.volOfVol || 0);

    if (volPercentile >= 90 || volOfVol >= 0.08) {
      return {
        state: 'VOL_EXPANSION',
        confidence: clamp(0.6 + Math.min(0.35, ((volPercentile - 90) / 10) + (volOfVol * 1.2)), 0, 1),
      };
    }

    if (trend >= 0.58 && trend > chop + 0.08) {
      return { state: 'TREND', confidence: clamp(0.55 + (trend - chop), 0, 1) };
    }

    if (chop >= 0.58 && chop > trend + 0.08) {
      return { state: 'CHOP', confidence: clamp(0.55 + (chop - trend), 0, 1) };
    }

    return { state: 'TRANSITION', confidence: 0.5 };
  }

  private classifyDerivatives(snapshot: AIMetricsSnapshot): { state: DerivativesState; confidence: number } {
    const oiChange = Number(snapshot.openInterest.oiChangePct || 0);
    const delta = Number(snapshot.market.delta1s || 0) + Number(snapshot.market.delta5s || 0);
    const liqProxy = Number(snapshot.derivativesMetrics.liquidationProxyScore || 0);

    if (liqProxy >= 0.65) {
      return { state: 'SQUEEZE_RISK', confidence: clamp(0.6 + Math.min(0.35, liqProxy * 0.5), 0, 1) };
    }

    if (oiChange <= -0.12) {
      return {
        state: 'DELEVERAGING',
        confidence: clamp(0.55 + Math.min(0.35, Math.abs(oiChange) / 1.4), 0, 1),
      };
    }

    if (oiChange >= 0.08 && delta >= 0) {
      return {
        state: 'LONG_BUILD',
        confidence: clamp(0.55 + Math.min(0.35, (oiChange / 1.2) + (Math.abs(delta) / 4_000)), 0, 1),
      };
    }

    if (oiChange >= 0.08 && delta < 0) {
      return {
        state: 'SHORT_BUILD',
        confidence: clamp(0.55 + Math.min(0.35, (oiChange / 1.2) + (Math.abs(delta) / 4_000)), 0, 1),
      };
    }

    return { state: 'DELEVERAGING', confidence: 0.45 };
  }

  private classifyToxicity(snapshot: AIMetricsSnapshot): { state: ToxicityState; confidence: number } {
    const vpin = Math.max(0, Number(snapshot.toxicityMetrics.vpinApprox || 0));
    const impact = Math.max(0, Number(snapshot.toxicityMetrics.priceImpactPerSignedNotional || 0));
    const burst = Math.max(0, Number(snapshot.toxicityMetrics.burstPersistenceScore || 0));

    const toxicByFlow = vpin >= 0.88 && burst >= 0.75;
    const toxicByBurst = burst >= 0.93;
    const toxicByImpact = impact >= 0.00012;
    if (toxicByFlow || toxicByBurst || toxicByImpact) {
      return { state: 'TOXIC', confidence: clamp(0.64 + Math.min(0.3, (vpin * 0.25) + (burst * 0.2)), 0, 1) };
    }

    if (vpin >= 0.68 || burst >= 0.7 || impact >= 0.00005) {
      return { state: 'AGGRESSIVE', confidence: clamp(0.55 + Math.min(0.25, (vpin * 0.2) + (burst * 0.15)), 0, 1) };
    }

    return { state: 'CLEAN', confidence: 0.6 };
  }

  private classifyExecution(
    snapshot: AIMetricsSnapshot,
    spreadBps: number,
    expectedSlippageBps: number
  ): { state: ExecutionHealthState; confidence: number } {
    const resiliency = Number(snapshot.liquidityMetrics.resiliencyMs || 0);

    const lowBySpread = spreadBps >= 24;
    const lowBySlip = expectedSlippageBps >= 14;
    const lowByResiliency = resiliency >= 20_000 && (spreadBps >= 6 || expectedSlippageBps >= 3);
    const lowByCombo = resiliency >= 12_000 && (spreadBps >= 12 || expectedSlippageBps >= 6);
    if (lowBySpread || lowBySlip || lowByResiliency || lowByCombo) {
      return { state: 'LOW_RESILIENCY', confidence: clamp(0.6 + Math.min(0.34, (spreadBps / 50) + (expectedSlippageBps / 24)), 0, 1) };
    }

    const wideningByResiliency = resiliency >= 8_000 && (spreadBps >= 4 || expectedSlippageBps >= 2);
    if (wideningByResiliency || spreadBps >= 8 || expectedSlippageBps >= 4) {
      return { state: 'WIDENING_SPREAD', confidence: clamp(0.53 + Math.min(0.28, (spreadBps / 60) + (expectedSlippageBps / 36)), 0, 1) };
    }

    return { state: 'HEALTHY', confidence: 0.62 };
  }

  private resolveDirectionalBias(snapshot: AIMetricsSnapshot): DirectionalBias {
    const delta = Number(snapshot.market.delta1s || 0) + Number(snapshot.market.delta5s || 0);
    const cvd = Number(snapshot.market.cvdSlope || 0);
    const obi = Number(snapshot.market.obiDeep || 0);
    const absorption = snapshot.absorption.side;

    let longVotes = 0;
    let shortVotes = 0;

    if (delta > 0) longVotes += 1;
    if (delta < 0) shortVotes += 1;
    if (cvd > 0) longVotes += 1;
    if (cvd < 0) shortVotes += 1;
    if (obi > 0.08) longVotes += 1;
    if (obi < -0.08) shortVotes += 1;
    if (absorption === 'buy') longVotes += 1;
    if (absorption === 'sell') shortVotes += 1;

    if (longVotes >= 2 && longVotes > shortVotes) return 'LONG';
    if (shortVotes >= 2 && shortVotes > longVotes) return 'SHORT';
    return 'NEUTRAL';
  }

  private resolveSign(value: number, threshold: number): TrendSign {
    if (value > threshold) return 'UP';
    if (value < -Math.abs(threshold)) return 'DOWN';
    return 'FLAT';
  }

  private computePercentile(values: number[], value: number): number {
    if (!Array.isArray(values) || values.length < 3) return 50;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = sorted.findIndex((x) => value <= x);
    if (idx < 0) return 100;
    return clamp((idx / (sorted.length - 1)) * 100, 0, 100);
  }

  private stabilize<T extends string>(
    state: SymbolMemory,
    key: StateKey,
    candidate: T,
    criticalStates?: Set<T>
  ): T {
    const container = state[key] as StableState<T>;
    if (container.current === candidate) {
      container.pending = null;
      container.pendingCount = 0;
      return container.current;
    }

    if (criticalStates && criticalStates.has(candidate)) {
      container.current = candidate;
      container.pending = null;
      container.pendingCount = 0;
      return container.current;
    }

    if (container.pending !== candidate) {
      container.pending = candidate;
      container.pendingCount = 1;
      return container.current;
    }

    container.pendingCount += 1;
    if (container.pendingCount >= 2) {
      container.current = candidate;
      container.pending = null;
      container.pendingCount = 0;
    }

    return container.current;
  }
}
