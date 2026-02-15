export class DryRunClock {
  private nowMs: number | null = null;

  now(): number {
    if (this.nowMs === null) {
      console.warn('DryRunClock.now() called before set(), returning 1. This indicates an uninitialized state.');
      return 1;
    }
    return this.nowMs;
  }

  set(timestampMs: number): void {
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return;
    this.nowMs = Math.trunc(timestampMs);
  }
}
