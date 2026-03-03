import { SignalSide, StrategySignal } from '../strategies/StrategyInterface';
import { ConflictResolutionResult } from './types';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function hasConflict(signals: StrategySignal[]): boolean {
  const hasLong = signals.some((s) => s.side === SignalSide.LONG);
  const hasShort = signals.some((s) => s.side === SignalSide.SHORT);
  return hasLong && hasShort;
}

export function calculateConflictSeverity(signals: StrategySignal[]): number {
  if (!hasConflict(signals)) return 0;
  const longWeight = signals.filter((s) => s.side === SignalSide.LONG).reduce((acc, s) => acc + clamp01(s.confidence), 0);
  const shortWeight = signals.filter((s) => s.side === SignalSide.SHORT).reduce((acc, s) => acc + clamp01(s.confidence), 0);
  const total = longWeight + shortWeight;
  if (total <= 0) return 0;
  const lr = longWeight / total;
  const sr = shortWeight / total;
  return clamp01(1 - Math.abs(lr - sr));
}

export function majorityByCount(signals: StrategySignal[]): SignalSide {
  const longCount = signals.filter((s) => s.side === SignalSide.LONG).length;
  const shortCount = signals.filter((s) => s.side === SignalSide.SHORT).length;
  const flatCount = signals.filter((s) => s.side === SignalSide.FLAT).length;
  if (longCount > shortCount && longCount > flatCount) return SignalSide.LONG;
  if (shortCount > longCount && shortCount > flatCount) return SignalSide.SHORT;
  if (flatCount > longCount && flatCount > shortCount) return SignalSide.FLAT;
  return SignalSide.FLAT;
}

export function majorityByConfidence(signals: StrategySignal[]): SignalSide {
  const longWeight = signals.filter((s) => s.side === SignalSide.LONG).reduce((acc, s) => acc + clamp01(s.confidence), 0);
  const shortWeight = signals.filter((s) => s.side === SignalSide.SHORT).reduce((acc, s) => acc + clamp01(s.confidence), 0);
  const flatWeight = signals.filter((s) => s.side === SignalSide.FLAT).reduce((acc, s) => acc + clamp01(s.confidence), 0);
  if (longWeight > shortWeight && longWeight > flatWeight) return SignalSide.LONG;
  if (shortWeight > longWeight && shortWeight > flatWeight) return SignalSide.SHORT;
  if (flatWeight > longWeight && flatWeight > shortWeight) return SignalSide.FLAT;
  return SignalSide.FLAT;
}

export function resolveConflict(
  longSignals: StrategySignal[],
  shortSignals: StrategySignal[],
  flatSignals: StrategySignal[],
  method: 'MAJORITY' | 'CONFIDENCE' | 'CONSERVATIVE'
): ConflictResolutionResult {
  const allSignals = [...longSignals, ...shortSignals, ...flatSignals];
  if (allSignals.length === 0) {
    return { winner: SignalSide.FLAT, margin: 0, resolutionMethod: 'NO_SIGNALS' };
  }

  let winner: SignalSide;
  if (method === 'MAJORITY') {
    winner = majorityByCount(allSignals);
  } else if (method === 'CONFIDENCE') {
    winner = majorityByConfidence(allSignals);
  } else {
    const severity = calculateConflictSeverity(allSignals);
    if (severity > 0.3) {
      winner = SignalSide.FLAT;
    } else {
      winner = majorityByConfidence(allSignals);
    }
  }

  const total = allSignals.length;
  const winnerCount = allSignals.filter((s) => s.side === winner).length;
  return {
    winner,
    margin: total > 0 ? clamp01(winnerCount / total) : 0,
    resolutionMethod: method,
  };
}

export function resolveAllFlat(flatSignals: StrategySignal[]): ConflictResolutionResult {
  const avg = flatSignals.length > 0
    ? flatSignals.reduce((acc, s) => acc + clamp01(s.confidence), 0) / flatSignals.length
    : 0;
  return {
    winner: SignalSide.FLAT,
    margin: clamp01(avg),
    resolutionMethod: 'ALL_FLAT',
  };
}

export function resolveWithVeto(
  longSignals: StrategySignal[],
  shortSignals: StrategySignal[],
  flatSignals: StrategySignal[],
  vetoStrategies: Set<string>,
  method: 'MAJORITY' | 'CONFIDENCE' | 'CONSERVATIVE'
): ConflictResolutionResult {
  const longVeto = longSignals.some((s) => vetoStrategies.has(s.strategyId));
  const shortVeto = shortSignals.some((s) => vetoStrategies.has(s.strategyId));
  const flatVeto = flatSignals.some((s) => vetoStrategies.has(s.strategyId));

  const vetoCount = Number(longVeto) + Number(shortVeto) + Number(flatVeto);
  if (vetoCount === 1) {
    if (longVeto) return { winner: SignalSide.LONG, margin: 1, resolutionMethod: 'VETO_LONG' };
    if (shortVeto) return { winner: SignalSide.SHORT, margin: 1, resolutionMethod: 'VETO_SHORT' };
    return { winner: SignalSide.FLAT, margin: 1, resolutionMethod: 'VETO_FLAT' };
  }

  return resolveConflict(longSignals, shortSignals, flatSignals, method);
}
