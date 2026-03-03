/**
 * FAZ-5 Strategy Framework - Consensus Configuration
 * 
 * This module defines default consensus configurations and regime-specific
 * overrides for strategy signal aggregation.
 */

import { ConsensusConfig, MarketRegime, StrategyCategory } from '../strategies/types';

// ============================================================================
// DEFAULT CONSENSUS CONFIGURATION
// ============================================================================

/**
 * Default consensus configuration used when no regime-specific override exists.
 * 
 * These values provide a balanced approach suitable for most market conditions.
 */
export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  /** Minimum number of strategies required to reach consensus */
  minStrategyCount: 2,

  /** Minimum confidence threshold for a signal to be considered (0-1) */
  minConfidenceThreshold: 0.6,

  /** Whether to use weighted voting based on confidence scores */
  useWeightedVoting: true,

  /** Whether veto power is enabled for high-confidence signals */
  vetoEnabled: true,

  /** How to resolve conflicts between opposing signals */
  conflictResolution: 'CONFIDENCE',

  /** Minimum net score for a consensus decision (weighted sum) */
  minNetScore: 0.3,

  /** Whether to require signals from different strategy categories */
  requireDiverseCategories: false
};

// ============================================================================
// REGIME-SPECIFIC CONFIGURATIONS
// ============================================================================

/**
 * Regime-specific consensus configurations.
 * 
 * These overrides adjust consensus parameters based on detected market regime.
 * More conservative settings are used in ranging/volatile markets, while
 * trending markets allow for earlier entry with lower confidence thresholds.
 */
export const REGIME_SPECIFIC_CONFIG: Record<string, Partial<ConsensusConfig>> = {
  /**
   * TRENDING_UP: Lower confidence threshold for faster entry
   * Trend following strategies work well, allow earlier signals
   */
  'TRENDING_UP': {
    minConfidenceThreshold: 0.5,
    minNetScore: 0.2,
    requireDiverseCategories: false
  },

  /**
   * TRENDING_DOWN: Lower confidence threshold for faster entry
   * Similar to TRENDING_UP but for short positions
   */
  'TRENDING_DOWN': {
    minConfidenceThreshold: 0.5,
    minNetScore: 0.2,
    requireDiverseCategories: false
  },

  /**
   * TRENDING (generic): Combined trending configuration
   */
  'TRENDING': {
    minConfidenceThreshold: 0.5,
    minNetScore: 0.25,
    requireDiverseCategories: false
  },

  /**
   * RANGING: Higher confidence threshold, more strategies required
   * Mean reversion strategies need stronger confirmation
   */
  'RANGING': {
    minConfidenceThreshold: 0.7,
    minStrategyCount: 3,
    minNetScore: 0.4,
    requireDiverseCategories: true
  },

  /**
   * VOLATILE: Higher confidence, more strategies, conservative approach
   * Volatility requires stronger consensus to avoid false signals
   */
  'VOLATILE': {
    minConfidenceThreshold: 0.65,
    minStrategyCount: 3,
    minNetScore: 0.5,
    conflictResolution: 'CONSERVATIVE',
    requireDiverseCategories: true
  },

  /**
   * BREAKOUT: Moderate confidence, quick reaction needed
   * Breakouts require faster response but still need confirmation
   */
  'BREAKOUT': {
    minConfidenceThreshold: 0.55,
    minStrategyCount: 2,
    minNetScore: 0.35,
    useWeightedVoting: true,
    requireDiverseCategories: false
  },

  /**
   * ACCUMULATING: Higher confidence for accumulation signals
   */
  'ACCUMULATING': {
    minConfidenceThreshold: 0.65,
    minStrategyCount: 2,
    minNetScore: 0.4,
    requireDiverseCategories: true
  },

  /**
   * DISTRIBUTING: Higher confidence for distribution signals
   */
  'DISTRIBUTING': {
    minConfidenceThreshold: 0.65,
    minStrategyCount: 2,
    minNetScore: 0.4,
    requireDiverseCategories: true
  },

  /**
   * UNKNOWN: Most conservative settings when regime is unclear
   */
  'UNKNOWN': {
    minConfidenceThreshold: 0.75,
    minStrategyCount: 3,
    minNetScore: 0.5,
    conflictResolution: 'CONSERVATIVE',
    requireDiverseCategories: true
  }
};

