import { StrategySide } from '../types/strategy';
import { AIMetricsSnapshot } from './types';
import { DeterministicStateSnapshot } from './StateExtractor';

type SymbolLockState = {
  lastPositionSide: StrategySide | null;
  lastClosedSide: StrategySide | null;
  lastCloseTs: number;
  closeBaseline: {
    regimeState: DeterministicStateSnapshot['regimeState'];
    flowState: DeterministicStateSnapshot['flowState'];
    cvdSlopeSign: DeterministicStateSnapshot['cvdSlopeSign'];
    oiDirection: DeterministicStateSnapshot['oiDirection'];
  } | null;
};

export interface DirectionLockEvaluation {
  blocked: boolean;
  reason: string | null;
  confirmations: number;
}

const defaultState = (): SymbolLockState => ({
  lastPositionSide: null,
  lastClosedSide: null,
  lastCloseTs: 0,
  closeBaseline: null,
});

export class DirectionLock {
  private readonly state = new Map<string, SymbolLockState>();
  private readonly minFlipCooldownMs: number;
  private readonly confirmationTtlMs: number;

  constructor(input?: { minFlipCooldownMs?: number; confirmationTtlMs?: number }) {
    this.minFlipCooldownMs = Math.max(0, Number(input?.minFlipCooldownMs ?? process.env.AI_DIRECTION_LOCK_COOLDOWN_MS ?? 90_000));
    this.confirmationTtlMs = Math.max(1, Number(input?.confirmationTtlMs ?? process.env.AI_DIRECTION_LOCK_CONFIRM_TTL_MS ?? 60_000));
  }

  observe(symbol: string, position: AIMetricsSnapshot['position'], state: DeterministicStateSnapshot): void {
    const key = String(symbol || '').toUpperCase();
    const current = this.getState(key);
    const currentSide = position?.side || null;

    if (current.lastPositionSide && !currentSide) {
      current.lastClosedSide = current.lastPositionSide;
      current.lastCloseTs = Number(state.timestampMs || Date.now());
      current.closeBaseline = {
        regimeState: state.regimeState,
        flowState: state.flowState,
        cvdSlopeSign: state.cvdSlopeSign,
        oiDirection: state.oiDirection,
      };
    }

    current.lastPositionSide = currentSide;
  }

  evaluate(
    symbol: string,
    intent: 'HOLD' | 'ENTER' | 'ADD' | 'REDUCE' | 'EXIT',
    side: StrategySide | null,
    position: AIMetricsSnapshot['position'],
    state: DeterministicStateSnapshot
  ): DirectionLockEvaluation {
    if (intent !== 'ENTER' || !side) {
      return { blocked: false, reason: null, confirmations: 0 };
    }

    if (position && position.side !== side) {
      return { blocked: true, reason: 'NO_AUTO_CLOSE_REVERSE', confirmations: 0 };
    }

    if (position || !side) {
      return { blocked: false, reason: null, confirmations: 0 };
    }

    const key = String(symbol || '').toUpperCase();
    const current = this.getState(key);
    if (!current.lastClosedSide || current.lastClosedSide === side || !current.closeBaseline) {
      return { blocked: false, reason: null, confirmations: 0 };
    }

    const now = Number(state.timestampMs || Date.now());
    const sinceClose = Math.max(0, now - current.lastCloseTs);
    if (sinceClose < this.minFlipCooldownMs) {
      return { blocked: true, reason: 'DIRECTION_LOCK_COOLDOWN', confirmations: 0 };
    }

    if (sinceClose > this.confirmationTtlMs) {
      return { blocked: true, reason: 'DIRECTION_LOCK_CONFIRM_WINDOW_EXPIRED', confirmations: 0 };
    }

    const confirmations = this.countConfirmations(current.closeBaseline, state);
    if (confirmations < 3) {
      return { blocked: true, reason: 'DIRECTION_LOCK_CONFIRMATIONS', confirmations };
    }

    return { blocked: false, reason: null, confirmations };
  }

  private countConfirmations(
    baseline: NonNullable<SymbolLockState['closeBaseline']>,
    next: DeterministicStateSnapshot
  ): number {
    let confirmations = 0;
    if (baseline.regimeState !== next.regimeState) confirmations += 1;
    if (baseline.flowState !== next.flowState) confirmations += 1;
    if (baseline.cvdSlopeSign !== next.cvdSlopeSign) confirmations += 1;
    if (baseline.oiDirection !== next.oiDirection) confirmations += 1;
    return confirmations;
  }

  private getState(symbol: string): SymbolLockState {
    let current = this.state.get(symbol);
    if (!current) {
      current = defaultState();
      this.state.set(symbol, current);
    }
    return current;
  }
}
