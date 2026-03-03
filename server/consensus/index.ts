export {
  ConsensusEngine,
  DEFAULT_CONSENSUS_CONFIG as DEFAULT_ENGINE_CONFIG,
  type ConsensusConfig as EngineConsensusConfig,
  type ConsensusDecision,
} from './ConsensusEngine';

export {
  DEFAULT_CONSENSUS_CONFIG,
  type ConsensusConfig,
  type ConsensusResult,
  type ConflictResolutionResult,
  type VoteTally,
  type WeightedVote,
  calculateQuorumScore,
  calculateVoteTally,
} from './types';

export {
  resolveConflict,
  resolveWithVeto,
  hasConflict,
  calculateConflictSeverity,
  majorityByCount,
  majorityByConfidence,
  resolveAllFlat,
} from './ConflictResolver';

export {
  calculateWeightedConfidence,
  calculateWeightedConfidenceBySide,
  aggregateConfidence,
  calculateConfidenceDelta,
  smoothConfidence,
} from './ConfidenceMath';

export {
  DEFAULT_CONSENSUS_CONFIG as DEFAULT_PHASE5_CONSENSUS_CONFIG,
  REGIME_SPECIFIC_CONFIG,
  RISK_STATE_ADJUSTMENTS,
  DEFAULT_CATEGORY_WEIGHTS,
  REGIME_CATEGORY_WEIGHTS,
  DEFAULT_VETO_CONFIG,
  resolveConsensusConfig,
  getCategoryWeights,
  validateConsensusConfig,
  CONSERVATIVE_CONFIG,
  AGGRESSIVE_CONFIG,
  BALANCED_CONFIG,
  TESTING_CONFIG,
  CONSENSUS_PRESETS,
  type VetoConfig,
} from './ConsensusConfig';
