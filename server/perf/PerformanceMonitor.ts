/**
 * Performance Monitor Module
 * 
 * Node.js perf_hooks based instrumentation with minimal overhead.
 * Provides latency histograms (p50/p95/p99), counters, and memory tracking.
 */

import { performance, PerformanceObserver, PerformanceEntry } from 'perf_hooks';
import { AsyncLocalStorage } from 'async_hooks';

// ============================================================================
// Types
// ============================================================================

export interface HistogramData {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  count: number;
  stdDev: number;
}

export interface CounterData {
  value: number;
  delta: number; // Since last reset
}

export interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

export interface PerformanceReport {
  timestamp: number;
  histograms: Record<string, HistogramData>;
  counters: Record<string, CounterData>;
  memory: {
    current: MemorySnapshot;
    delta: MemorySnapshot;
    peak: MemorySnapshot;
  };
  spans: Record<string, { active: number; total: number }>;
}

interface SpanContext {
  name: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Histogram Implementation (Custom for minimal overhead)
// ============================================================================

class LatencyHistogram {
  private values: number[] = [];
  private sorted: boolean = true;
  private _count: number = 0;
  private _sum: number = 0;
  private _sumSq: number = 0;
  private _min: number = Infinity;
  private _max: number = 0;

  // Configuration
  private maxSamples: number;
  private reservoirSampling: boolean;

  constructor(options: { maxSamples?: number; reservoirSampling?: boolean } = {}) {
    this.maxSamples = options.maxSamples ?? 10000;
    this.reservoirSampling = options.reservoirSampling ?? true;
  }

  record(value: number): void {
    // Fast path: skip if value is invalid
    if (value < 0 || !isFinite(value)) return;

    this._count++;
    this._sum += value;
    this._sumSq += value * value;
    this._min = Math.min(this._min, value);
    this._max = Math.max(this._max, value);

    if (this.reservoirSampling && this.values.length >= this.maxSamples) {
      // Reservoir sampling: replace random element with probability maxSamples/count
      const idx = Math.floor(Math.random() * this._count);
      if (idx < this.maxSamples) {
        this.values[idx] = value;
        this.sorted = false;
      }
    } else if (this.values.length < this.maxSamples) {
      this.values.push(value);
      this.sorted = false;
    }
  }

  private ensureSorted(): void {
    if (!this.sorted) {
      this.values.sort((a, b) => a - b);
      this.sorted = true;
    }
  }

  getPercentile(p: number): number {
    if (this.values.length === 0) return 0;
    this.ensureSorted();
    
    const idx = Math.ceil((p / 100) * this.values.length) - 1;
    return this.values[Math.max(0, idx)];
  }

  getData(): HistogramData {
    if (this.values.length === 0) {
      return {
        p50: 0, p95: 0, p99: 0,
        min: 0, max: 0, mean: 0,
        count: 0, stdDev: 0
      };
    }

    this.ensureSorted();
    
    const mean = this._sum / this._count;
    const variance = (this._sumSq / this._count) - (mean * mean);
    
    return {
      p50: this.getPercentile(50),
      p95: this.getPercentile(95),
      p99: this.getPercentile(99),
      min: this._min,
      max: this._max,
      mean: mean,
      count: this._count,
      stdDev: Math.sqrt(Math.max(0, variance))
    };
  }

  reset(): void {
    this.values = [];
    this.sorted = true;
    this._count = 0;
    this._sum = 0;
    this._sumSq = 0;
    this._min = Infinity;
    this._max = 0;
  }

  get count(): number {
    return this._count;
  }
}

// ============================================================================
// Performance Monitor
// ============================================================================

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  
  // Storage
  private histograms: Map<string, LatencyHistogram> = new Map();
  private counters: Map<string, { value: number; lastReset: number }> = new Map();
  private memorySnapshots: MemorySnapshot[] = [];
  private memoryPeak: MemorySnapshot = this.captureMemory();
  
  // Async context tracking
  private asyncStorage: AsyncLocalStorage<SpanContext> = new AsyncLocalStorage();
  private activeSpans: Map<string, number> = new Map();
  private totalSpans: Map<string, number> = new Map();
  
