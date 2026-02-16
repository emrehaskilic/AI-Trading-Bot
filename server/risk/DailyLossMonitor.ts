import { IMetricsCollector } from '../metrics/types';
import { AlertService } from '../notifications/AlertService';

interface DailyLossMonitorOptions {
  maxDailyLossRatio?: number;
  checkIntervalMs?: number;
  onKillSwitch?: () => void;
}

export class DailyLossMonitor {
  private timer: NodeJS.Timeout | null = null;
  private killSwitchTriggered = false;
  private readonly maxDailyLossRatio: number;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly metrics: IMetricsCollector,
    private readonly alertService?: AlertService,
    private readonly options: DailyLossMonitorOptions = {}
  ) {
    this.maxDailyLossRatio = Math.max(0.001, Math.min(Number(options.maxDailyLossRatio ?? 0.1), 1));
    this.checkIntervalMs = Math.max(1_000, Math.trunc(Number(options.checkIntervalMs ?? 5_000)));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.evaluate(), this.checkIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  isKillSwitchTriggered(): boolean {
    return this.killSwitchTriggered;
  }

  resetKillSwitch(): void {
    this.killSwitchTriggered = false;
  }

  private evaluate(): void {
    if (this.killSwitchTriggered) return;
    const initialCapital = this.metrics.getInitialCapital();
    if (!(initialCapital > 0)) return;

    const dailyPnL = this.metrics.getDailyPnL();
    const lossLimit = -Math.abs(initialCapital * this.maxDailyLossRatio);
    if (dailyPnL > lossLimit) return;

    this.killSwitchTriggered = true;
    this.options.onKillSwitch?.();
    if (this.alertService) {
      void this.alertService.send(
        'DAILY_KILL_SWITCH',
        `daily_loss_limit_reached pnl=${dailyPnL.toFixed(4)} limit=${lossLimit.toFixed(4)}`,
        'CRITICAL'
      );
    }
  }
}
