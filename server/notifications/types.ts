export type AlertType =
  | 'LIQUIDATION_RISK'
  | 'LARGE_LOSS'
  | 'CONNECTION_LOST'
  | 'SIGNAL_STRENGTH'
  | 'ORDERBOOK_INTEGRITY'
  | 'DRYRUN_ENGINE'
  | 'DAILY_REPORT'
  | 'DAILY_KILL_SWITCH'
  | 'INTERNAL_ERROR';

export type AlertPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AlertThreshold {
  priority: AlertPriority;
  minIntervalMs: number;
}

export interface AlertConfig {
  telegramWebhookUrl?: string;
  discordWebhookUrl?: string;
  thresholds: Partial<Record<AlertType, AlertThreshold>>;
}
