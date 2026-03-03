/**
 * MetricsCollector - Production-grade metrics collection for trading bot
 * @module server/telemetry/MetricsCollector
 * 
 * Provides Counter, Gauge, and Histogram implementations with:
 * - Thread-safe operations (single-threaded Node.js with atomic updates)
 * - Deterministic calculations (no randomness)
 * - Minimal overhead
 * - Metric registration and naming conventions
 */

import {
  Counter,
  Gauge,
  Histogram,
  HistogramPercentiles,
  MetricLabels,
  HistogramConfig,
  MetricCollectionOptions,
  DefaultMetricCollectionOptions,
} from './types';

/**
 * Counter implementation - monotonically increasing values
 * Thread-safe for single-threaded Node.js using atomic operations
 */
export class CounterMetric implements Counter {
  public name: string;
  public value: number;
  public labels?: Record<string, string>;
  public description?: string;
  private createdAt: number;
  private lastUpdated: number;

  constructor(name: string, description?: string, labels?: Record<string, string>) {
    this.name = name;
    this.value = 0;
    this.description = description;
    this.labels = labels;
    this.createdAt = Date.now();
    this.lastUpdated = this.createdAt;
  }

  /**
   * Increment the counter by a specified amount (default: 1)
   * @param amount - Amount to increment (must be non-negative)
   * @returns The new counter value
   */
  increment(amount: number = 1): number {
    if (amount < 0) {
      throw new Error(`Counter ${this.name} cannot be decremented. Use Gauge for bidirectional metrics.`);
    }
    this.value += amount;
    this.lastUpdated = Date.now();
    return this.value;
  }

  /**
   * Get the current counter value
   * @returns Current value
   */
  get(): number {
    return this.value;
  }

  /**
   * Reset the counter to zero
   * @returns The previous value
   */
  reset(): number {
    const previous = this.value;
    this.value = 0;
    this.lastUpdated = Date.now();
    return previous;
  }

  /**
   * Get metadata about this counter
   */
  getMetadata(): { createdAt: number; lastUpdated: number } {
    return {
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
    };
  }
}

/**
 * Gauge implementation - values that can go up and down
 * Thread-safe for single-threaded Node.js
 */
export class GaugeMetric implements Gauge {
  public name: string;
  public value: number;
  public labels?: Record<string, string>;
  public description?: string;
  public min?: number;
  public max?: number;
  private createdAt: number;
  private lastUpdated: number;
  private observedMin: number;
  private observedMax: number;

  constructor(
    name: string,
    description?: string,
    initialValue: number = 0,
    labels?: Record<string, string>,
    min?: number,
    max?: number
  ) {
    this.name = name;
    this.value = initialValue;
    this.description = description;
    this.labels = labels;
    this.min = min;
    this.max = max;
    this.createdAt = Date.now();
    this.lastUpdated = this.createdAt;
    this.observedMin = initialValue;
    this.observedMax = initialValue;
  }

  /**
   * Set the gauge to a specific value
   * @param value - New value
   * @returns The new gauge value
   */
  set(value: number): number {
    if (this.min !== undefined && value < this.min) {
      throw new Error(`Gauge ${this.name} value ${value} below minimum ${this.min}`);
    }
    if (this.max !== undefined && value > this.max) {
      throw new Error(`Gauge ${this.name} value ${value} above maximum ${this.max}`);
    }
    this.value = value;
    this.lastUpdated = Date.now();
    
    // Track observed min/max
    if (value < this.observedMin) this.observedMin = value;
    if (value > this.observedMax) this.observedMax = value;
    
    return this.value;
  }

  /**
   * Get the current gauge value
   * @returns Current value
   */
  get(): number {
    return this.value;
  }

  /**
   * Increment the gauge by a specified amount (default: 1)
   * @param amount - Amount to increment (can be negative)
   * @returns The new gauge value
   */
  increment(amount: number = 1): number {
    return this.set(this.value + amount);
  }

