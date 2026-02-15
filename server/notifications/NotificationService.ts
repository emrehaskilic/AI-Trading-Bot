import { AlertConfig, AlertPriority, AlertType } from './types';

type NotificationOptions = {
  priority?: AlertPriority;
  details?: Record<string, any>;
};

export class NotificationService {
  private readonly lastSent = new Map<AlertType, number>();

  constructor(
    private readonly config: AlertConfig,
    private readonly retryConfig: { maxRetries: number; baseDelayMs: number } = { maxRetries: 3, baseDelayMs: 500 }
  ) {}

  async sendAlert(type: AlertType, message: string, options: NotificationOptions = {}): Promise<void> {
    const now = Date.now();
    const threshold = this.config.thresholds[type];
    if (threshold) {
      const last = this.lastSent.get(type);
      if (last && (now - last) < threshold.minIntervalMs) {
        return;
      }
    }

    this.lastSent.set(type, now);
    const priority = options.priority ?? threshold?.priority ?? 'LOW';
    const payload = this.buildPayload(type, priority, message, options.details);

    await Promise.all([
      this.postWithRetry(this.config.telegramWebhookUrl, { text: payload }),
      this.postWithRetry(this.config.discordWebhookUrl, { content: payload }),
    ]);
  }

  private buildPayload(type: AlertType, priority: AlertPriority, message: string, details?: Record<string, any>): string {
    const base = `${priority} ${type}: ${message}`;
    if (!details || Object.keys(details).length === 0) {
      return base;
    }
    const detailLines = Object.entries(details)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    return `${base} | ${detailLines}`;
  }

  private async postWithRetry(
    url: string | undefined,
    body: Record<string, any>
  ): Promise<void> {
    if (!url) return;
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt += 1) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return;
      } catch {
        if (attempt >= this.retryConfig.maxRetries) {
          // Swallow delivery errors to avoid cascading failures.
          return;
        }
        const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
