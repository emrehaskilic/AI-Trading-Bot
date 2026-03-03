import { Request, Response } from 'express';
import { WebSocketManager } from '../ws/WebSocketManager';
import { LatencySnapshot } from '../metrics/LatencyTracker';

type ReadinessState = {
  wsConnected: boolean;
  riskState: string;
  killSwitchActive: boolean;
  memoryThresholdPercent?: number;
};

interface HealthControllerOptions {
  getLatencySnapshot?: () => LatencySnapshot;
  getReadinessState?: () => ReadinessState;
}

type HealthReport = {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  timestamp: number;
  uptimeMs: number;
  details: {
    dataFresh: boolean;
    dataAgeMs: number;
    wsClients: number;
    wsConnected: boolean;
    dryRunActive: boolean;
    memoryUsagePercent: number;
    shuttingDown: boolean;
    shutdownReason: string | null;
  };
};

type ReadyReport = {
  status: 'READY' | 'DEGRADED' | 'NOT_READY';
  timestamp: number;
  checks: {
    ws: boolean;
    risk: boolean;
    killSwitch: boolean;
    memory: boolean;
  };
  details: {
    wsConnected: boolean;
    riskState: string;
    killSwitchActive: boolean;
    memoryUsagePercent: number;
    dataAgeMs: number;
  };
  message: string;
};

export class HealthController {
  private lastDataReceivedAt = 0;
  private dryRunActive = false;
  private readonly startTime = Date.now();
  private shuttingDown = false;
  private shutdownReason: string | null = null;
  private readonly shutdownHandlers: Array<() => Promise<void> | void> = [];
  private gracefulShutdownInitialized = false;

  constructor(
    private readonly wsManager: WebSocketManager,
    private readonly options: HealthControllerOptions = {}
  ) {}

  setLastDataReceivedAt(timestampMs: number): void {
    if (Number.isFinite(timestampMs) && timestampMs > this.lastDataReceivedAt) {
      this.lastDataReceivedAt = timestampMs;
    }
  }

