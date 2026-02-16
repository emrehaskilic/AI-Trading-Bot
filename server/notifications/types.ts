export type AlertType =
  | 'LIQUIDATION_RISK'
  | 'LARGE_LOSS'
  | 'CONNECTION_LOST'
  | 'DATA_QUALITY_ISSUE'
  | 'SIGNAL_STRENGTH'
  | 'ORDERBOOK_INTEGRITY'
  | 'EXECUTION_LATENCY_HIGH'
  | 'HIGH_DRAWDOWN'
  | 'VAR_EXCEEDED'
  | 'EXCESSIVE_LEVERAGE'
  | 'STOP_LOSS_HIT'
  | 'TAKE_PROFIT_HIT'
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
