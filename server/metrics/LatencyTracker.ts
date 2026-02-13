export interface LatencyStats {
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  samples: number;
}

export interface LatencySnapshot {
  updatedAt: number;
  stages: Record<string, LatencyStats>;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

export class LatencyTracker {
  private readonly samples = new Map<string, number[]>();
  private readonly windowSize: number;

  constructor(windowSize: number = 250) {
    this.windowSize = windowSize;
  }

  record(stage: string, durationMs: number): void {
    if (!stage || !Number.isFinite(durationMs) || durationMs < 0) return;
    const list = this.samples.get(stage) ?? [];
    list.push(durationMs);
    while (list.length > this.windowSize) list.shift();
    this.samples.set(stage, list);
  }

  snapshot(): LatencySnapshot {
    const stages: Record<string, LatencyStats> = {};
    for (const [stage, list] of this.samples.entries()) {
      if (list.length === 0) continue;
      const sum = list.reduce((acc, v) => acc + v, 0);
      const avg = sum / list.length;
      stages[stage] = {
        avgMs: Number(avg.toFixed(2)),
        p95Ms: Number(percentile(list, 0.95).toFixed(2)),
        maxMs: Number(Math.max(...list).toFixed(2)),
        samples: list.length,
      };
    }

    return {
      updatedAt: Date.now(),
      stages,
    };
  }
}
