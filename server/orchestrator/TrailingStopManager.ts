export interface TrailingStopConfig {
  enabled: boolean;
  activationR: number;
  trailingRatio: number;
  minDrawdownR: number;
}

export interface TrailingStopState {
  peakR: number;
  activated: boolean;
}

export interface TrailingStopDecision {
  triggered: boolean;
  drawdownR: number;
  allowedDrawdownR: number;
  state: TrailingStopState;
}

export class TrailingStopManager {
  constructor(private readonly cfg: TrailingStopConfig) {}

  update(currentR: number, state: TrailingStopState): TrailingStopDecision {
    const safeCurrentR = Number.isFinite(currentR) ? currentR : 0;
    const nextState: TrailingStopState = {
      peakR: Number.isFinite(state.peakR) ? state.peakR : 0,
      activated: Boolean(state.activated),
    };

    if (safeCurrentR > nextState.peakR) {
      nextState.peakR = safeCurrentR;
    }

    if (!this.cfg.enabled) {
      return {
        triggered: false,
        drawdownR: Math.max(0, nextState.peakR - safeCurrentR),
        allowedDrawdownR: Number.POSITIVE_INFINITY,
        state: nextState,
      };
    }

    if (!nextState.activated && nextState.peakR >= Math.max(0, this.cfg.activationR)) {
      nextState.activated = true;
    }

    const drawdownR = Math.max(0, nextState.peakR - safeCurrentR);
    const allowedDrawdownR = Math.max(
      Math.max(0, this.cfg.minDrawdownR),
      Math.max(0, nextState.peakR) * Math.max(0, this.cfg.trailingRatio)
    );

    return {
      triggered: nextState.activated && drawdownR >= allowedDrawdownR,
      drawdownR,
      allowedDrawdownR,
      state: nextState,
    };
  }
}

