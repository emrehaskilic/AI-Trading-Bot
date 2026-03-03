const EPS = 1e-12;
const DEFAULT_HARD_CAP = 20_000;
const COMPACT_THRESHOLD = 4096;

function sanitizeFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

interface KahanSum {
  sum: number;
  compensation: number;
}

function createKahanSum(): KahanSum {
  return { sum: 0, compensation: 0 };
}

function kahanAdd(ks: KahanSum, value: number): void {
  const y = sanitizeFinite(value, 0) - ks.compensation;
  const t = ks.sum + y;
  ks.compensation = (t - ks.sum) - y;
  ks.sum = t;
}

function kahanSub(ks: KahanSum, value: number): void {
  kahanAdd(ks, -sanitizeFinite(value, 0));
}

export class WindowSum {
  private values: Array<{ ts: number; value: number }> = [];
  private head = 0;
  private total = createKahanSum();

  constructor(
    private readonly windowMs: number,
    private readonly hardCap: number = DEFAULT_HARD_CAP
  ) {}

  public reset(): void {
    this.values = [];
    this.head = 0;
    this.total = createKahanSum();
  }

  add(ts: number, value: number): void {
    const v = sanitizeFinite(value, NaN);
    const t = sanitizeFinite(ts, 0);
    if (!Number.isFinite(v)) return;

    this.values.push({ ts: t, value: v });
    kahanAdd(this.total, v);
    this.prune(t);
    this.compactIfNeeded();
  }

  sum(now: number): number {
    this.prune(sanitizeFinite(now, 0));
    return sanitizeFinite(this.total.sum, 0);
  }

  count(now: number): number {
    this.prune(sanitizeFinite(now, 0));
    return Math.max(0, this.values.length - this.head);
  }

  mean(now: number): number {
    const c = this.count(now);
    if (c <= 0) return 0;
    return sanitizeFinite(this.sum(now) / c, 0);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.values.length && this.values[this.head].ts < cutoff) {
      kahanSub(this.total, this.values[this.head].value);
      this.head += 1;
    }
  }

  private compactIfNeeded(): void {
    const active = this.values.length - this.head;
    if (active > this.hardCap) {
      const dropCount = Math.floor(active * 0.15);
      for (let i = 0; i < dropCount && this.head < this.values.length; i += 1) {
        kahanSub(this.total, this.values[this.head].value);
        this.head += 1;
      }
    }
    if (this.head > 0 && (this.head >= COMPACT_THRESHOLD || this.head > (this.values.length >> 1))) {
      this.values = this.values.slice(this.head);
      this.head = 0;
    }
  }
}

export class WindowStats {
  private values: Array<{ ts: number; value: number; valueSq: number }> = [];
  private head = 0;
  private sum = createKahanSum();
  private sumSq = createKahanSum();

  constructor(
    private readonly windowMs: number,
    private readonly hardCap: number = DEFAULT_HARD_CAP
  ) {}

  public reset(): void {
    this.values = [];
    this.head = 0;
    this.sum = createKahanSum();
    this.sumSq = createKahanSum();
  }

  add(ts: number, value: number): void {
    const v = sanitizeFinite(value, NaN);
    const t = sanitizeFinite(ts, 0);
    if (!Number.isFinite(v)) return;

    const valueSq = v * v;
    this.values.push({ ts: t, value: v, valueSq });
    kahanAdd(this.sum, v);
    kahanAdd(this.sumSq, valueSq);
    this.prune(t);
    this.compactIfNeeded();
  }

  count(now: number): number {
    this.prune(sanitizeFinite(now, 0));
    return Math.max(0, this.values.length - this.head);
  }

  mean(now: number): number {
    const c = this.count(now);
    if (c <= 0) return 0;
    return sanitizeFinite(this.sum.sum / c, 0);
  }

  variance(now: number): number {
    const c = this.count(now);
    if (c <= 1) return 0;
    const m = this.mean(now);
    const variance = (this.sumSq.sum / c) - (m * m);
    return variance > 0 ? sanitizeFinite(variance, 0) : 0;
  }

  std(now: number): number {
    return sanitizeFinite(Math.sqrt(this.variance(now)), 0);
  }

  rms(now: number): number {
    const c = this.count(now);
    if (c <= 0) return 0;
    const meanSq = sanitizeFinite(this.sumSq.sum / c, 0);
    return meanSq > 0 ? sanitizeFinite(Math.sqrt(meanSq), 0) : 0;
  }

