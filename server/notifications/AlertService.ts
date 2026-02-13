import { AlertConfig, AlertPriority, AlertType } from './types';

type SentAlert = {
  type: AlertType;
  priority: AlertPriority;
  message: string;
  timestampMs: number;
};

export class AlertService {
  private readonly config: AlertConfig;
  private readonly lastSent = new Map<AlertType, SentAlert>();

  constructor(config: AlertConfig) {
    this.config = config;
  }

  async send(type: AlertType, message: string, priority: AlertPriority): Promise<void> {
    const now = Date.now();
    const threshold = this.config.thresholds[type];
    if (threshold) {
      const prev = this.lastSent.get(type);
      if (prev && (now - prev.timestampMs) < threshold.minIntervalMs) {
        return;
      }
    }

    this.lastSent.set(type, { type, priority, message, timestampMs: now });

    const payload = `${priority} ${type}: ${message}`;
    await Promise.all([
      this.sendTelegram(payload),
      this.sendDiscord(payload),
    ]);
  }

  private async sendTelegram(text: string): Promise<void> {
    const url = this.config.telegramWebhookUrl;
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch {
      // Ignore alert delivery failures.
    }
  }

  private async sendDiscord(content: string): Promise<void> {
    const url = this.config.discordWebhookUrl;
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch {
      // Ignore alert delivery failures.
    }
  }
}
