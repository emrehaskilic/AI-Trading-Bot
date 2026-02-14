export class DryRunClock {
  private nowMs = 0;

  now(): number {
    return this.nowMs > 0 ? this.nowMs : 1;
  }

  set(timestampMs: number): void {
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return;
    this.nowMs = Math.trunc(timestampMs);
  }
}
