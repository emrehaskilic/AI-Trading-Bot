export interface AlphaDecaySummary {
  signalType: string;
  avgValidityMs: number;
  alphaDecayHalfLife: number;
  optimalEntryWindow: [number, number];
  optimalExitWindow: [number, number];
  sampleCount: number;
}

type ActiveSignal = {
  signalType: string;
  startedAtMs: number;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

export class AlphaDecayAnalyzer {
  private readonly durationsBySignal = new Map<string, number[]>();
  private readonly activeSignals = new Map<string, ActiveSignal>();

  recordSignal(symbol: string, signalType: string, timestampMs: number): void {
    if (!symbol || !signalType || !Number.isFinite(timestampMs)) return;
    this.activeSignals.set(symbol, { signalType, startedAtMs: timestampMs });
  }

  recordExit(symbol: string, timestampMs: number): void {
    const active = this.activeSignals.get(symbol);
    if (!active) return;
    this.activeSignals.delete(symbol);
    const duration = Math.max(0, timestampMs - active.startedAtMs);
    this.recordOutcome(active.signalType, duration);
  }

  recordOutcome(signalType: string, durationMs: number): void {
    if (!signalType || !Number.isFinite(durationMs)) return;
    const safeDuration = Math.max(0, Math.round(durationMs));
    const list = this.durationsBySignal.get(signalType) ?? [];
    list.push(safeDuration);
    if (list.length > 5000) {
      list.shift();
    }
    this.durationsBySignal.set(signalType, list);
  }

  getSummary(): AlphaDecaySummary[] {
    const out: AlphaDecaySummary[] = [];
    for (const [signalType, durations] of this.durationsBySignal.entries()) {
      if (durations.length === 0) continue;
      const avg = durations.reduce((acc, v) => acc + v, 0) / durations.length;
      const halfLife = avg * Math.log(2);
      const entryWindowEnd = percentile(durations, 0.25);
      const exitWindowStart = percentile(durations, 0.6);
      const exitWindowEnd = percentile(durations, 0.9);

      out.push({
        signalType,
        avgValidityMs: Math.round(avg),
        alphaDecayHalfLife: Math.round(halfLife),
        optimalEntryWindow: [0, Math.round(entryWindowEnd)],
        optimalExitWindow: [Math.round(exitWindowStart), Math.round(exitWindowEnd)],
        sampleCount: durations.length,
      });
    }
    return out;
  }

  getActiveSignals(): Record<string, ActiveSignal> {
    const out: Record<string, ActiveSignal> = {};
    for (const [symbol, active] of this.activeSignals.entries()) {
      out[symbol] = { ...active };
    }
    return out;
  }
}
