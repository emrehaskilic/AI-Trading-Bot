const SCALE = 100_000_000n;

export type Decimal = bigint;

export function parseDecimal(value: string): Decimal {
  const raw = String(value).trim();
  if (!raw) {
    throw new Error('decimal_empty');
  }
  const sign = raw.startsWith('-') ? -1n : 1n;
  const normalized = raw.replace(/^[+-]/, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`decimal_invalid:${value}`);
  }
  const [wholePart, fracPart = ''] = normalized.split('.');
  const whole = BigInt(wholePart || '0');

  const fracRaw = fracPart.replace(/_/g, '');
  const padded = fracRaw.padEnd(8, '0');
  let frac = BigInt(padded.slice(0, 8) || '0');

  if (fracRaw.length > 8) {
    const roundDigit = Number(fracRaw[8] || '0');
    if (roundDigit >= 5) {
      frac += 1n;
      if (frac >= SCALE) {
        frac = 0n;
        return sign * ((whole + 1n) * SCALE);
      }
    }
  }

  return sign * (whole * SCALE + frac);
}

export function decimalToNumber(value: Decimal): number {
  return Number(value) / Number(SCALE);
}

export function decimalToString(value: Decimal, decimals = 8): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const whole = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(8, '0').slice(0, Math.max(0, decimals));
  if (decimals <= 0) {
    return `${sign}${whole.toString()}`;
  }
  return `${sign}${whole.toString()}.${fracStr}`;
}

export function mulDecimal(a: Decimal, b: Decimal): Decimal {
  return (a * b) / SCALE;
}

export function divDecimal(a: Decimal, b: Decimal): Decimal {
  if (b === 0n) {
    throw new Error('decimal_division_by_zero');
  }
  return (a * SCALE) / b;
}

export function parseDecimalToNumber(value: string): number {
  return decimalToNumber(parseDecimal(value));
}

export function parseDecimalSafe(value: string, fallback = 0): Decimal {
  try {
    return parseDecimal(value);
  } catch {
    return parseDecimal(String(fallback));
  }
}
