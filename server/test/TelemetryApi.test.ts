import assert from 'node:assert/strict';
import { Router } from 'express';
import { createTelemetryRoutes } from '../api/telemetry';
import { MetricsCollector } from '../telemetry/MetricsCollector';
import { LatencyTracker } from '../metrics/LatencyTracker';

function callRoute(router: Router, path: string): { status: number; body: any } {
  const layer = (router as any).stack.find((item: any) => item?.route?.path === path);
  assert.ok(layer, `route not found: ${path}`);
  const handler = layer.route.stack[0].handle;

  let statusCode = 200;
  let payload: any;
  const req: any = { query: {} };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: any) {
      payload = body;
      return this;
    },
  };

  handler(req, res);
  return { status: statusCode, body: payload };
}

export function runTests(): void {
  const collector = new MetricsCollector();
  collector.registerHistogram('ws_latency_histogram', [1, 10, 100, 1000]);
  collector.registerHistogram('strategy_decision_confidence_histogram', [0.1, 0.25, 0.5, 0.75, 1]);

  collector.incrementCounter('trade_attempt_total', 10);
  collector.incrementCounter('trade_executed_total', 7);
  collector.incrementCounter('trade_rejected_total', 2);
  collector.incrementCounter('trade_failed_total', 1);

  collector.setGauge('risk_state_current', 1);
  collector.setGauge('position_count', 3);
  collector.setGauge('open_order_count', 4);

  collector.observeHistogram('ws_latency_histogram', 22);
  collector.observeHistogram('ws_latency_histogram', 40);
  collector.observeHistogram('strategy_decision_confidence_histogram', 0.45);
  collector.observeHistogram('strategy_decision_confidence_histogram', 0.8);

  const latencyTracker = new LatencyTracker();
  latencyTracker.record('ingest', 12);
  latencyTracker.record('ingest', 18);

  const router = createTelemetryRoutes({
    metricsCollector: collector,
    latencyTracker,
    getUptimeMs: () => 5_000,
    getActiveSymbols: () => ['BTCUSDT', 'ETHUSDT'],
  });

  const response = callRoute(router, '/snapshot');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.activeSymbols, ['BTCUSDT', 'ETHUSDT']);
  assert.equal(response.body.trade_metrics.attempts, 10);
  assert.equal(response.body.trade_metrics.executed, 7);
  assert.equal(response.body.trade_metrics.rejected, 2);
  assert.equal(response.body.trade_metrics.failed, 1);
  assert.ok(response.body.ws_latency_histogram.p95 > 0);
  assert.ok(response.body.strategy_decision_confidence_histogram.p50 > 0);
  assert.ok(response.body.latency_stages.ingest.samples >= 2);
}