  zScore(value: number, now: number): number {
    const std = this.std(now);
    if (std <= EPS) return 0;
    return sanitizeFinite((sanitizeFinite(value, 0) - this.mean(now)) / std, 0);
  }

  getStats(now: number): { mean: number; variance: number; std: number; count: number } {
    return {
      mean: this.mean(now),
      variance: this.variance(now),
      std: this.std(now),
      count: this.count(now),
    };
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.values.length && this.values[this.head].ts < cutoff) {
      const v = this.values[this.head];
      kahanSub(this.sum, v.value);
      kahanSub(this.sumSq, v.valueSq);
      this.head += 1;
    }
  }

  private compactIfNeeded(): void {
    const active = this.values.length - this.head;
    if (active > this.hardCap) {
      const dropCount = Math.floor(active * 0.15);
      for (let i = 0; i < dropCount && this.head < this.values.length; i += 1) {
        const v = this.values[this.head];
        kahanSub(this.sum, v.value);
        kahanSub(this.sumSq, v.valueSq);
        this.head += 1;
      }
    }
    if (this.head > 0 && (this.head >= COMPACT_THRESHOLD || this.head > (this.values.length >> 1))) {
      this.values = this.values.slice(this.head);
      this.head = 0;
    }
  }
}

export class RegressionWindow {
  private values: Array<{ ts: number; x: number; y: number; xx: number; xy: number }> = [];
  private head = 0;
  private n = 0;
  private sumX = createKahanSum();
  private sumY = createKahanSum();
  private sumXX = createKahanSum();
  private sumXY = createKahanSum();

  constructor(
    private readonly windowMs: number,
    private readonly hardCap: number = DEFAULT_HARD_CAP
  ) {}

  public reset(): void {
    this.values = [];
    this.head = 0;
    this.n = 0;
    this.sumX = createKahanSum();
    this.sumY = createKahanSum();
    this.sumXX = createKahanSum();
    this.sumXY = createKahanSum();
  }

  add(ts: number, x: number, y?: number): void {
    const t = sanitizeFinite(ts, 0);
    const xVal = sanitizeFinite(x, NaN);
    const yVal = sanitizeFinite(y === undefined ? x : y, NaN);
    const derivedX = y === undefined ? sanitizeFinite(t, 0) : xVal;
    if (!Number.isFinite(derivedX) || !Number.isFinite(yVal)) return;

    const xx = derivedX * derivedX;
    const xy = derivedX * yVal;
    this.values.push({ ts: t, x: derivedX, y: yVal, xx, xy });
    this.n += 1;
    kahanAdd(this.sumX, derivedX);
    kahanAdd(this.sumY, yVal);
    kahanAdd(this.sumXX, xx);
    kahanAdd(this.sumXY, xy);
    this.prune(t);
    this.compactIfNeeded();
  }

  slope(now: number): number {
    this.prune(sanitizeFinite(now, 0));
    if (this.n < 2) return 0;
    const denom = (this.n * this.sumXX.sum) - (this.sumX.sum * this.sumX.sum);
    if (Math.abs(denom) <= EPS) return 0;
    const numer = (this.n * this.sumXY.sum) - (this.sumX.sum * this.sumY.sum);
    return sanitizeFinite(numer / denom, 0);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.values.length && this.values[this.head].ts < cutoff) {
      const v = this.values[this.head];
      this.n -= 1;
      kahanSub(this.sumX, v.x);
      kahanSub(this.sumY, v.y);
      kahanSub(this.sumXX, v.xx);
      kahanSub(this.sumXY, v.xy);
      this.head += 1;
    }
  }

  private compactIfNeeded(): void {
    const active = this.values.length - this.head;
    if (active > this.hardCap) {
      const dropCount = Math.floor(active * 0.15);
      for (let i = 0; i < dropCount && this.head < this.values.length; i += 1) {
        const v = this.values[this.head];
        this.n -= 1;
        kahanSub(this.sumX, v.x);
        kahanSub(this.sumY, v.y);
        kahanSub(this.sumXX, v.xx);
        kahanSub(this.sumXY, v.xy);
        this.head += 1;
      }
    }
    if (this.head > 0 && (this.head >= COMPACT_THRESHOLD || this.head > (this.values.length >> 1))) {
      this.values = this.values.slice(this.head);
      this.head = 0;
    }
  }
}
