const EPS = 1e-12;

export class WindowSum {
  private values: Array<{ ts: number; value: number }> = [];
  private head = 0;
  private total = 0;

  constructor(
    private readonly windowMs: number,
    private readonly hardCap: number = 20_000
  ) {}

  add(ts: number, value: number): void {
    if (!Number.isFinite(value)) return;
    this.values.push({ ts, value });
    this.total += value;
    this.prune(ts);
    this.compactIfNeeded();
  }

  sum(now: number): number {
    this.prune(now);
    return this.total;
  }

  count(now: number): number {
    this.prune(now);
    return Math.max(0, this.values.length - this.head);
  }

  mean(now: number): number {
    const c = this.count(now);
    if (c <= 0) return 0;
    return this.total / c;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.values.length && this.values[this.head].ts < cutoff) {
      this.total -= this.values[this.head].value;
      this.head += 1;
    }
  }

  private compactIfNeeded(): void {
    const active = this.values.length - this.head;
    if (active > this.hardCap) {
      const dropCount = Math.floor(active * 0.15);
      for (let i = 0; i < dropCount && this.head < this.values.length; i += 1) {
        this.total -= this.values[this.head].value;
        this.head += 1;
      }
    }
    if (this.head > 0 && (this.head >= 4096 || this.head > (this.values.length >> 1))) {
      this.values = this.values.slice(this.head);
      this.head = 0;
    }
  }
}

export class WindowStats {
  private values: Array<{ ts: number; value: number; valueSq: number }> = [];
  private head = 0;
  private sum = 0;
  private sumSq = 0;

  constructor(
    private readonly windowMs: number,
    private readonly hardCap: number = 20_000
  ) {}

  add(ts: number, value: number): void {
    if (!Number.isFinite(value)) return;
    const valueSq = value * value;
    this.values.push({ ts, value, valueSq });
    this.sum += value;
    this.sumSq += valueSq;
    this.prune(ts);
    this.compactIfNeeded();
  }

  count(now: number): number {
    this.prune(now);
    return Math.max(0, this.values.length - this.head);
  }

  mean(now: number): number {
    const c = this.count(now);
    if (c <= 0) return 0;
    return this.sum / c;
  }

  variance(now: number): number {
    const c = this.count(now);
    if (c <= 1) return 0;
    const mean = this.sum / c;
    const variance = (this.sumSq / c) - (mean * mean);
    return variance > 0 ? variance : 0;
  }

  std(now: number): number {
    return Math.sqrt(this.variance(now));
  }

  rms(now: number): number {
    const c = this.count(now);
    if (c <= 0) return 0;
    const meanSq = this.sumSq / c;
    return meanSq > 0 ? Math.sqrt(meanSq) : 0;
  }

  zScore(value: number, now: number): number {
    const std = this.std(now);
    if (std <= EPS) return 0;
    return (value - this.mean(now)) / std;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.values.length && this.values[this.head].ts < cutoff) {
      this.sum -= this.values[this.head].value;
      this.sumSq -= this.values[this.head].valueSq;
      this.head += 1;
    }
  }

  private compactIfNeeded(): void {
    const active = this.values.length - this.head;
    if (active > this.hardCap) {
      const dropCount = Math.floor(active * 0.15);
      for (let i = 0; i < dropCount && this.head < this.values.length; i += 1) {
        this.sum -= this.values[this.head].value;
        this.sumSq -= this.values[this.head].valueSq;
        this.head += 1;
      }
    }
    if (this.head > 0 && (this.head >= 4096 || this.head > (this.values.length >> 1))) {
      this.values = this.values.slice(this.head);
      this.head = 0;
    }
  }
}

export class RegressionWindow {
  private values: Array<{ ts: number; x: number; y: number; xx: number; xy: number }> = [];
  private head = 0;
  private n = 0;
  private sumX = 0;
  private sumY = 0;
  private sumXX = 0;
  private sumXY = 0;

  constructor(
    private readonly windowMs: number,
    private readonly hardCap: number = 20_000
  ) {}

  add(ts: number, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const xx = x * x;
    const xy = x * y;
    this.values.push({ ts, x, y, xx, xy });
    this.n += 1;
    this.sumX += x;
    this.sumY += y;
    this.sumXX += xx;
    this.sumXY += xy;
    this.prune(ts);
    this.compactIfNeeded();
  }

  slope(now: number): number {
    this.prune(now);
    if (this.n < 2) return 0;
    const denom = (this.n * this.sumXX) - (this.sumX * this.sumX);
    if (Math.abs(denom) <= EPS) return 0;
    return ((this.n * this.sumXY) - (this.sumX * this.sumY)) / denom;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.head < this.values.length && this.values[this.head].ts < cutoff) {
      const v = this.values[this.head];
      this.n -= 1;
      this.sumX -= v.x;
      this.sumY -= v.y;
      this.sumXX -= v.xx;
      this.sumXY -= v.xy;
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
        this.sumX -= v.x;
        this.sumY -= v.y;
        this.sumXX -= v.xx;
        this.sumXY -= v.xy;
        this.head += 1;
      }
    }
    if (this.head > 0 && (this.head >= 4096 || this.head > (this.values.length >> 1))) {
      this.values = this.values.slice(this.head);
      this.head = 0;
    }
  }
}