// ============================================================================
// RISK STATE SPECIFIC CONFIGURATIONS
// ============================================================================

/**
 * Risk state specific consensus adjustments.
 * Applied on top of regime-specific config.
 */
export const RISK_STATE_ADJUSTMENTS: Record<string, Partial<ConsensusConfig>> = {
  'TRACKING': {
    // No adjustments in normal tracking mode
  },
  'REDUCED_RISK': {
    minConfidenceThreshold: 0.7,  // Require higher confidence
    minStrategyCount: 3,          // Require more strategies
    minNetScore: 0.5,             // Higher net score required
    conflictResolution: 'CONSERVATIVE'
  },
  'HALTED': {
    minConfidenceThreshold: 1.0,  // Impossible to reach
    minStrategyCount: 100,        // Impossible to reach
    minNetScore: 1.0              // Impossible to reach
  },
  'KILL_SWITCH': {
    minConfidenceThreshold: 1.0,  // Impossible to reach
    minStrategyCount: 100,        // Impossible to reach
    minNetScore: 1.0              // Impossible to reach
  }
};

// ============================================================================
// STRATEGY CATEGORY WEIGHTS
// ============================================================================

/**
 * Default weights for different strategy categories in weighted voting.
 * Higher weights give more influence to that category's signals.
 */
export const DEFAULT_CATEGORY_WEIGHTS: Record<StrategyCategory, number> = {
  [StrategyCategory.TREND_FOLLOWING]: 1.0,
  [StrategyCategory.MEAN_REVERSION]: 1.0,
  [StrategyCategory.MOMENTUM]: 1.0,
  [StrategyCategory.BREAKOUT]: 1.0,
  [StrategyCategory.SCALPING]: 0.8,
  [StrategyCategory.ARBITRAGE]: 1.2
};

/**
 * Regime-specific category weights.
 * Adjusts which strategy types are more trusted in different regimes.
 */
export const REGIME_CATEGORY_WEIGHTS: Record<string, Partial<Record<StrategyCategory, number>>> = {
  'TRENDING_UP': {
    [StrategyCategory.TREND_FOLLOWING]: 1.3,
    [StrategyCategory.MOMENTUM]: 1.2,
    [StrategyCategory.MEAN_REVERSION]: 0.7
  },
  'TRENDING_DOWN': {
    [StrategyCategory.TREND_FOLLOWING]: 1.3,
    [StrategyCategory.MOMENTUM]: 1.2,
    [StrategyCategory.MEAN_REVERSION]: 0.7
  },
  'RANGING': {
    [StrategyCategory.MEAN_REVERSION]: 1.3,
    [StrategyCategory.TREND_FOLLOWING]: 0.6,
    [StrategyCategory.MOMENTUM]: 0.8
  },
  'VOLATILE': {
    [StrategyCategory.SCALPING]: 1.2,
    [StrategyCategory.BREAKOUT]: 1.1,
    [StrategyCategory.TREND_FOLLOWING]: 0.7
  },
  'BREAKOUT': {
    [StrategyCategory.BREAKOUT]: 1.4,
    [StrategyCategory.MOMENTUM]: 1.2,
    [StrategyCategory.MEAN_REVERSION]: 0.5
  }
};

// ============================================================================
// VETO CONFIGURATION
// ============================================================================

/**
 * Veto configuration for high-confidence signals.
 * When enabled, a single high-confidence signal can override others.
 */
export interface VetoConfig {
  /** Minimum confidence to trigger veto */
  minVetoConfidence: number;

  /** Minimum confidence advantage over opposing signals */
  minConfidenceAdvantage: number;

  /** Categories that can exercise veto power */
  vetoEnabledCategories: StrategyCategory[];

  /** Maximum number of vetos per evaluation cycle */
  maxVetosPerCycle: number;
}

/**
 * Default veto configuration
 */
export const DEFAULT_VETO_CONFIG: VetoConfig = {
  minVetoConfidence: 0.85,
  minConfidenceAdvantage: 0.3,
  vetoEnabledCategories: [
    StrategyCategory.TREND_FOLLOWING,
    StrategyCategory.MOMENTUM,
    StrategyCategory.BREAKOUT
  ],
  maxVetosPerCycle: 1
};

// ============================================================================
// CONFIGURATION RESOLUTION
// ============================================================================

