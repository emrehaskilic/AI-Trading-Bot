type FrameBias = 'UP' | 'DOWN' | 'NEUTRAL';
type FrameVeto = 'NONE' | 'UP' | 'DOWN';

interface HtfFrameLike {
  close: number | null;
  atr: number | null;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  structureBreakUp: boolean;
  structureBreakDn: boolean;
}

interface BiasOptions {
  upperPos: number;
  lowerPos: number;
  rangeBufferPct: number;
  atrBufferMult: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function finitePositive(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function deriveFrameBias(
  frame: HtfFrameLike | null | undefined,
  referencePrice: number,
  options: BiasOptions,
): FrameBias {
  if (!frame) return 'NEUTRAL';
  if (frame.structureBreakUp) return 'UP';
  if (frame.structureBreakDn) return 'DOWN';

  const close = finitePositive(frame.close);
  const swingHigh = finitePositive(frame.lastSwingHigh);
  const swingLow = finitePositive(frame.lastSwingLow);
  if (close == null || swingHigh == null || swingLow == null || swingHigh <= swingLow) {
    return 'NEUTRAL';
  }

  const atr = Math.max(0, Number(frame.atr || 0));
  const range = swingHigh - swingLow;
  if (!Number.isFinite(range) || range <= 0) return 'NEUTRAL';

  const price = finitePositive(referencePrice) ?? close;
  const mid = swingLow + (range / 2);
  const pos = clamp((price - swingLow) / range, 0, 1);
  const closePos = clamp((close - swingLow) / range, 0, 1);
  const buffer = Math.max(range * options.rangeBufferPct, atr * options.atrBufferMult);

  if (price >= mid + buffer && pos >= options.upperPos && closePos >= 0.52) {
    return 'UP';
  }
  if (price <= mid - buffer && pos <= options.lowerPos && closePos <= 0.48) {
    return 'DOWN';
  }
  return 'NEUTRAL';
}

export function deriveBias15m(
  frame: HtfFrameLike | null | undefined,
  referencePrice: number,
): FrameBias {
  return deriveFrameBias(frame, referencePrice, {
    upperPos: 0.58,
    lowerPos: 0.42,
    rangeBufferPct: 0.08,
    atrBufferMult: 0.15,
  });
}

export function deriveVeto1h(
  frame: HtfFrameLike | null | undefined,
  referencePrice: number,
): FrameVeto {
  if (!frame) return 'NONE';
  if (frame.structureBreakDn) return 'DOWN';
  if (frame.structureBreakUp) return 'UP';
  return 'NONE';
}
