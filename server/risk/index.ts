import { RiskState } from './RiskStateManager';

export { RiskState, RiskStateManager, type RiskStateConfig, type RiskStateTransition, RiskStateTrigger } from './RiskStateManager';
export { FlashCrashGuard, FlashCrashGuardRegistry, type FlashCrashConfig, type FlashCrashDetection, type FlashCrashStatus } from './FlashCrashGuard';
export { ResiliencePatches, type ResiliencePatchesConfig, type ResilienceGuardResult, type ResilienceStatus } from './ResiliencePatches';

export interface RiskStateProfile {
  state: RiskState;
  riskMultiplier: number;
  allowNewPositions: boolean;
  allowPositionIncreases: boolean;
  maxPositionSizePct: number;
  description: string;
}

export const RISK_STATE_CONFIG: Record<RiskState, RiskStateProfile> = {
  [RiskState.TRACKING]: {
    state: RiskState.TRACKING,
    riskMultiplier: 1,
    allowNewPositions: true,
    allowPositionIncreases: true,
    maxPositionSizePct: 1,
    description: 'Normal operation',
  },
  [RiskState.REDUCED_RISK]: {
    state: RiskState.REDUCED_RISK,
    riskMultiplier: 0.5,
    allowNewPositions: true,
    allowPositionIncreases: false,
    maxPositionSizePct: 0.5,
    description: 'Reduced position sizes',
  },
  [RiskState.HALTED]: {
    state: RiskState.HALTED,
    riskMultiplier: 0,
    allowNewPositions: false,
    allowPositionIncreases: false,
    maxPositionSizePct: 0,
    description: 'No new positions',
  },
  [RiskState.KILL_SWITCH]: {
    state: RiskState.KILL_SWITCH,
    riskMultiplier: 0,
    allowNewPositions: false,
    allowPositionIncreases: false,
    maxPositionSizePct: 0,
    description: 'Emergency stop',
  },
};

export function getRiskMultiplier(state: RiskState): number {
  return RISK_STATE_CONFIG[state]?.riskMultiplier ?? 0;
}

export function canOpenNewPositions(state: RiskState): boolean {
  return Boolean(RISK_STATE_CONFIG[state]?.allowNewPositions);
}

export function canIncreasePositions(state: RiskState): boolean {
  return Boolean(RISK_STATE_CONFIG[state]?.allowPositionIncreases);
}
