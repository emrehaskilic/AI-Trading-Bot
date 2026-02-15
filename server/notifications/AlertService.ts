import { AlertConfig, AlertPriority, AlertType } from './types';
import { NotificationService } from './NotificationService';

export class AlertService {
  private readonly notifier: NotificationService;

  constructor(config: AlertConfig) {
    this.notifier = new NotificationService(config);
  }

  async send(type: AlertType, message: string, priority: AlertPriority): Promise<void> {
    await this.notifier.sendAlert(type, message, { priority });
  }
}
