import {
  Logger,
  getLogger,
  type LogLevel,
  type LoggerConfig,
} from '../logging';
import {
  TradingBotMetrics,
  MetricNames,
  RiskState,
  createMetricsMiddleware,
  metrics as defaultMetrics,
} from '../telemetry';
import { HealthController } from '../health/HealthController';
import {
  getDefaultHealthController,
  initializeGracefulShutdown,
  isHealthy,
  isReady,
} from '../health';
import {
  getConfig,
  getSystemConfig,
  initializeConfig,
  isInitialized as isConfigInitialized,
} from '../config';

export interface IntegratedSystemState {
  timestamp: number;
  config: {
    initialized: boolean;
    logLevel: string;
    environment: string;
  };
  health: {
    status: string;
    uptimeMs: number;
  };
  readiness: {
    status: string;
    canTrade: boolean;
  };
  telemetry: {
    counters: Record<string, number>;
    gauges: Record<string, number>;
  };
}

export interface IntegrationOptions {
  version: string;
  environment: string;
  enableGracefulShutdown: boolean;
}

export interface IntegrationDependencies {
  getClientCount?: () => number;
  getReadinessState?: () => {
    wsConnected: boolean;
    riskState: string;
    killSwitchActive: boolean;
    memoryThresholdPercent?: number;
  };
}

const DEFAULT_INTEGRATION_OPTIONS: IntegrationOptions = {
  version: '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  enableGracefulShutdown: true,
};

export function createIntegratedLogger(
  module: string,
  correlationId?: string
): Logger {
  let minLevel: LogLevel = 'INFO';
  try {
    if (isConfigInitialized()) {
      const logLevel = getSystemConfig().logLevel;
      if (logLevel === 'debug') minLevel = 'DEBUG';
      if (logLevel === 'info') minLevel = 'INFO';
      if (logLevel === 'warn') minLevel = 'WARN';
      if (logLevel === 'error') minLevel = 'ERROR';
    }
  } catch {
    // keep defaults
  }

  const config: Partial<LoggerConfig> = {
    minLevel,
    enableConsole: true,
    enableFile: false,
  };
  return getLogger(module, correlationId, config);
}

export class ProductionReadinessSystem {
  private readonly options: IntegrationOptions;
  private readonly logger: Logger;
  private readonly healthController: HealthController;
  private readonly metrics: TradingBotMetrics;
  private initialized = false;

  constructor(
    options: Partial<IntegrationOptions> = {},
    private readonly dependencies: IntegrationDependencies = {}
  ) {
    this.options = { ...DEFAULT_INTEGRATION_OPTIONS, ...options };
    this.logger = createIntegratedLogger('system');
    this.metrics = new TradingBotMetrics();

    const wsManager = {
      getClientCount: () => Number(this.dependencies.getClientCount?.() || 0),
    };

    this.healthController = new HealthController(wsManager as any, {
      getReadinessState: this.dependencies.getReadinessState,
    });
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    if (!isConfigInitialized()) {
      initializeConfig();
    }

    if (this.options.enableGracefulShutdown) {
      this.healthController.initializeGracefulShutdown();
    }

    this.initialized = true;
    this.logger.info('production_readiness_initialized', {
      environment: this.options.environment,
      version: this.options.version,
    });
  }

  getHealthController(): HealthController {
    return this.healthController;
  }

  getMetrics(): TradingBotMetrics {
    return this.metrics;
  }

  getLogger(): Logger {
    return this.logger;
  }

  getSystemState(): IntegratedSystemState {
    const health = this.healthController.getHealth();
    const ready = this.healthController.getReady();
    const snapshot = this.metrics.getSnapshot();

    return {
      timestamp: Date.now(),
      config: {
        initialized: isConfigInitialized(),
        logLevel: this.resolveLogLevel(),
        environment: this.options.environment,
      },
      health: {
        status: health.body.status,
        uptimeMs: health.body.uptimeMs,
      },
      readiness: {
        status: ready.body.status,
        canTrade: ready.body.status === 'READY' || ready.body.status === 'DEGRADED',
      },
      telemetry: {
        counters: snapshot.counters,
        gauges: snapshot.gauges,
      },
    };
  }