  // Configuration
  private enabled: boolean = true;
  private trackStackTraces: boolean = false;
  
  // PerformanceObserver for native Node.js metrics
  private perfObserver?: PerformanceObserver;

  private constructor() {
    this.setupPerformanceObserver();
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  // ========================================================================
  // Configuration
  // ========================================================================

  configure(options: {
    enabled?: boolean;
    trackStackTraces?: boolean;
  }): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.trackStackTraces !== undefined) this.trackStackTraces = options.trackStackTraces;
  }

  // ========================================================================
  // Span Tracking (Latency)
  // ========================================================================

  /**
   * Start a performance span for latency tracking
   * @param name - Span name (e.g., 'ws.broadcast', 'metrics.compute')
   * @param metadata - Optional metadata to attach to span
   * @returns Span ID for endSpan() call
   */
  startSpan(name: string, metadata?: Record<string, unknown>): string {
    if (!this.enabled) return '';

    const spanId = `${name}-${performance.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = performance.now();

    // Track in async context
    this.asyncStorage.enterWith({ name, startTime, metadata });

    // Track active spans
    this.activeSpans.set(name, (this.activeSpans.get(name) || 0) + 1);
    this.totalSpans.set(name, (this.totalSpans.get(name) || 0) + 1);

    // Mark with perf_hooks for native integration
    performance.mark(`${spanId}-start`);

    return spanId;
  }

  /**
   * End a performance span and record latency
   * @param spanId - Span ID from startSpan()
   * @param name - Span name (must match startSpan name)
   */
  endSpan(spanId: string, name: string): void {
    if (!this.enabled || !spanId) return;

    const endTime = performance.now();
    
    // Get start time from mark
    const startMark = performance.getEntriesByName(`${spanId}-start`, 'mark')[0];
    const startTime = startMark?.startTime || endTime;
    
    const duration = endTime - startTime;

    // Record in histogram
    this.recordLatency(name, duration);

    // Decrement active spans
    const current = this.activeSpans.get(name) || 0;
    if (current > 0) {
      this.activeSpans.set(name, current - 1);
    }

    // Clean up marks
    try {
      performance.clearMarks(`${spanId}-start`);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Execute a function within a performance span
   * Automatically tracks latency for sync or async functions
   */
  async withSpan<T>(
    name: string,
    fn: () => T | Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const spanId = this.startSpan(name, metadata);
    
    try {
      const result = await fn();
      return result;
    } finally {
      this.endSpan(spanId, name);
    }
  }

  /**
   * Synchronous version of withSpan
   */
  withSpanSync<T>(
    name: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const spanId = this.startSpan(name, metadata);
    
    try {
      return fn();
    } finally {
      this.endSpan(spanId, name);
    }
  }

  /**
   * Record latency directly (for external measurements)
   */
  recordLatency(name: string, durationMs: number): void {
    if (!this.enabled) return;

    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new LatencyHistogram({ maxSamples: 10000, reservoirSampling: true });
      this.histograms.set(name, histogram);
    }
    
    histogram.record(durationMs);
  }

  // ========================================================================
  // Counter Tracking (Frequency)
  // ========================================================================

  /**
   * Increment a counter
   * @param name - Counter name
   * @param value - Amount to increment (default: 1)
   */
  incrementCounter(name: string, value: number = 1): void {
    if (!this.enabled) return;

    const counter = this.counters.get(name);
    if (counter) {
      counter.value += value;
    } else {
      this.counters.set(name, { value, lastReset: Date.now() });
    }
  }

  /**
   * Decrement a counter
   */
  decrementCounter(name: string, value: number = 1): void {
    this.incrementCounter(name, -value);
  }

  /**
   * Set counter to specific value
   */
  setCounter(name: string, value: number): void {
    if (!this.enabled) return;

    const counter = this.counters.get(name);
    if (counter) {
      counter.value = value;
    } else {
      this.counters.set(name, { value, lastReset: Date.now() });
    }
  }

  /**
   * Get counter value
   */
  getCounter(name: string): number {
    return this.counters.get(name)?.value || 0;
  }

  // ========================================================================
  // Memory Tracking
  // ========================================================================

  /**
   * Capture current memory usage
   */
  captureMemory(): MemorySnapshot {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      arrayBuffers: (usage as any).arrayBuffers || 0,
      rss: usage.rss
    };
  }

  /**
   * Record memory snapshot
   */
  recordMemory(): MemorySnapshot {
    if (!this.enabled) return this.captureMemory();

    const snapshot = this.captureMemory();
    this.memorySnapshots.push(snapshot);

    // Update peaks
    this.memoryPeak = {
      heapUsed: Math.max(this.memoryPeak.heapUsed, snapshot.heapUsed),
      heapTotal: Math.max(this.memoryPeak.heapTotal, snapshot.heapTotal),
      external: Math.max(this.memoryPeak.external, snapshot.external),
      arrayBuffers: Math.max(this.memoryPeak.arrayBuffers, snapshot.arrayBuffers),
      rss: Math.max(this.memoryPeak.rss, snapshot.rss)
    };

    // Keep only last 100 snapshots to prevent memory bloat
    if (this.memorySnapshots.length > 100) {
      this.memorySnapshots = this.memorySnapshots.slice(-100);
    }

    return snapshot;
  }

  /**
   * Get memory delta from first snapshot
   */
  getMemoryDelta(): MemorySnapshot {
    if (this.memorySnapshots.length < 2) {
      return { heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0, rss: 0 };
    }

    const first = this.memorySnapshots[0];
    const current = this.captureMemory();

    return {
      heapUsed: current.heapUsed - first.heapUsed,
      heapTotal: current.heapTotal - first.heapTotal,
      external: current.external - first.external,
      arrayBuffers: current.arrayBuffers - first.arrayBuffers,
      rss: current.rss - first.rss
    };
  }

  // ========================================================================
  // Histogram Access
  // ========================================================================

  /**
   * Get histogram data for a specific metric
   */
  getHistogram(name: string): HistogramData | null {
    const histogram = this.histograms.get(name);
    return histogram ? histogram.getData() : null;
  }

  /**
   * Get all histograms
   */
  getAllHistograms(): Record<string, HistogramData> {
    const result: Record<string, HistogramData> = {};
    for (const [name, histogram] of this.histograms) {
      result[name] = histogram.getData();
    }
    return result;
  }

  // ========================================================================
  // Reporting
  // ========================================================================

  /**
   * Generate full performance report
   */
  getReport(): PerformanceReport {
    const counters: Record<string, CounterData> = {};
    for (const [name, data] of this.counters) {
      counters[name] = {
        value: data.value,
        delta: data.value // Since last reset
      };
    }

    const spans: Record<string, { active: number; total: number }> = {};
    for (const [name, total] of this.totalSpans) {
      spans[name] = {
        active: this.activeSpans.get(name) || 0,
        total
      };
    }

    return {
      timestamp: Date.now(),
      histograms: this.getAllHistograms(),
      counters,
      memory: {
        current: this.captureMemory(),
        delta: this.getMemoryDelta(),
        peak: this.memoryPeak
      },
      spans
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // Histograms
    for (const [name, data] of Object.entries(this.getAllHistograms())) {
      const metricName = `perf_latency_${name.replace(/\./g, '_')}_ms`;
      lines.push(`# HELP ${metricName} Latency histogram for ${name}`);
      lines.push(`# TYPE ${metricName} summary`);
      lines.push(`${metricName}{quantile="0.5"} ${data.p50.toFixed(3)} ${timestamp}`);
      lines.push(`${metricName}{quantile="0.95"} ${data.p95.toFixed(3)} ${timestamp}`);
      lines.push(`${metricName}{quantile="0.99"} ${data.p99.toFixed(3)} ${timestamp}`);
      lines.push(`${metricName}_count ${data.count} ${timestamp}`);
      lines.push(`${metricName}_sum ${(data.mean * data.count).toFixed(3)} ${timestamp}`);
    }

    // Counters
    for (const [name, data] of this.counters) {
      const metricName = `perf_counter_${name.replace(/\./g, '_')}`;
      lines.push(`# HELP ${metricName} Counter for ${name}`);
      lines.push(`# TYPE ${metricName} counter`);
      lines.push(`${metricName} ${data.value} ${timestamp}`);
    }

    // Memory
    const mem = this.captureMemory();
    lines.push('# HELP perf_memory_heap_used_bytes Heap memory used');
    lines.push('# TYPE perf_memory_heap_used_bytes gauge');
    lines.push(`perf_memory_heap_used_bytes ${mem.heapUsed} ${timestamp}`);

    lines.push('# HELP perf_memory_heap_total_bytes Heap memory total');
    lines.push('# TYPE perf_memory_heap_total_bytes gauge');
    lines.push(`perf_memory_heap_total_bytes ${mem.heapTotal} ${timestamp}`);

    lines.push('# HELP perf_memory_rss_bytes Resident set size');
    lines.push('# TYPE perf_memory_rss_bytes gauge');
    lines.push(`perf_memory_rss_bytes ${mem.rss} ${timestamp}`);

    return lines.join('\n');
  }

  /**
   * Export metrics in JSON format
   */
  exportJSON(): string {
    return JSON.stringify(this.getReport(), null, 2);
  }

  // ========================================================================
  // Reset
  // ========================================================================

  /**
   * Reset all metrics (for benchmark cycles)
   */
  reset(): void {
    // Reset histograms
    for (const histogram of this.histograms.values()) {
      histogram.reset();
    }

    // Reset counters (keep values but reset delta baseline)
    for (const counter of this.counters.values()) {
      counter.lastReset = Date.now();
    }

    // Reset memory tracking
    this.memorySnapshots = [this.captureMemory()];
    this.memoryPeak = this.captureMemory();

    // Reset span tracking
    this.activeSpans.clear();
    this.totalSpans.clear();

    // Clear performance entries
    performance.clearMarks();
    performance.clearMeasures();
  }

  /**
   * Full reset including all data
   */
  resetAll(): void {
    this.histograms.clear();
    this.counters.clear();
    this.memorySnapshots = [];
    this.memoryPeak = this.captureMemory();
    this.activeSpans.clear();
    this.totalSpans.clear();
    performance.clearMarks();
    performance.clearMeasures();
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private setupPerformanceObserver(): void {
    try {
      this.perfObserver = new PerformanceObserver((list) => {
        // Process any native performance entries if needed
        for (const entry of list.getEntries()) {
          // Can be used to track garbage collection, etc.
          if (entry.entryType === 'gc') {
            this.incrementCounter('gc.count');
          }
        }
      });

      // Observe GC if available
      try {
        this.perfObserver.observe({ entryTypes: ['gc'] as any });
      } catch {
        // GC observation not available in this Node version
      }
    } catch {
      // PerformanceObserver not available
    }
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

export const perf = PerformanceMonitor.getInstance();

// Quick access functions
export const startSpan = (name: string, metadata?: Record<string, unknown>): string => 
  perf.startSpan(name, metadata);

export const endSpan = (spanId: string, name: string): void => 
  perf.endSpan(spanId, name);

export const withSpan = <T>(name: string, fn: () => T | Promise<T>, metadata?: Record<string, unknown>): Promise<T> => 
  perf.withSpan(name, fn, metadata);

export const withSpanSync = <T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T => 
  perf.withSpanSync(name, fn, metadata);

export const incrementCounter = (name: string, value?: number): void => 
  perf.incrementCounter(name, value);

export const recordLatency = (name: string, durationMs: number): void => 
  perf.recordLatency(name, durationMs);

export const recordMemory = (): MemorySnapshot => 
  perf.recordMemory();

export const getHistogram = (name: string): HistogramData | null => 
  perf.getHistogram(name);

export const getReport = (): PerformanceReport => 
  perf.getReport();

export const resetMetrics = (): void => 
  perf.reset();

export default PerformanceMonitor;
