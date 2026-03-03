export {
  HealthStatus,
  ReadinessStatus,
  RiskState,
  HealthCheck,
  HealthReport,
  ReadinessChecks,
  ReadinessDetails,
  ReadinessReport,
  HealthCheckConfig,
  ReadinessCheckConfig,
  ShutdownConfig,
  ShutdownState,
  IWebSocketProvider,
  IRiskManager,
  IKillSwitch,
  HealthDependencies,
  DEFAULT_HEALTH_CONFIG,
  DEFAULT_READINESS_CONFIG,
  DEFAULT_SHUTDOWN_CONFIG,
} from './types';

export {
  ReadinessChecker,
  getDefaultReadinessChecker,
  setDefaultReadinessChecker,
  resetDefaultReadinessChecker,
} from './ReadinessChecker';

export { HealthController } from './HealthController';

import { HealthController } from './HealthController';
import type { HealthReport, ReadinessReport } from './types';

type MinimalWsManager = {
  getClientCount(): number;
};

const defaultWsManager: MinimalWsManager = {
  getClientCount(): number {
    return 0;
  },
};

let defaultController: HealthController | null = null;

export function getDefaultHealthController(): HealthController {
  if (!defaultController) {
    defaultController = new HealthController(defaultWsManager as any);
  }
  return defaultController;
}

export function setDefaultHealthController(controller: HealthController): void {
  defaultController = controller;
}

export function resetDefaultHealthController(): void {
  defaultController = null;
}

export function createHealthRouter(controller: HealthController = getDefaultHealthController()) {
  return {
    getHealth: (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      const result = controller.getHealth();
      res.status(result.status).json(result.body);
    },
    getReady: (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      const result = controller.getReady();
      res.status(result.status).json(result.body);
    },
  };
}

export function getHealth(): { status: number; body: HealthReport | any } {
  return getDefaultHealthController().getHealth() as any;
}

export function getReady(): { status: number; body: ReadinessReport | any } {
  return getDefaultHealthController().getReady() as any;
}

export function isReady(): boolean {
  const result = getDefaultHealthController().getReady();
  return result.body.status === 'READY';
}

export function isHealthy(): boolean {
  const result = getDefaultHealthController().getHealth();
  return result.body.status === 'HEALTHY';
}

export function initializeGracefulShutdown(): void {
  getDefaultHealthController().initializeGracefulShutdown();
}

export function onShutdown(handler: () => Promise<void> | void): void {
  getDefaultHealthController().onShutdown(handler);
}

export async function shutdown(reason: string = 'manual'): Promise<void> {
  await getDefaultHealthController().shutdown(reason);
}

export function getUptime(): number {
  return getDefaultHealthController().getUptime();
}

export function isShuttingDown(): boolean {
  return getDefaultHealthController().isShuttingDown();
}

export default {
  HealthController,
};
