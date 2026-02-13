const SCALE = 100_000_000n;

export type Fp = bigint;

export const fpZero: Fp = 0n;

export function toFp(value: number): Fp {
  if (!Number.isFinite(value)) {
    throw new Error(`non_finite_number:${value}`);
  }
  return BigInt(Math.round(value * Number(SCALE)));
}

export function fromFp(value: Fp): number {
  return Number(value) / Number(SCALE);
}

export function fpAbs(value: Fp): Fp {
  return value < 0n ? -value : value;
}

export function fpAdd(a: Fp, b: Fp): Fp {
  return a + b;
}

export function fpSub(a: Fp, b: Fp): Fp {
  return a - b;
}

export function fpMul(a: Fp, b: Fp): Fp {
  return (a * b) / SCALE;
}

export function fpDiv(a: Fp, b: Fp): Fp {
  if (b === 0n) {
    throw new Error('division_by_zero');
  }
  return (a * SCALE) / b;
}

export function fpMin(a: Fp, b: Fp): Fp {
  return a <= b ? a : b;
}

export function fpMax(a: Fp, b: Fp): Fp {
  return a >= b ? a : b;
}

export function fpCmp(a: Fp, b: Fp): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function fpSign(a: Fp): -1 | 0 | 1 {
  if (a < 0n) return -1;
  if (a > 0n) return 1;
  return 0;
}

export function fpIsPositive(a: Fp): boolean {
  return a > 0n;
}

export function fpRoundTo(value: Fp, decimals: number): number {
  const raw = fromFp(value);
  const m = Math.pow(10, Math.max(0, decimals));
  return Math.round(raw * m) / m;
}
