import { AlertService } from '../notifications/AlertService';

interface MarketDataMonitorOptions {
  maxSilenceMs?: number;
  checkEveryMs?: number;
}

/**
 * Tracks feed continuity and emits alerts when no data arrives for too long.
 */
export class MarketDataMonitor {
  private readonly lastSeenBySymbol = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private readonly maxSilenceMs: number;
  private readonly checkEveryMs: number;

  constructor(
    private readonly alertService?: AlertService,
    options: MarketDataMonitorOptions = {}
  ) {
    this.maxSilenceMs = Math.max(1_000, Math.trunc(options.maxSilenceMs ?? 10_000));
    this.checkEveryMs = Math.max(500, Math.trunc(options.checkEveryMs ?? Math.max(1_000, this.maxSilenceMs / 2)));
  }

  recordDataArrival(symbol: string, timestampMs: number = Date.now()): void {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) return;
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return;
    this.lastSeenBySymbol.set(normalized, Math.trunc(timestampMs));
  }

  startMonitoring(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkSilence(), this.checkEveryMs);
  }

  stopMonitoring(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private checkSilence(): void {
    if (!this.alertService) return;
    const now = Date.now();
    for (const [symbol, lastSeen] of this.lastSeenBySymbol.entries()) {
      if (now - lastSeen <= this.maxSilenceMs) continue;
      void this.alertService.send(
        'CONNECTION_LOST',
        `market_data_silence:${symbol}:${now - lastSeen}ms`,
        'CRITICAL'
      );
    }
  }
}