/**
 * Resolve the effective consensus configuration for a given regime and risk state.
 * 
 * @param regime - Current market regime
 * @param riskState - Current risk state
 * @param baseConfig - Optional base configuration to use instead of default
 * @returns Resolved consensus configuration
 */
export function resolveConsensusConfig(
  regime: string | null,
  riskState: string,
  baseConfig: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG
): ConsensusConfig {
  // Start with base config
  let config: ConsensusConfig = { ...baseConfig };

  // Apply regime-specific overrides
  if (regime) {
    const regimeConfig = REGIME_SPECIFIC_CONFIG[regime];
    if (regimeConfig) {
      config = { ...config, ...regimeConfig };
    }
  }

  // Apply risk state adjustments (these take precedence)
  const riskAdjustment = RISK_STATE_ADJUSTMENTS[riskState];
  if (riskAdjustment) {
    config = { ...config, ...riskAdjustment };
  }

  return config;
}

/**
 * Get category weights for a given regime.
 * 
 * @param regime - Current market regime
 * @returns Category weights for the regime
 */
export function getCategoryWeights(
  regime: string | null
): Record<StrategyCategory, number> {
  const baseWeights = { ...DEFAULT_CATEGORY_WEIGHTS };

  if (regime) {
    const regimeWeights = REGIME_CATEGORY_WEIGHTS[regime];
    if (regimeWeights) {
      for (const [category, weight] of Object.entries(regimeWeights)) {
        baseWeights[category as StrategyCategory] = weight;
      }
    }
  }

  return baseWeights;
}

// ============================================================================
// CONFIGURATION VALIDATION
// ============================================================================

/**
 * Validate a consensus configuration.
 * 
 * @param config - Configuration to validate
 * @returns Validation result with any errors
 */
export function validateConsensusConfig(
  config: ConsensusConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.minStrategyCount < 1) {
    errors.push('minStrategyCount must be at least 1');
  }

  if (config.minConfidenceThreshold < 0 || config.minConfidenceThreshold > 1) {
    errors.push('minConfidenceThreshold must be between 0 and 1');
  }

  if (config.minNetScore !== undefined && (config.minNetScore < 0 || config.minNetScore > 1)) {
    errors.push('minNetScore must be between 0 and 1');
  }

  const validConflictResolutions = ['CONFIDENCE', 'MAJORITY', 'UNANIMOUS', 'CONSERVATIVE'];
  if (!validConflictResolutions.includes(config.conflictResolution)) {
    errors.push(`conflictResolution must be one of: ${validConflictResolutions.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

/**
 * Conservative preset - requires strong consensus
 */
export const CONSERVATIVE_CONFIG: ConsensusConfig = {
  minStrategyCount: 4,
  minConfidenceThreshold: 0.75,
  useWeightedVoting: true,
  vetoEnabled: false,
  conflictResolution: 'CONSERVATIVE',
  minNetScore: 0.6,
  requireDiverseCategories: true
};

/**
 * Aggressive preset - faster entry, less confirmation
 */
export const AGGRESSIVE_CONFIG: ConsensusConfig = {
  minStrategyCount: 2,
  minConfidenceThreshold: 0.45,
  useWeightedVoting: true,
  vetoEnabled: true,
  conflictResolution: 'CONFIDENCE',
  minNetScore: 0.15,
  requireDiverseCategories: false
};

/**
 * Balanced preset - middle ground
 */
export const BALANCED_CONFIG: ConsensusConfig = {
  ...DEFAULT_CONSENSUS_CONFIG
};

/**
 * Testing preset - minimal requirements for testing
 */
export const TESTING_CONFIG: ConsensusConfig = {
  minStrategyCount: 1,
  minConfidenceThreshold: 0.3,
  useWeightedVoting: false,
  vetoEnabled: false,
  conflictResolution: 'MAJORITY',
  minNetScore: 0.1,
  requireDiverseCategories: false
};

/**
 * Preset configurations map for easy access
 */
export const CONSENSUS_PRESETS: Record<string, ConsensusConfig> = {
  DEFAULT: DEFAULT_CONSENSUS_CONFIG,
  CONSERVATIVE: CONSERVATIVE_CONFIG,
  AGGRESSIVE: AGGRESSIVE_CONFIG,
  BALANCED: BALANCED_CONFIG,
  TESTING: TESTING_CONFIG
};