  /**
   * Decrement the gauge by a specified amount (default: 1)
   * @param amount - Amount to decrement
   * @returns The new gauge value
   */
  decrement(amount: number = 1): number {
    return this.set(this.value - amount);
  }

  /**
   * Reset the gauge to initial value (0 by default)
   * @param initialValue - Value to reset to
   * @returns The previous value
   */
  reset(initialValue: number = 0): number {
    const previous = this.value;
    this.value = initialValue;
    this.observedMin = initialValue;
    this.observedMax = initialValue;
    this.lastUpdated = Date.now();
    return previous;
  }

  /**
   * Get observed min/max values
   */
  getObservedRange(): { min: number; max: number } {
    return {
      min: this.observedMin,
      max: this.observedMax,
    };
  }

  /**
   * Get metadata about this gauge
   */
  getMetadata(): { createdAt: number; lastUpdated: number } {
    return {
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
    };
  }
}

/**
 * Histogram implementation - distribution of values with percentile calculation
 * Uses linear interpolation for percentile calculation (deterministic)
 */
export class HistogramMetric implements Histogram {
  public name: string;
  public buckets: number[];
  public counts: number[];
  public sum: number;
  public count: number;
  public description?: string;
  private createdAt: number;
  private lastUpdated: number;
  private values: number[]; // Store values for accurate percentile calculation
  private maxStoredValues: number;

  constructor(
    name: string,
    buckets: number[],
    description?: string,
    maxStoredValues: number = 10000
  ) {
    this.name = name;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.counts = new Array(this.buckets.length).fill(0);
    this.sum = 0;
    this.count = 0;
    this.description = description;
    this.createdAt = Date.now();
    this.lastUpdated = this.createdAt;
    this.values = [];
    this.maxStoredValues = maxStoredValues;
  }

