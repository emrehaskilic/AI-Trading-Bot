import { Request, Response } from 'express';
import { WebSocketManager } from '../ws/WebSocketManager';
import { LatencySnapshot } from '../metrics/LatencyTracker';

interface HealthControllerOptions {
  getLatencySnapshot?: () => LatencySnapshot;
}

export class HealthController {
  private lastDataReceivedAt = 0;
  private dryRunActive = false;
  private readonly startTime = Date.now();

  constructor(private readonly wsManager: WebSocketManager, private readonly options: HealthControllerOptions = {}) {}

  setLastDataReceivedAt(timestampMs: number): void {
    if (Number.isFinite(timestampMs) && timestampMs > this.lastDataReceivedAt) {
      this.lastDataReceivedAt = timestampMs;
    }
  }

  setDryRunActive(active: boolean): void {
    this.dryRunActive = active;
  }

  liveness = (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'UP',
      timestamp: Date.now(),
      uptimeMs: Date.now() - this.startTime,
    });
  };

  readiness = (_req: Request, res: Response) => {
    const now = Date.now();
    const dataAgeMs = this.lastDataReceivedAt > 0 ? now - this.lastDataReceivedAt : Number.POSITIVE_INFINITY;
    const dataFresh = dataAgeMs < 10_000;
    const wsClients = this.wsManager.getClientCount();
    const ready = dataFresh;

    res.status(ready ? 200 : 503).json({
      status: ready ? 'UP' : 'DOWN',
      timestamp: now,
      details: {
        dataFresh,
        dataAgeMs,
        wsClients,
        dryRunActive: this.dryRunActive,
      },
    });
  };

  metrics = (_req: Request, res: Response) => {
    const now = Date.now();
    const uptimeSeconds = (now - this.startTime) / 1000;
    const dataStalenessSeconds = this.lastDataReceivedAt > 0 ? (now - this.lastDataReceivedAt) / 1000 : -1;
    const wsClients = this.wsManager.getClientCount();

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
}
