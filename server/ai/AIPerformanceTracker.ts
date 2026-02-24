import { PolicyIntent, PolicySide } from './PolicyEngine';

export interface AIDecisionRecord {
  timestamp: number;
  symbol: string;
  decision: {
    intent: PolicyIntent;
    side: PolicySide;
    riskMultiplier: number;
    confidence: number;
    reasons: string[];
  };
  outcome: number;
  regime: string;
}

export interface AIPerformanceSummary {
  samples: number;
  winRate: number;
  avgOutcome: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export class AIPerformanceTracker {
  private readonly records: AIDecisionRecord[] = [];

  constructor(private readonly maxRecords: number = 5000) {}

  record(record: AIDecisionRecord): void {
    this.records.push({
      ...record,
      timestamp: Number(record.timestamp || Date.now()),
      outcome: Number(record.outcome || 0),
      decision: {
        ...record.decision,
        reasons: Array.isArray(record.decision.reasons) ? [...record.decision.reasons] : [],
      },
    });
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  clear(): void {
    this.records.length = 0;
  }

  getRecent(limit = 200): AIDecisionRecord[] {
    const safeLimit = Math.max(1, Math.trunc(limit));
    return this.records.slice(-safeLimit).map((row) => ({
      ...row,
      decision: { ...row.decision, reasons: [...row.decision.reasons] },
    }));
  }

  getSummary(limit = 500): AIPerformanceSummary {
    const sample = this.getRecent(limit).filter((row) => Number.isFinite(row.outcome));
    if (sample.length === 0) {
      return {
        samples: 0,
        winRate: 0,
        avgOutcome: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
      };
    }

    let wins = 0;
    let losses = 0;
    let sum = 0;
    let sumWin = 0;
    let sumLossAbs = 0;
    for (const row of sample) {
      const value = Number(row.outcome || 0);
      sum += value;
      if (value > 0) {
        wins += 1;
        sumWin += value;
      } else if (value < 0) {
        losses += 1;
        sumLossAbs += Math.abs(value);
      }
    }

    const avgWin = wins > 0 ? sumWin / wins : 0;
    const avgLoss = losses > 0 ? -(sumLossAbs / losses) : 0;
    const profitFactor = sumLossAbs > 0 ? (sumWin / sumLossAbs) : (sumWin > 0 ? Number.POSITIVE_INFINITY : 0);

    return {
      samples: sample.length,
      winRate: Number((wins / sample.length).toFixed(4)),
      avgOutcome: Number((sum / sample.length).toFixed(6)),
      avgWin: Number(avgWin.toFixed(6)),
      avgLoss: Number(avgLoss.toFixed(6)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(6)) : profitFactor,
    };
  }

  // Placeholder hook for future model refresh pipeline.
  getRecordsForRetrain(limit = 2000): AIDecisionRecord[] {
    return this.getRecent(limit);
  }
}