  setDryRunActive(active: boolean): void {
    this.dryRunActive = active;
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  getHealth(): { status: number; body: HealthReport } {
    const now = Date.now();
    const wsClients = this.wsManager.getClientCount();
    const readiness = this.options.getReadinessState?.();
    const wsConnected = readiness?.wsConnected ?? wsClients > 0;
    const dataAgeMs = this.lastDataReceivedAt > 0 ? now - this.lastDataReceivedAt : Number.POSITIVE_INFINITY;
    const dataFresh = dataAgeMs < 10_000;
    const memoryUsagePercent = this.getMemoryUsagePercent();

    let healthStatus: HealthReport['status'] = 'HEALTHY';
    if (this.shuttingDown || memoryUsagePercent >= 98) {
      healthStatus = 'UNHEALTHY';
    } else if (!dataFresh || !wsConnected || memoryUsagePercent >= 90) {
      healthStatus = 'DEGRADED';
    }

    const body: HealthReport = {
      status: healthStatus,
      timestamp: now,
      uptimeMs: now - this.startTime,
      details: {
        dataFresh,
        dataAgeMs,
        wsClients,
        wsConnected,
        dryRunActive: this.dryRunActive,
        memoryUsagePercent,
        shuttingDown: this.shuttingDown,
        shutdownReason: this.shutdownReason,
      },
    };

    return {
      status: healthStatus === 'UNHEALTHY' ? 503 : 200,
      body,
    };
  }

  getReady(): { status: number; body: ReadyReport } {
    const now = Date.now();
    const readiness = this.options.getReadinessState?.();
    const dataAgeMs = this.lastDataReceivedAt > 0 ? now - this.lastDataReceivedAt : Number.POSITIVE_INFINITY;
    const dataFresh = dataAgeMs < 10_000;
    const wsConnected = readiness?.wsConnected ?? this.wsManager.getClientCount() > 0;
    const riskState = readiness?.riskState ?? 'TRACKING';
    const killSwitchActive = readiness?.killSwitchActive ?? false;
    const memoryUsagePercent = this.getMemoryUsagePercent();
    const memoryThreshold = Number.isFinite(readiness?.memoryThresholdPercent)
      ? Number(readiness?.memoryThresholdPercent)
      : 85;

    const checks = {
      ws: wsConnected && dataFresh,
      risk: riskState !== 'HALTED' && riskState !== 'KILL_SWITCH',
      killSwitch: !killSwitchActive,
      memory: memoryUsagePercent <= memoryThreshold,
    };

    let status: ReadyReport['status'] = 'READY';
    if (!checks.ws && !checks.risk && !checks.killSwitch && !checks.memory) {
      status = 'NOT_READY';
    } else if (!checks.ws || !checks.risk || !checks.killSwitch || !checks.memory || this.shuttingDown) {
      status = 'DEGRADED';
    }
    if (this.shuttingDown) {
      status = 'NOT_READY';
    }

    const failedChecks: string[] = [];
    if (!checks.ws) failedChecks.push('ws');
    if (!checks.risk) failedChecks.push('risk');
    if (!checks.killSwitch) failedChecks.push('killSwitch');
    if (!checks.memory) failedChecks.push('memory');

    const body: ReadyReport = {
      status,
      timestamp: now,
      checks,
      details: {
        wsConnected,
        riskState,
        killSwitchActive,
        memoryUsagePercent,
        dataAgeMs,
      },
      message: failedChecks.length > 0
        ? `failed_checks:${failedChecks.join(',')}`
        : 'ready',
    };

    return {
      status: status === 'NOT_READY' ? 503 : 200,
      body,
    };
  }

  initializeGracefulShutdown(): void {
    if (this.gracefulShutdownInitialized) {
      return;
    }
    this.gracefulShutdownInitialized = true;

    process.on('SIGTERM', () => {
      void this.shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void this.shutdown('SIGINT');
    });
  }

  onShutdown(handler: () => Promise<void> | void): void {
    this.shutdownHandlers.push(handler);
  }

  async shutdown(reason: string = 'manual'): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.shutdownReason = reason;

    for (const handler of this.shutdownHandlers) {
      await handler();
    }
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  liveness = (_req: Request, res: Response) => {
    const now = Date.now();
    res.status(this.shuttingDown ? 503 : 200).json({
      status: this.shuttingDown ? 'DOWN' : 'UP',
      timestamp: now,
      uptimeMs: now - this.startTime,
      shutdownReason: this.shutdownReason,
    });
  };

  readiness = (_req: Request, res: Response) => {
    const result = this.getReady();
    res.status(result.status).json(result.body);
  };

  metrics = (_req: Request, res: Response) => {
    const now = Date.now();
    const uptimeSeconds = (now - this.startTime) / 1000;
    const dataStalenessSeconds = this.lastDataReceivedAt > 0 ? (now - this.lastDataReceivedAt) / 1000 : -1;
    const wsClients = this.wsManager.getClientCount();
    const ready = this.getReady();

    let output = '';
    output += `# HELP app_uptime_seconds Application uptime in seconds\n`;
    output += `# TYPE app_uptime_seconds gauge\n`;
    output += `app_uptime_seconds ${uptimeSeconds}\n`;

    output += `# HELP data_feed_staleness_seconds Time since last data update\n`;
    output += `# TYPE data_feed_staleness_seconds gauge\n`;
    output += `data_feed_staleness_seconds ${dataStalenessSeconds}\n`;

    output += `# HELP websocket_connected_clients Connected WebSocket clients\n`;
    output += `# TYPE websocket_connected_clients gauge\n`;
    output += `websocket_connected_clients ${wsClients}\n`;

    output += `# HELP readiness_status Readiness status (READY=1, DEGRADED=0.5, NOT_READY=0)\n`;
    output += `# TYPE readiness_status gauge\n`;
    output += `readiness_status ${ready.body.status === 'READY' ? 1 : ready.body.status === 'DEGRADED' ? 0.5 : 0}\n`;

    const mem = process.memoryUsage();
    output += `# HELP process_memory_bytes Process memory usage in bytes\n`;
    output += `# TYPE process_memory_bytes gauge\n`;
    output += `process_memory_bytes{type="rss"} ${mem.rss}\n`;
    output += `process_memory_bytes{type="heapTotal"} ${mem.heapTotal}\n`;
    output += `process_memory_bytes{type="heapUsed"} ${mem.heapUsed}\n`;
    output += `process_memory_bytes{type="external"} ${mem.external}\n`;

    if (this.options.getLatencySnapshot) {
      const snapshot = this.options.getLatencySnapshot();
      output += `# HELP pipeline_latency_ms Pipeline latency per stage\n`;
      output += `# TYPE pipeline_latency_ms gauge\n`;
      for (const [stage, stats] of Object.entries(snapshot.stages)) {
        output += `pipeline_latency_ms{stage="${stage}",quantile="avg"} ${stats.avgMs}\n`;
        output += `pipeline_latency_ms{stage="${stage}",quantile="p95"} ${stats.p95Ms}\n`;
        output += `pipeline_latency_ms{stage="${stage}",quantile="max"} ${stats.maxMs}\n`;
      }
    }

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(output);
  };

  private getMemoryUsagePercent(): number {
    const usage = process.memoryUsage();
    if (usage.heapTotal <= 0) {
      return 0;
    }
    const heapPct = (usage.heapUsed / usage.heapTotal) * 100;
    const rssCap = 4 * 1024 * 1024 * 1024;
    const rssPct = (usage.rss / rssCap) * 100;
    return Math.max(heapPct, rssPct);
  }
}
