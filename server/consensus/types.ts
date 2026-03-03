import { SignalSide, StrategySignal } from '../strategies/StrategyInterface';

export interface ConsensusConfig {
  minQuorumSize: number;
  minConfidenceThreshold: number;
  maxSignalAgeMs: number;
  minActionConfidence: number;
  useWeightedVoting: boolean;
  vetoEnabled: boolean;
  conflictResolution: 'MAJORITY' | 'CONFIDENCE' | 'CONSERVATIVE';
  longWeight: number;
  shortWeight: number;
  includeFlatSignals: boolean;
}

export interface WeightedVote {
  strategyId: string;
  side: SignalSide;
  confidence: number;
  weight: number;
}

export interface VoteTally {
  longWeight: number;
  shortWeight: number;
  flatWeight: number;
  longCount: number;
  shortCount: number;
  flatCount: number;
}

export interface ConflictResolutionResult {
  winner: SignalSide;
  margin: number;
  resolutionMethod: string;
}

export interface ConsensusResult {
  hasConsensus: boolean;
  consensusSide: SignalSide | null;
  aggregatedConfidence: number;
  quorumScore: number;
  voteTally: VoteTally;
  conflictResolution?: ConflictResolutionResult;
  explanation: string;
}

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  minQuorumSize: 2,
  minConfidenceThreshold: 0.3,
  maxSignalAgeMs: 5_000,
  minActionConfidence: 0.5,
  useWeightedVoting: true,
  vetoEnabled: true,
  conflictResolution: 'CONFIDENCE',
  longWeight: 1,
  shortWeight: 1,
  includeFlatSignals: false,
};

export function calculateVoteTally(signals: StrategySignal[], useWeightedVoting: boolean): VoteTally {
  const tally: VoteTally = {
    longWeight: 0,
    shortWeight: 0,
    flatWeight: 0,
    longCount: 0,
    shortCount: 0,
    flatCount: 0,
  };

  for (const signal of signals) {
    const w = useWeightedVoting ? signal.confidence : 1;
    if (signal.side === SignalSide.LONG) {
      tally.longCount += 1;
      tally.longWeight += w;
    } else if (signal.side === SignalSide.SHORT) {
      tally.shortCount += 1;
      tally.shortWeight += w;
    } else {
      tally.flatCount += 1;
      tally.flatWeight += w;
    }
  }

  return tally;
}

export function calculateQuorumScore(activeSignalCount: number, minRequired: number): number {
  if (minRequired <= 0) return 1;
  return Math.max(0, Math.min(1, activeSignalCount / minRequired));
}
