import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const logging = require('../server/dist/logging/index.js');
const telemetryIndex = require('../server/dist/telemetry/index.js');
const telemetryCollector = require('../server/dist/telemetry/MetricsCollector.js');
const telemetryExporter = require('../server/dist/telemetry/TelemetryExporter.js');
const configIndex = require('../server/dist/config/index.js');
const configSchema = require('../server/dist/config/ConfigSchema.js');
const safeDefaults = require('../server/dist/config/SafeDefaults.js');
const configValidator = require('../server/dist/config/ConfigValidator.js');
const healthControllerModule = require('../server/dist/health/HealthController.js');
const healthIndex = require('../server/dist/health/index.js');
const integration = require('../server/dist/integration/index.js');

const {
  getLogger,
  logger,
  LogLevelValues,
  generateCorrelationId,
  startPerformanceLog,
  clearLoggerCache,
  getLoggerCacheStats,
  correlationIdMiddleware,
  getGlobalCorrelationId,
} = logging;

const {
  TradingBotMetrics,
  MetricNames,
  RiskState,
} = telemetryIndex;

const {
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  MetricsCollector,
} = telemetryCollector;

const { TelemetryExporter } = telemetryExporter;

const {
  initializeConfig,
  getConfig,
  getSystemConfig,
  getTradingConfig,
  isInitialized,
  resetConfig,
} = configIndex;

const { TradingConfigSchema, SystemConfigSchema } = configSchema;

const {
  SAFE_DEFAULTS,
  mergeWithDefaults,
  clampToConstraints,
  isWithinConstraints,
} = safeDefaults;

const {
  validateNumericRange,
  validateEnvVars,
  createValidatedConfig,
} = configValidator;

const { HealthController } = healthControllerModule;

const {
  resetDefaultHealthController,
  initializeGracefulShutdown,
  getHealth,
  getReady,
} = healthIndex;

const {
  ProductionReadinessSystem,
  initializeProductionReadiness,
  setupExpressEndpoints,
  getDefaultSystem,
  resetDefaultSystem,
} = integration;

type TestResult = {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
};

