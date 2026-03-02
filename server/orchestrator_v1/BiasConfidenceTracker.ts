export type OrchestratorBiasSide = 'LONG' | 'SHORT' | 'NONE';

export interface ResolveBiasConfidenceInput {
  symbol: string;
  side: OrchestratorBiasSide;
  hasOpenPosition: boolean;
  allGatesPassed: boolean;
  readinessReady: boolean;
  rawConfidence?: number | null;
}

export type BiasBranchUsed =
  | 'RAW'
  | 'CARRY_FORWARD'
  | 'SMOOTH_DECAY'
  | 'BASE_DIRECTIONAL'
  | 'NEUTRAL_DECAY'
  | 'NEUTRAL_ZERO';

export interface BiasConfidenceResolution {
  confidence: number;
  rawBias: number | null;
  normalizedBias: number;
  clampedBias: number;
  branchUsed: BiasBranchUsed;
}

interface BiasMemory {
  side: OrchestratorBiasSide;
  confidence: number;
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export class BiasConfidenceTracker {
  private readonly bySymbol = new Map<string, BiasMemory>();

  public resolve(input: ResolveBiasConfidenceInput): number {
    return this.resolveWithDebug(input).confidence;
  }

  public resolveWithDebug(input: ResolveBiasConfidenceInput): BiasConfidenceResolution {
    const symbol = String(input.symbol || '').toUpperCase();
    const side: OrchestratorBiasSide = input.side;
    const directional = side === 'LONG' || side === 'SHORT';
    const previous = this.bySymbol.get(symbol) || null;
    const previousSameSide = previous && previous.side === side ? clamp01(previous.confidence) : null;

    const raw = Number(input.rawConfidence);
    const hasRaw = input.rawConfidence != null && Number.isFinite(raw);
    const rawBias = hasRaw ? raw : null;
    const baseDirectional = input.hasOpenPosition
      ? 1
      : input.allGatesPassed
        ? 0.8
        : 0.72;

    let nextConfidence: number;
    let branchUsed: BiasBranchUsed;
    if (hasRaw) {
      nextConfidence = clamp01(raw);
      branchUsed = 'RAW';
    } else if (directional) {
      if (!input.readinessReady && previousSameSide != null) {
        // Missing/unstable tick -> carry-forward to avoid hard resets.
        nextConfidence = previousSameSide;
        branchUsed = 'CARRY_FORWARD';
      } else if (previousSameSide != null) {
        // Smoothly decay toward current directional baseline.
        nextConfidence = Math.max(baseDirectional, previousSameSide * 0.98);
        branchUsed = 'SMOOTH_DECAY';
      } else {
        nextConfidence = baseDirectional;
        branchUsed = 'BASE_DIRECTIONAL';
      }
    } else if (previous && Number.isFinite(previous.confidence)) {
      nextConfidence = clamp01(previous.confidence * 0.95);
      branchUsed = 'NEUTRAL_DECAY';
    } else {
      nextConfidence = 0;
      branchUsed = 'NEUTRAL_ZERO';
    }

    const normalizedBias = Number(nextConfidence);
    const clampedBias = clamp01(normalizedBias);
    const confidence = Number(clampedBias.toFixed(4));
    this.bySymbol.set(symbol, { side, confidence });
    return {
      confidence,
      rawBias,
      normalizedBias,
      clampedBias,
      branchUsed,
    };
  }
}
