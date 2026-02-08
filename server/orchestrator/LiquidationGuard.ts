import { SymbolState } from './types';

export interface LiquidationGuardConfig {
  emergencyMarginRatio: number;
}

export function liquidationRiskTriggered(state: SymbolState, config: LiquidationGuardConfig): boolean {
  if (!state.position) {
    return false;
  }
  if (typeof state.marginRatio !== 'number' || !Number.isFinite(state.marginRatio)) {
    return false;
  }
  return state.marginRatio < config.emergencyMarginRatio;
}
