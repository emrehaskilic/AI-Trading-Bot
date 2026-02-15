import { AlertConfig } from '../notifications/types';

export function buildAlertConfigFromEnv(): AlertConfig {
  return {
    telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
    thresholds: {
      LIQUIDATION_RISK: { priority: 'CRITICAL', minIntervalMs: 60_000 },
      LARGE_LOSS: { priority: 'HIGH', minIntervalMs: 300_000 },
      CONNECTION_LOST: { priority: 'HIGH', minIntervalMs: 120_000 },
      SIGNAL_STRENGTH: { priority: 'MEDIUM', minIntervalMs: 30_000 },
      ORDERBOOK_INTEGRITY: { priority: 'CRITICAL', minIntervalMs: 120_000 },
      DRYRUN_ENGINE: { priority: 'CRITICAL', minIntervalMs: 60_000 },
      INTERNAL_ERROR: { priority: 'CRITICAL', minIntervalMs: 60_000 },
      DAILY_KILL_SWITCH: { priority: 'CRITICAL', minIntervalMs: 60_000 },
      DAILY_REPORT: { priority: 'LOW', minIntervalMs: 86_400_000 },
    },
  };
}

let cachedAlertConfig: AlertConfig | null = null;

export function getAlertConfig(): AlertConfig {
  if (!cachedAlertConfig) {
    cachedAlertConfig = buildAlertConfigFromEnv();
  }
  return cachedAlertConfig;
}