  isHealthy(): boolean {
    return this.healthController.getHealth().body.status === 'HEALTHY';
  }

  isReady(): boolean {
    return this.healthController.getReady().body.status === 'READY';
  }

  canTrade(): boolean {
    const status = this.healthController.getReady().body.status;
    return status === 'READY' || status === 'DEGRADED';
  }

  recordTradeAttempt(): void {
    this.metrics.recordTradeAttempt();
  }

  recordTradeRejected(reason: string): void {
    this.metrics.recordTradeRejected();
    this.logger.warn('trade_rejected', { reason });
  }

  recordKillSwitch(reason: string): void {
    this.metrics.recordKillSwitchTriggered();
    this.metrics.setRiskState(RiskState.HALTED);
    this.logger.error('kill_switch_triggered', undefined, { reason });
  }

  setRiskState(state: RiskState): void {
    this.metrics.setRiskState(state);
  }

  recordLatency(latencyMs: number): void {
    this.metrics.recordWsLatency(latencyMs);
  }

  createHealthMiddleware(): (req: any, res: any) => void {
    return (_req: any, res: any) => {
      const result = this.healthController.getHealth();
      res.status(result.status).json(result.body);
    };
  }

  createReadyMiddleware(): (req: any, res: any) => void {
    return (_req: any, res: any) => {
      const result = this.healthController.getReady();
      res.status(result.status).json(result.body);
    };
  }

  createMetricsMiddleware(): (req: any, res: any, next?: any) => void {
    const middleware = createMetricsMiddleware();
    return (req: any, res: any, next?: any) => {
      middleware(req, res, next || (() => undefined));
    };
  }

  private resolveLogLevel(): string {
    try {
      return getSystemConfig().logLevel;
    } catch {
      return 'info';
    }
  }
}

let defaultSystem: ProductionReadinessSystem | null = null;

export function getDefaultSystem(): ProductionReadinessSystem {
  if (!defaultSystem) {
    defaultSystem = new ProductionReadinessSystem();
    defaultSystem.initialize();
  }
  return defaultSystem;
}

export function setDefaultSystem(system: ProductionReadinessSystem): void {
  defaultSystem = system;
}

export function resetDefaultSystem(): void {
  defaultSystem = null;
}

export function initializeProductionReadiness(
  options?: Partial<IntegrationOptions>,
  dependencies?: IntegrationDependencies
): ProductionReadinessSystem {
  const system = new ProductionReadinessSystem(options, dependencies);
  system.initialize();
  return system;
}

export function getIntegratedSystemState(): IntegratedSystemState {
  return getDefaultSystem().getSystemState();
}

export function checkReady(): boolean {
  return getDefaultSystem().isReady();
}

export function checkHealthy(): boolean {
  return getDefaultSystem().isHealthy();
}

export function setupExpressEndpoints(
  app: { get: (path: string, handler: any) => void },
  system: ProductionReadinessSystem = getDefaultSystem()
): void {
  app.get('/health', system.createHealthMiddleware());
  app.get('/ready', system.createReadyMiddleware());
  app.get('/metrics', system.createMetricsMiddleware());
}

export {
  Logger,
  TradingBotMetrics,
  MetricNames,
  RiskState,
  defaultMetrics as metrics,
  getConfig,
  getSystemConfig,
  initializeConfig,
  initializeGracefulShutdown,
  isReady,
  isHealthy,
  getDefaultHealthController,
};

export default {
  ProductionReadinessSystem,
  getDefaultSystem,
  initializeProductionReadiness,
  getIntegratedSystemState,
  checkReady,
  checkHealthy,
  setupExpressEndpoints,
  createIntegratedLogger,
};
