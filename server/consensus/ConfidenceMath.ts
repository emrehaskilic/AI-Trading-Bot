import { SignalSide, StrategySignal } from '../strategies/StrategyInterface';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function calculateWeightedConfidence(signals: StrategySignal[]): number {
  if (signals.length === 0) return 0;
  let totalWeight = 0;
  let weighted = 0;

  for (const signal of signals) {
    const weight = clamp01(signal.confidence);
    weighted += clamp01(signal.confidence) * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return 0;
  return clamp01(weighted / totalWeight);
}

export function calculateWeightedConfidenceBySide(signals: StrategySignal[]): { LONG: number; SHORT: number; FLAT: number } {
  return {
    LONG: calculateWeightedConfidence(signals.filter((s) => s.side === SignalSide.LONG)),
    SHORT: calculateWeightedConfidence(signals.filter((s) => s.side === SignalSide.SHORT)),
    FLAT: calculateWeightedConfidence(signals.filter((s) => s.side === SignalSide.FLAT)),
  };
}

export function calculateQuorumScore(activeSignals: number, minRequired: number, totalRegistered: number): number {
  if (minRequired <= 0) return 1;
  const base = Math.min(1, Math.max(0, activeSignals / minRequired));
  const participation = totalRegistered > 0 ? Math.min(1, Math.max(0, activeSignals / totalRegistered)) : 1;
  return clamp01((base * 0.7) + (participation * 0.3));
}

export function aggregateConfidence(weightedConfidence: number, quorumScore: number, quorumExponent = 0.5): number {
  const wc = clamp01(weightedConfidence);
  const qs = clamp01(quorumScore);
  if (qs <= 0) return 0;
  return clamp01(wc * Math.pow(qs, quorumExponent));
}

export function calculateConfidenceDelta(newConfidence: number, oldConfidence: number): number {
  return clamp01(newConfidence) - clamp01(oldConfidence);
}

export function smoothConfidence(newConfidence: number, previousSmoothed: number, alpha = 0.3): number {
  const a = clamp01(alpha);
  return clamp01((a * clamp01(newConfidence)) + ((1 - a) * clamp01(previousSmoothed)));
}
