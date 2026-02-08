import { SymbolState } from './types';

export interface HardStopGuardConfig {
  maxLossPct: number;
}

export function hardStopTriggered(state: SymbolState, config: HardStopGuardConfig): boolean {
  if (!state.position) {
    return false;
  }
  const threshold = -Math.abs(config.maxLossPct);
  return state.position.unrealizedPnlPct <= threshold;
}