  /**
   * Observe a new value
   * @param value - Value to observe
   */
  observe(value: number): void {
    // Update bucket counts
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        this.counts[i]++;
      }
    }
    
    this.sum += value;
    this.count++;
    this.lastUpdated = Date.now();
    
    // Store value for percentile calculation
    this.values.push(value);
    
    // Trim values if exceeding max
    if (this.values.length > this.maxStoredValues) {
      this.values = this.values.slice(-this.maxStoredValues);
    }
  }

  /**
   * Calculate percentile using linear interpolation (deterministic)
   * @param percentile - Percentile to calculate (0-100)
   * @returns The calculated percentile value
   */
  getPercentile(percentile: number): number {
    if (this.count === 0) {
      return 0;
    }
    
    if (percentile <= 0) {
      return Math.min(...this.values);
    }
    if (percentile >= 100) {
      return Math.max(...this.values);
    }
    
    // Sort values for percentile calculation
    const sorted = [...this.values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    
    if (upper >= sorted.length) {
      return sorted[lower];
    }
    
    // Linear interpolation
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Get all percentiles (p50, p95, p99) plus count and sum
   * @returns HistogramPercentiles object
   */
  getPercentiles(): HistogramPercentiles {
    return {
      p50: this.getPercentile(50),
      p95: this.getPercentile(95),
      p99: this.getPercentile(99),
      count: this.count,
      sum: this.sum,
      min: this.count > 0 ? Math.min(...this.values) : 0,
      max: this.count > 0 ? Math.max(...this.values) : 0,
    };
  }

  /**
   * Get bucket distribution
   * @returns Array of {upperBound, count} objects
   */
  getBucketDistribution(): Array<{ upperBound: number; count: number; cumulative: number }> {
    let cumulative = 0;
    return this.buckets.map((bucket, i) => {
      cumulative += this.counts[i];
      return {
        upperBound: bucket,
        count: this.counts[i],
        cumulative,
      };
    });
  }

  /**
   * Reset the histogram
   */
  reset(): void {
    this.counts = new Array(this.buckets.length).fill(0);
    this.sum = 0;
    this.count = 0;
    this.values = [];
    this.lastUpdated = Date.now();
  }

  /**
   * Get metadata about this histogram
   */
  getMetadata(): { createdAt: number; lastUpdated: number } {
    return {
      createdAt: this.createdAt,
      lastUpdated: this.lastUpdated,
    };
  }
}

/**
 * MetricsCollector - Central registry for all metrics
 * Provides thread-safe operations for single-threaded Node.js
 */
export class MetricsCollector {
  private counters: Map<string, CounterMetric>;
  private gauges: Map<string, GaugeMetric>;
  private histograms: Map<string, HistogramMetric>;
  private options: MetricCollectionOptions;
  private startTime: number;

  constructor(options: Partial<MetricCollectionOptions> = {}) {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.options = { ...DefaultMetricCollectionOptions, ...options };
    this.startTime = Date.now();
  }

  /**
   * Register a new counter
   * @param name - Counter name
   * @param description - Optional description
   * @param labels - Optional labels
   * @returns The registered counter
   */
  registerCounter(name: string, description?: string, labels?: MetricLabels): CounterMetric {
    if (this.counters.has(name)) {
      throw new Error(`Counter ${name} already registered`);
    }
    const counter = new CounterMetric(name, description, labels);
    this.counters.set(name, counter);
    return counter;
  }

  /**
   * Get or create a counter
   * @param name - Counter name
   * @param description - Optional description
   * @returns The counter
   */
  counter(name: string, description?: string): CounterMetric {
    if (!this.counters.has(name)) {
      return this.registerCounter(name, description);
    }
    return this.counters.get(name)!;
  }

  /**
   * Increment a counter by name
   * @param name - Counter name
   * @param amount - Amount to increment
   * @returns The new counter value
   */
  incrementCounter(name: string, amount: number = 1): number {
    const counter = this.counter(name);
    return counter.increment(amount);
  }

  /**
   * Register a new gauge
   * @param name - Gauge name
   * @param description - Optional description
   * @param initialValue - Initial value (default: 0)
   * @param labels - Optional labels
   * @param min - Optional minimum value
   * @param max - Optional maximum value
   * @returns The registered gauge
   */
  registerGauge(
    name: string,
    description?: string,
    initialValue: number = 0,
    labels?: MetricLabels,
    min?: number,
    max?: number
  ): GaugeMetric {
    if (this.gauges.has(name)) {
      throw new Error(`Gauge ${name} already registered`);
    }
    const gauge = new GaugeMetric(name, description, initialValue, labels, min, max);
    this.gauges.set(name, gauge);
    return gauge;
  }

  /**
   * Get or create a gauge
   * @param name - Gauge name
   * @param description - Optional description
   * @returns The gauge
   */
  gauge(name: string, description?: string): GaugeMetric {
    if (!this.gauges.has(name)) {
      return this.registerGauge(name, description);
    }
    return this.gauges.get(name)!;
  }

  /**
   * Set a gauge value by name
   * @param name - Gauge name
   * @param value - New value
   * @returns The new gauge value
   */
  setGauge(name: string, value: number): number {
    const gauge = this.gauge(name);
    return gauge.set(value);
  }

  /**
   * Register a new histogram
   * @param name - Histogram name
   * @param buckets - Bucket boundaries
   * @param description - Optional description
   * @returns The registered histogram
   */
  registerHistogram(
    name: string,
    buckets: number[],
    description?: string
  ): HistogramMetric {
    if (this.histograms.has(name)) {
      throw new Error(`Histogram ${name} already registered`);
    }
    const histogram = new HistogramMetric(name, buckets, description);
    this.histograms.set(name, histogram);
    return histogram;
  }

  /**
   * Get or create a histogram
   * @param name - Histogram name
   * @param buckets - Bucket boundaries (required for new histograms)
   * @param description - Optional description
   * @returns The histogram
   */
  histogram(name: string, buckets?: number[], description?: string): HistogramMetric {
    if (!this.histograms.has(name)) {
      if (!buckets) {
        throw new Error(`Histogram ${name} does not exist and no buckets provided`);
      }
      return this.registerHistogram(name, buckets, description);
    }
    return this.histograms.get(name)!;
  }

  /**
   * Observe a value in a histogram by name
   * @param name - Histogram name
   * @param value - Value to observe
   */
  observeHistogram(name: string, value: number): void {
    const histogram = this.histograms.get(name);
    if (!histogram) {
      throw new Error(`Histogram ${name} not found`);
    }
    histogram.observe(value);
  }

  /**
   * Get all counters
   * @returns Map of counter names to CounterMetric
   */
  getCounters(): Map<string, CounterMetric> {
    return new Map(this.counters);
  }

  /**
   * Get all gauges
   * @returns Map of gauge names to GaugeMetric
   */
  getGauges(): Map<string, GaugeMetric> {
    return new Map(this.gauges);
  }

  /**
   * Get all histograms
   * @returns Map of histogram names to HistogramMetric
   */
  getHistograms(): Map<string, HistogramMetric> {
    return new Map(this.histograms);
  }

  /**
   * Get counter value by name
   * @param name - Counter name
   * @returns Counter value or undefined
   */
  getCounterValue(name: string): number | undefined {
    return this.counters.get(name)?.get();
  }

  /**
   * Get gauge value by name
   * @param name - Gauge name
   * @returns Gauge value or undefined
   */
  getGaugeValue(name: string): number | undefined {
    return this.gauges.get(name)?.get();
  }

  /**
   * Get histogram percentiles by name
   * @param name - Histogram name
   * @returns HistogramPercentiles or undefined
   */
  getHistogramPercentiles(name: string): HistogramPercentiles | undefined {
    return this.histograms.get(name)?.getPercentiles();
  }

  /**
   * Reset all metrics
   */
  resetAll(): void {
    this.counters.forEach(counter => counter.reset());
    this.gauges.forEach(gauge => gauge.reset());
    this.histograms.forEach(histogram => histogram.reset());
  }

  /**
   * Reset specific metric types
   * @param types - Types to reset ('counters', 'gauges', 'histograms')
   */
  reset(types: Array<'counters' | 'gauges' | 'histograms'>): void {
    if (types.includes('counters')) {
      this.counters.forEach(counter => counter.reset());
    }
    if (types.includes('gauges')) {
      this.gauges.forEach(gauge => gauge.reset());
    }
    if (types.includes('histograms')) {
      this.histograms.forEach(histogram => histogram.reset());
    }
  }

  /**
   * Get collector uptime
   * @returns Uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get all metric names
   * @returns Object with arrays of counter, gauge, and histogram names
   */
  getMetricNames(): { counters: string[]; gauges: string[]; histograms: string[] } {
    return {
      counters: Array.from(this.counters.keys()),
      gauges: Array.from(this.gauges.keys()),
      histograms: Array.from(this.histograms.keys()),
    };
  }

  /**
   * Check if a metric exists
   * @param name - Metric name
   * @param type - Metric type
   * @returns True if metric exists
   */
  hasMetric(name: string, type: 'counter' | 'gauge' | 'histogram'): boolean {
    switch (type) {
      case 'counter':
        return this.counters.has(name);
      case 'gauge':
        return this.gauges.has(name);
      case 'histogram':
        return this.histograms.has(name);
      default:
        return false;
    }
  }

  /**
   * Unregister a metric
   * @param name - Metric name
   * @param type - Metric type
   * @returns True if metric was removed
   */
  unregisterMetric(name: string, type: 'counter' | 'gauge' | 'histogram'): boolean {
    switch (type) {
      case 'counter':
        return this.counters.delete(name);
      case 'gauge':
        return this.gauges.delete(name);
      case 'histogram':
        return this.histograms.delete(name);
      default:
        return false;
    }
  }
}

/**
 * Default metrics collector instance
 */
export const defaultCollector = new MetricsCollector();