const results: TestResult[] = [];

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected=${String(expected)} actual=${String(actual)})`);
  }
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: msg, durationMs: Date.now() - start });
    process.stdout.write(`FAIL ${name}: ${msg}\n`);
  }
}

async function loggingSuite(): Promise<void> {
  await runTest('logging:getLogger returns instance', () => {
    const l = getLogger('test');
    assert(typeof l.info === 'function', 'logger.info missing');
  });

  await runTest('logging:logger cache reuses same key', () => {
    clearLoggerCache();
    const a = getLogger('cache-test');
    const b = getLogger('cache-test');
    assert(a === b, 'logger cache did not reuse instance');
  });

  await runTest('logging:logger cache size tracks entries', () => {
    clearLoggerCache();
    getLogger('a');
    getLogger('b');
    assertEqual(getLoggerCacheStats().size, 2, 'cache size mismatch');
  });

  await runTest('logging:generateCorrelationId unique', () => {
    const a = generateCorrelationId('req');
    const b = generateCorrelationId('req');
    assert(a !== b, 'IDs must be unique');
  });

  await runTest('logging:generateCorrelationId prefix', () => {
    const id = generateCorrelationId('custom');
    assert(id.startsWith('custom-'), 'prefix not applied');
  });

  await runTest('logging:LogLevelValues debug', () => {
    assertEqual(LogLevelValues.DEBUG, 0, 'DEBUG level mismatch');
  });

  await runTest('logging:LogLevelValues error', () => {
    assertEqual(LogLevelValues.ERROR, 3, 'ERROR level mismatch');
  });

  await runTest('logging:startPerformanceLog end callable', () => {
    const perf = startPerformanceLog('op', 'system');
    perf.end({ ok: true });
  });

  await runTest('logging:default logger callable', () => {
    logger.info('logging_default_logger_test');
  });

  await runTest('logging:correlation middleware respects header', () => {
    const middleware = correlationIdMiddleware();
    const req: any = { headers: { 'x-correlation-id': 'cid-123' } };
    const res: any = {};
    let called = false;
    middleware(req, res, () => {
      called = true;
    });
    assert(called, 'middleware did not call next');
    assertEqual(getGlobalCorrelationId(), 'cid-123', 'correlation id mismatch');
  });
}

async function telemetrySuite(): Promise<void> {
  await runTest('telemetry:counter increments default', () => {
    const c = new CounterMetric('counter');
    assertEqual(c.increment(), 1, 'counter increment mismatch');
  });

  await runTest('telemetry:counter increments custom amount', () => {
    const c = new CounterMetric('counter');
    assertEqual(c.increment(5), 5, 'counter custom increment mismatch');
  });

  await runTest('telemetry:counter reject decrement', () => {
    const c = new CounterMetric('counter');
    let thrown = false;
    try {
      c.increment(-1);
    } catch {
      thrown = true;
    }
    assert(thrown, 'counter decrement should throw');
  });

  await runTest('telemetry:gauge set value', () => {
    const g = new GaugeMetric('gauge');
    assertEqual(g.set(42), 42, 'gauge set mismatch');
  });

  await runTest('telemetry:gauge increment', () => {
    const g = new GaugeMetric('gauge');
    g.set(10);
    assertEqual(g.increment(2), 12, 'gauge increment mismatch');
  });

  await runTest('telemetry:gauge decrement', () => {
    const g = new GaugeMetric('gauge');
    g.set(10);
    assertEqual(g.decrement(3), 7, 'gauge decrement mismatch');
  });

  await runTest('telemetry:histogram count', () => {
    const h = new HistogramMetric('h', [1, 5, 10]);
    h.observe(2);
    h.observe(9);
    assertEqual(h.getPercentiles().count, 2, 'histogram count mismatch');
  });

  await runTest('telemetry:histogram percentile nonzero', () => {
    const h = new HistogramMetric('h', [1, 5, 10]);
    h.observe(3);
    h.observe(4);
    assert(h.getPercentile(50) > 0, 'p50 must be > 0');
  });

  await runTest('telemetry:collector register counter', () => {
    const c = new MetricsCollector();
    c.registerCounter('x');
    assertEqual(c.getCounterValue('x'), 0, 'registered counter mismatch');
  });

  await runTest('telemetry:collector increment counter', () => {
    const c = new MetricsCollector();
    c.incrementCounter('x');
    assertEqual(c.getCounterValue('x'), 1, 'incremented counter mismatch');
  });

  await runTest('telemetry:collector set gauge', () => {
    const c = new MetricsCollector();
    c.setGauge('g', 11);
    assertEqual(c.getGaugeValue('g'), 11, 'gauge value mismatch');
  });

  await runTest('telemetry:collector histogram observe', () => {
    const c = new MetricsCollector();
    c.registerHistogram('h', [1, 5, 10]);
    c.observeHistogram('h', 7);
    assertEqual(c.getHistogramPercentiles('h')?.count, 1, 'histogram observe mismatch');
  });

  await runTest('telemetry:trading metrics trade attempt', () => {
    const m = new TradingBotMetrics();
    m.recordTradeAttempt();
    assertEqual(m.getSnapshot().counters[MetricNames.TRADE_ATTEMPT_TOTAL], 1, 'trade attempt counter mismatch');
  });

  await runTest('telemetry:trading metrics trade rejected', () => {
    const m = new TradingBotMetrics();
    m.recordTradeRejected();
    assertEqual(m.getSnapshot().counters[MetricNames.TRADE_REJECTED_TOTAL], 1, 'trade rejected counter mismatch');
  });

  await runTest('telemetry:trading metrics kill switch counter', () => {
    const m = new TradingBotMetrics();
    m.recordKillSwitchTriggered();
    assertEqual(m.getSnapshot().counters[MetricNames.KILL_SWITCH_TRIGGERED_TOTAL], 1, 'kill switch counter mismatch');
  });

  await runTest('telemetry:trading metrics risk state gauge', () => {
    const m = new TradingBotMetrics();
    m.setRiskState(RiskState.WARNING);
    assertEqual(m.getSnapshot().gauges[MetricNames.RISK_STATE_CURRENT], RiskState.WARNING, 'risk gauge mismatch');
  });

  await runTest('telemetry:trading metrics pnl gauge', () => {
    const m = new TradingBotMetrics();
    m.setPnL(123.45);
    assertEqual(m.getSnapshot().gauges[MetricNames.ANALYTICS_PNL_GAUGE], 123.45, 'pnl gauge mismatch');
  });

  await runTest('telemetry:trading metrics ws latency histogram', () => {
    const m = new TradingBotMetrics();
    m.recordWsLatency(44);
    assertEqual(m.getSnapshot().histograms[MetricNames.WS_LATENCY_HISTOGRAM].count, 1, 'ws latency count mismatch');
  });

  await runTest('telemetry:trading metrics confidence histogram', () => {
    const m = new TradingBotMetrics();
    m.recordDecisionConfidence(0.82);
    assertEqual(
      m.getSnapshot().histograms[MetricNames.STRATEGY_DECISION_CONFIDENCE_HISTOGRAM].count,
      1,
      'confidence count mismatch'
    );
  });

  await runTest('telemetry:exporter json', () => {
    const c = new MetricsCollector();
    c.incrementCounter('x');
    const exporter = new TelemetryExporter(c);
    const json = exporter.exportMetricsJSON();
    assert(json.includes('"timestamp"'), 'json export missing timestamp');
  });

  await runTest('telemetry:exporter prometheus', () => {
    const c = new MetricsCollector();
    c.registerCounter('x');
    c.incrementCounter('x');
    const exporter = new TelemetryExporter(c);
    const prom = exporter.exportMetricsPrometheus();
    assert(prom.includes('# TYPE x counter'), 'prometheus format missing counter type');
  });

  await runTest('telemetry:metrics endpoint defaults json', () => {
    const m = new TradingBotMetrics();
    const resp = m.handleMetricsEndpoint('application/json');
    assertEqual(resp.statusCode, 200, 'status mismatch');
    assert(resp.headers['Content-Type'].includes('application/json'), 'json content-type mismatch');
  });

  await runTest('telemetry:metrics endpoint text', () => {
    const m = new TradingBotMetrics();
    const resp = m.handleMetricsEndpoint('text/plain');
    assert(resp.headers['Content-Type'].includes('text/plain'), 'text content-type mismatch');
  });
}

async function configSuite(): Promise<void> {
  await runTest('config:defaults trading disabled', () => {
    assertEqual(SAFE_DEFAULTS.tradingEnabled, false, 'trading should default false');
  });

  await runTest('config:defaults paper trading true', () => {
    assertEqual(SAFE_DEFAULTS.paperTrading, true, 'paper trading should default true');
  });

  await runTest('config:mergeWithDefaults override', () => {
    const merged = mergeWithDefaults({ trading: { latencyThreshold: 777 } });
    assertEqual(merged.trading.latencyThreshold, 777, 'merge override mismatch');
  });

  await runTest('config:isWithinConstraints valid', () => {
    assert(isWithinConstraints('latencyThreshold', 500), '500 should be valid');
  });

  await runTest('config:isWithinConstraints invalid', () => {
    assert(!isWithinConstraints('latencyThreshold', 50000), '50000 should be invalid');
  });

  await runTest('config:clampToConstraints upper bound', () => {
    const clamped = clampToConstraints('latencyThreshold', 50_000);
    assert(clamped <= 5000, 'clamp upper bound failed');
  });

  await runTest('config:validateNumericRange', () => {
    assert(validateNumericRange('x', 5, 0, 10), 'numeric range should pass');
  });

  await runTest('config:TradingConfigSchema safe parse', () => {
    const result = TradingConfigSchema.safeParse({
      latencyThreshold: 500,
      flashCrashThreshold: 5,
      maxDrawdown: 10,
      quorumSize: 3,
      confidenceThreshold: 0.7,
      maxPositionSize: 20,
      stopLossPercent: 2,
      takeProfitPercent: 5,
      maxConcurrentTrades: 5,
      tradingEnabled: false,
      paperTrading: true,
    });
    assert(result.success, 'TradingConfigSchema should parse valid input');
  });

  await runTest('config:SystemConfigSchema safe parse', () => {
    const result = SystemConfigSchema.safeParse({
      memoryThreshold: 80,
      wsTimeout: 30000,
      healthCheckInterval: 30000,
      gracefulShutdownTimeout: 10000,
      logLevel: 'info',
      maxLogFileSize: 100,
      logFileCount: 5,
      nodeEnv: 'development',
      port: 3000,
      enableMetrics: true,
    });
    assert(result.success, 'SystemConfigSchema should parse valid input');
  });

  await runTest('config:validateEnvVars default valid', () => {
    const result = validateEnvVars({});
    assert(result.valid, 'empty env should be valid with defaults');
  });

  await runTest('config:createValidatedConfig returns config', () => {
    const cfg = createValidatedConfig({});
    assert(typeof cfg.system.port === 'number', 'validated config missing port');
  });

  await runTest('config:initializeConfig + getConfig', () => {
    resetConfig();
    initializeConfig({});
    assert(isInitialized(), 'config should initialize');
    const cfg = getConfig();
    assert(typeof cfg.system.port === 'number', 'getConfig missing port');
  });

  await runTest('config:getSystemConfig', () => {
    const sys = getSystemConfig();
    assert(typeof sys.memoryThreshold === 'number', 'system config missing memoryThreshold');
  });

  await runTest('config:getTradingConfig', () => {
    const trading = getTradingConfig();
    assert(typeof trading.confidenceThreshold === 'number', 'trading config missing confidenceThreshold');
  });
}

async function healthSuite(): Promise<void> {
  const wsManager = { getClientCount: () => 1 } as any;

  await runTest('health:getHealth basic response', () => {
    const hc = new HealthController(wsManager);
    const result = hc.getHealth();
    assert(result.status === 200 || result.status === 503, 'health status invalid');
  });

  await runTest('health:getReady basic response', () => {
    const hc = new HealthController(wsManager, {
      getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
    });
    hc.setLastDataReceivedAt(Date.now());
    const result = hc.getReady();
    assert(result.status === 200 || result.status === 503, 'ready status invalid');
  });

  await runTest('health:ready degrades when stale data', () => {
    const hc = new HealthController(wsManager, {
      getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
    });
    const result = hc.getReady();
    assert(result.body.status !== 'READY', 'without data it should not be READY');
  });

  await runTest('health:ready not ready when kill switch active', () => {
    const hc = new HealthController(wsManager, {
      getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: true }),
    });
    hc.setLastDataReceivedAt(Date.now());
    const result = hc.getReady();
    assert(result.body.status !== 'READY', 'kill switch should block readiness');
  });

  await runTest('health:ready not ready when risk halted', () => {
    const hc = new HealthController(wsManager, {
      getReadinessState: () => ({ wsConnected: true, riskState: 'HALTED', killSwitchActive: false }),
    });
    hc.setLastDataReceivedAt(Date.now());
    const result = hc.getReady();
    assert(result.body.status !== 'READY', 'HALTED risk should block readiness');
  });

  await runTest('health:liveness handler', () => {
    const hc = new HealthController(wsManager);
    let code = 0;
    const res: any = {
      status: (c: number) => {
        code = c;
        return { json: (_body: unknown) => undefined };
      },
    };
    hc.liveness({} as any, res);
    assert(code === 200 || code === 503, 'liveness code invalid');
  });

  await runTest('health:readiness handler', () => {
    const hc = new HealthController(wsManager, {
      getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
    });
    hc.setLastDataReceivedAt(Date.now());
    let code = 0;
    const res: any = {
      status: (c: number) => {
        code = c;
        return { json: (_body: unknown) => undefined };
      },
    };
    hc.readiness({} as any, res);
    assert(code === 200 || code === 503, 'readiness code invalid');
  });

  await runTest('health:metrics handler emits text', () => {
    const hc = new HealthController(wsManager);
    let body = '';
    const res: any = {
      setHeader: () => undefined,
      status: (_c: number) => ({
        send: (v: string) => {
          body = v;
        },
      }),
    };
    hc.metrics({} as any, res);
    assert(body.includes('app_uptime_seconds'), 'metrics output missing uptime metric');
  });

  await runTest('health:onShutdown handler called', async () => {
    const hc = new HealthController(wsManager);
    let called = false;
    hc.onShutdown(() => {
      called = true;
    });
    await hc.shutdown('test');
    assert(called, 'shutdown handler not called');
  });

  await runTest('health:singleton convenience functions', () => {
    resetDefaultHealthController();
    initializeGracefulShutdown();
    const h = getHealth();
    const r = getReady();
    assert(h.status === 200 || h.status === 503, 'singleton health invalid');
    assert(r.status === 200 || r.status === 503, 'singleton ready invalid');
  });
}

async function integrationSuite(): Promise<void> {
  await runTest('integration:system constructs', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    assert(system.getLogger() != null, 'logger missing');
    assert(system.getMetrics() != null, 'metrics missing');
  });

  await runTest('integration:initializeProductionReadiness', () => {
    const system = initializeProductionReadiness(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    const state = system.getSystemState();
    assert(typeof state.timestamp === 'number', 'state timestamp missing');
  });

  await runTest('integration:recordTradeAttempt updates counter', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    system.recordTradeAttempt();
    const state = system.getSystemState();
    assert(state.telemetry.counters[MetricNames.TRADE_ATTEMPT_TOTAL] >= 1, 'trade attempt not recorded');
  });

  await runTest('integration:recordTradeRejected updates counter', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    system.recordTradeRejected('reason');
    const state = system.getSystemState();
    assert(state.telemetry.counters[MetricNames.TRADE_REJECTED_TOTAL] >= 1, 'trade rejected not recorded');
  });

  await runTest('integration:recordKillSwitch updates state', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    system.recordKillSwitch('manual');
    const state = system.getSystemState();
    assertEqual(state.telemetry.gauges[MetricNames.RISK_STATE_CURRENT], RiskState.HALTED, 'risk state should be halted');
  });

  await runTest('integration:setRiskState warning', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    system.setRiskState(RiskState.WARNING);
    const state = system.getSystemState();
    assertEqual(state.telemetry.gauges[MetricNames.RISK_STATE_CURRENT], RiskState.WARNING, 'risk state warning mismatch');
  });

  await runTest('integration:recordLatency histogram count', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    system.recordLatency(50);
    const snapshot = system.getMetrics().getSnapshot();
    assert(snapshot.histograms[MetricNames.WS_LATENCY_HISTOGRAM].count >= 1, 'latency not recorded');
  });

  await runTest('integration:health middleware works', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    const mw = system.createHealthMiddleware();
    let code = 0;
    const res: any = {
      status: (c: number) => {
        code = c;
        return { json: (_body: unknown) => undefined };
      },
    };
    mw({}, res);
    assert(code === 200 || code === 503, 'health middleware invalid status');
  });

  await runTest('integration:ready middleware works', () => {
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    const mw = system.createReadyMiddleware();
    let code = 0;
    const res: any = {
      status: (c: number) => {
        code = c;
        return { json: (_body: unknown) => undefined };
      },
    };
    mw({}, res);
    assert(code === 200 || code === 503, 'ready middleware invalid status');
  });

  await runTest('integration:setupExpressEndpoints registers routes', () => {
    resetDefaultSystem();
    const routes: string[] = [];
    const app = {
      get: (path: string, _handler: any) => {
        routes.push(path);
      },
    };
    const system = new ProductionReadinessSystem(
      { enableGracefulShutdown: false },
      {
        getClientCount: () => 1,
        getReadinessState: () => ({ wsConnected: true, riskState: 'TRACKING', killSwitchActive: false }),
      }
    );
    setupExpressEndpoints(app, system);
    assert(routes.includes('/health'), '/health not registered');
    assert(routes.includes('/ready'), '/ready not registered');
    assert(routes.includes('/metrics'), '/metrics not registered');
  });

  await runTest('integration:getDefaultSystem singleton', () => {
    resetDefaultSystem();
    const a = getDefaultSystem();
    const b = getDefaultSystem();
    assert(a === b, 'default system should be singleton');
  });
}

async function main(): Promise<void> {
  const started = Date.now();
  process.stdout.write('Production readiness tests started\n');

  await loggingSuite();
  await telemetrySuite();
  await configSuite();
  await healthSuite();
  await integrationSuite();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const durationMs = Date.now() - started;

  process.stdout.write(`\nTotal: ${results.length}\n`);
  process.stdout.write(`Passed: ${passed}\n`);
  process.stdout.write(`Failed: ${failed}\n`);
  process.stdout.write(`DurationMs: ${durationMs}\n`);

  if (failed > 0) {
    process.stdout.write('Failed tests:\n');
    for (const result of results.filter((r) => !r.passed)) {
      process.stdout.write(`- ${result.name}: ${result.error}\n`);
    }
    process.exit(1);
  }

  process.stdout.write('All prod readiness tests passed.\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
