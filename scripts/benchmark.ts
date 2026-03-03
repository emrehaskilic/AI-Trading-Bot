import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import perfModule from '../server/perf/PerformanceMonitor';

type HistogramData = {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  count: number;
  stdDev: number;
};

type MemorySnapshot = {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
};

const perf = (perfModule as any).perf
  ?? (perfModule as any).default?.perf
  ?? (perfModule as any).PerformanceMonitor?.getInstance?.();

if (!perf) {
  throw new Error('PerformanceMonitor module could not be initialized');
}

type Target = 'ws' | 'metrics' | 'log' | 'memory' | 'all';

type CliConfig = {
  target: Target;
  iterations: number;
  warmup: number;
  output?: string;
  quiet: boolean;
};

type BenchmarkResult = {
  target: Exclude<Target, 'all'>;
  iterations: number;
  durationMs: number;
  throughputOpsPerSec: number;
  latency: HistogramData;
  memoryBefore: MemorySnapshot;
  memoryAfter: MemorySnapshot;
  memoryDelta: MemorySnapshot;
};

class SymbolBroadcaster {
  private readonly subs = new Map<string, Set<() => void>>();

  subscribe(symbol: string, cb: () => void): void {
    const current = this.subs.get(symbol) ?? new Set<() => void>();
    current.add(cb);
    this.subs.set(symbol, current);
  }

  broadcast(symbol: string): number {
    const current = this.subs.get(symbol);
    if (!current) return 0;
    let count = 0;
    for (const cb of current) {
      cb();
      count += 1;
    }
    return count;
  }
}

class MetricsBuilder {
  private readonly values: number[] = [];

  ingest(v: number): void {
    this.values.push(v);
    if (this.values.length > 2048) {
      this.values.splice(0, this.values.length - 2048);
    }
  }

  envelope(): { min: number; max: number; avg: number } {
    if (this.values.length === 0) return { min: 0, max: 0, avg: 0 };
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const v of this.values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { min, max, avg: sum / this.values.length };
  }
}

function parseArgs(): CliConfig {
  const cfg: CliConfig = {
    target: 'all',
    iterations: 20_000,
    warmup: 2_000,
    quiet: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--target=')) {
      cfg.target = (arg.split('=')[1] as Target) || 'all';
    } else if (arg.startsWith('--iterations=')) {
      cfg.iterations = Math.max(1, Math.trunc(Number(arg.split('=')[1]) || cfg.iterations));
    } else if (arg.startsWith('--warmup=')) {
      cfg.warmup = Math.max(0, Math.trunc(Number(arg.split('=')[1]) || cfg.warmup));
    } else if (arg.startsWith('--output=')) {
      cfg.output = arg.split('=')[1];
    } else if (arg === '--quiet') {
      cfg.quiet = true;
    }
  }

  return cfg;
}

function formatMs(v: number): string {
  return `${v.toFixed(3)}ms`;
}

function formatBytes(v: number): string {
  const mb = v / (1024 * 1024);
  return `${mb.toFixed(3)}MB`;
}

function deltaMem(after: MemorySnapshot, before: MemorySnapshot): MemorySnapshot {
  return {
    heapUsed: after.heapUsed - before.heapUsed,
    heapTotal: after.heapTotal - before.heapTotal,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
    rss: after.rss - before.rss,
  };
}

async function runTarget(target: Exclude<Target, 'all'>, iterations: number): Promise<BenchmarkResult> {
  perf.resetAll();
  perf.recordMemory();
  const memBefore = perf.captureMemory();

  const broadcaster = new SymbolBroadcaster();
  const metrics = new MetricsBuilder();
  const logSink: string[] = [];
  const memorySink: number[][] = [];

  if (target === 'ws') {
    for (let i = 0; i < 100; i += 1) {
      broadcaster.subscribe('BTCUSDT', () => {});
    }
  }

  const spanName = `benchmark.${target}`;
  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const spanId = perf.startSpan(spanName);
    if (target === 'ws') {
      broadcaster.broadcast('BTCUSDT');
    } else if (target === 'metrics') {
      metrics.ingest(40_000 + (i % 1000));
      metrics.envelope();
    } else if (target === 'log') {
      logSink.push(JSON.stringify({ i, ts: Date.now(), px: 40_000 + (i % 10) }));
      if (logSink.length > 4096) logSink.splice(0, 1024);
    } else if (target === 'memory') {
      memorySink.push(new Array(64).fill(i));
      if (memorySink.length > 512) memorySink.splice(0, 128);
    }
    perf.endSpan(spanId, spanName);
    perf.incrementCounter(`benchmark.${target}.ops`);

    if ((i & 255) === 0) {
      perf.recordMemory();
    }
  }
  const endedAt = performance.now();
  perf.recordMemory();
  const memAfter = perf.captureMemory();
  const latency = perf.getHistogram(spanName) ?? {
    p50: 0,
    p95: 0,
    p99: 0,
    min: 0,
    max: 0,
    mean: 0,
    count: 0,
    stdDev: 0,
  };

  return {
    target,
    iterations,
    durationMs: endedAt - startedAt,
    throughputOpsPerSec: iterations / ((endedAt - startedAt) / 1000),
    latency,
    memoryBefore: memBefore,
    memoryAfter: memAfter,
    memoryDelta: deltaMem(memAfter, memBefore),
  };
}

async function runWithWarmup(target: Exclude<Target, 'all'>, iterations: number, warmup: number): Promise<BenchmarkResult> {
  if (warmup > 0) {
    await runTarget(target, warmup);
  }
  return runTarget(target, iterations);
}

function printResult(r: BenchmarkResult): void {
  console.log(`RESULT target=${r.target} p50_ms=${r.latency.p50.toFixed(3)} p95_ms=${r.latency.p95.toFixed(3)} p99_ms=${r.latency.p99.toFixed(3)} throughput_ops=${r.throughputOpsPerSec.toFixed(2)} heap_delta_mb=${(r.memoryDelta.heapUsed / (1024 * 1024)).toFixed(3)}`);
  console.log(`  latency: p50=${formatMs(r.latency.p50)} p95=${formatMs(r.latency.p95)} p99=${formatMs(r.latency.p99)} mean=${formatMs(r.latency.mean)}`);
  console.log(`  throughput: ${r.throughputOpsPerSec.toFixed(2)} ops/sec over ${r.iterations} iterations in ${formatMs(r.durationMs)}`);
  console.log(`  memory: heap_delta=${formatBytes(r.memoryDelta.heapUsed)} rss_delta=${formatBytes(r.memoryDelta.rss)}`);
}

async function main(): Promise<void> {
  const cfg = parseArgs();
  const targets: Array<Exclude<Target, 'all'>> = cfg.target === 'all'
    ? ['ws', 'metrics', 'log', 'memory']
    : [cfg.target as Exclude<Target, 'all'>];

  if (!cfg.quiet) {
    console.log(`Benchmark start target=${cfg.target} iterations=${cfg.iterations} warmup=${cfg.warmup}`);
  }

  const results: BenchmarkResult[] = [];
  for (const target of targets) {
    const result = await runWithWarmup(target, cfg.iterations, cfg.warmup);
    results.push(result);
    printResult(result);
  }

  if (cfg.output) {
    writeFileSync(cfg.output, JSON.stringify({ timestamp: Date.now(), config: cfg, results }, null, 2), 'utf8');
    if (!cfg.quiet) {
      console.log(`Results written: ${cfg.output}`);
    }
  }
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
