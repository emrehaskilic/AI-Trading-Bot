export interface WinnerManagerConfig {
  trailAtrMult: number;
  rAtrMult: number;
  minRDistance: number;
}

export interface WinnerState {
  entryPrice: number;
  side: 'LONG' | 'SHORT';
  rDistance: number;
  maxFavorablePrice: number;
  profitLockStop: number | null;
  trailingStop: number | null;
  lockedR: number;
}

export interface WinnerDecision {
  action: 'PROFITLOCK' | 'TRAIL_STOP' | null;
  stopPrice: number | null;
  nextState: WinnerState;
  rMultiple: number;
}

export class WinnerManager {
  constructor(private readonly config: WinnerManagerConfig) {}

  initState(params: { entryPrice: number; side: 'LONG' | 'SHORT'; atr: number; markPrice: number }): WinnerState {
    const atr = Number.isFinite(params.atr) && params.atr > 0
      ? params.atr
      : Math.abs(params.markPrice - params.entryPrice) * 0.01;
    const rDistance = Math.max(this.config.minRDistance, atr * this.config.rAtrMult);
    return {
      entryPrice: params.entryPrice,
      side: params.side,
      rDistance,
      maxFavorablePrice: params.markPrice,
      profitLockStop: null,
      trailingStop: null,
      lockedR: 0,
    };
  }

  update(state: WinnerState, params: { markPrice: number; atr: number }): WinnerDecision {
    const sideSign = state.side === 'LONG' ? 1 : -1;
    const rMultiple = state.rDistance > 0
      ? (sideSign * (params.markPrice - state.entryPrice)) / state.rDistance
      : 0;

    let lockedR = state.lockedR;
    if (rMultiple >= 3) lockedR = Math.max(lockedR, 2);
    else if (rMultiple >= 2) lockedR = Math.max(lockedR, 1);
    else if (rMultiple >= 1) lockedR = Math.max(lockedR, 0.3);

    let profitLockStop = state.profitLockStop;
    if (lockedR > state.lockedR) {
      profitLockStop = state.entryPrice + (sideSign * lockedR * state.rDistance);
    }

    let trailingStop = state.trailingStop;
    if (rMultiple >= 2) {
      const atr = Number.isFinite(params.atr) && params.atr > 0 ? params.atr : state.rDistance;
      const nextTrail = state.side === 'LONG'
        ? params.markPrice - (this.config.trailAtrMult * atr)
        : params.markPrice + (this.config.trailAtrMult * atr);
      if (trailingStop == null) {
        trailingStop = nextTrail;
      } else {
        trailingStop = state.side === 'LONG'
          ? Math.max(trailingStop, nextTrail)
          : Math.min(trailingStop, nextTrail);
      }
    }

    const maxFavorablePrice = state.side === 'LONG'
      ? Math.max(state.maxFavorablePrice, params.markPrice)
      : Math.min(state.maxFavorablePrice, params.markPrice);

    const nextState: WinnerState = {
      ...state,
      lockedR,
      profitLockStop,
      trailingStop,
      maxFavorablePrice,
    };

    const effectiveStop = state.side === 'LONG'
      ? Math.max(profitLockStop ?? -Infinity, trailingStop ?? -Infinity)
      : Math.min(profitLockStop ?? Infinity, trailingStop ?? Infinity);

    let action: WinnerDecision['action'] = null;
    let stopPrice: number | null = null;
    if (Number.isFinite(effectiveStop)) {
      if (state.side === 'LONG' && params.markPrice <= effectiveStop) {
        action = trailingStop != null && effectiveStop === trailingStop ? 'TRAIL_STOP' : 'PROFITLOCK';
        stopPrice = effectiveStop;
      }
      if (state.side === 'SHORT' && params.markPrice >= effectiveStop) {
        action = trailingStop != null && effectiveStop === trailingStop ? 'TRAIL_STOP' : 'PROFITLOCK';
        stopPrice = effectiveStop;
      }
    }

    return { action, stopPrice, nextState, rMultiple };
  }
}
