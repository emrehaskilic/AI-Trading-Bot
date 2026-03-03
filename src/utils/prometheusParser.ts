/**
 * Prometheus text format parser
 * Parses Prometheus exposition format into structured metrics
 */

export interface PrometheusMetric {
  name: string;
  help?: string;
  type?: 'counter' | 'gauge' | 'histogram' | 'summary' | 'untyped';
  values: Array<{
    labels: Record<string, string>;
    value: number;
    timestamp?: number;
  }>;
}

export interface ParsedPrometheusMetrics {
  metrics: Map<string, PrometheusMetric>;
  getHistogramPercentile: (name: string, percentile: number) => number | null;
  getGauge: (name: string, labels?: Record<string, string>) => number | null;
  getCounter: (name: string, labels?: Record<string, string>) => number | null;
}

/**
 * Parse Prometheus text format into structured metrics
 */
export function parsePrometheusMetrics(text: string): ParsedPrometheusMetrics {
  const metrics = new Map<string, PrometheusMetric>();
  const lines = text.split('\n');
  
  let currentMetric: PrometheusMetric | null = null;
  let currentHelp = '';
  let currentType: PrometheusMetric['type'] = 'untyped';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments (except HELP and TYPE)
    if (!trimmed || trimmed.startsWith('#')) {
      if (trimmed.startsWith('# HELP ')) {
        const match = trimmed.match(/# HELP\s+(\S+)\s+(.+)/);
        if (match) {
          currentHelp = match[2];
          currentMetric = metrics.get(match[1]) || {
            name: match[1],
            values: [],
          };
          currentMetric.help = currentHelp;
          metrics.set(match[1], currentMetric);
        }
      } else if (trimmed.startsWith('# TYPE ')) {
        const match = trimmed.match(/# TYPE\s+(\S+)\s+(\S+)/);
        if (match) {
          currentType = match[2] as PrometheusMetric['type'];
          currentMetric = metrics.get(match[1]) || {
            name: match[1],
            values: [],
          };
          currentMetric.type = currentType;
          metrics.set(match[1], currentMetric);
        }
      }
      continue;
    }
    
    // Parse metric line
    // Format: metric_name{label1="value1",label2="value2"} value [timestamp]
    const metricMatch = trimmed.match(/^([^{\s]+)(?:\{([^}]*)\})?\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\s+(\d+))?$/);
    
    if (metricMatch) {
      const [, name, labelStr, valueStr, timestampStr] = metricMatch;
      const value = parseFloat(valueStr);
      const timestamp = timestampStr ? parseInt(timestampStr, 10) : undefined;
      
      // Parse labels
      const labels: Record<string, string> = {};
      if (labelStr) {
        const labelPairs = labelStr.match(/(\w+)="([^"]*)"/g);
        if (labelPairs) {
          for (const pair of labelPairs) {
            const [, key, val] = pair.match(/(\w+)="([^"]*)"/) || [];
            if (key) labels[key] = val;
          }
        }
      }
      
      currentMetric = metrics.get(name) || {
        name,
        help: currentHelp,
        type: currentType,
        values: [],
      };
      
      currentMetric.values.push({ labels, value, timestamp });
      metrics.set(name, currentMetric);
    }
  }
  
  return {
    metrics,
    getHistogramPercentile: (name: string, percentile: number): number | null => {
      const metric = metrics.get(name);
      if (!metric || metric.type !== 'histogram') return null;
      
      // Collect bucket values
      const buckets: Array<{ le: number; count: number }> = [];
      let totalCount = 0;
      
      for (const v of metric.values) {
        if (v.labels.le !== undefined) {
          const le = v.labels.le === '+Inf' ? Infinity : parseFloat(v.labels.le);
          buckets.push({ le, count: v.value });
        } else if (v.labels.__name__?.endsWith('_count')) {
          totalCount = v.value;
        }
      }
      
      if (buckets.length === 0) return null;
      
      buckets.sort((a, b) => a.le - b.le);
      
      const targetCount = totalCount * (percentile / 100);
      for (const bucket of buckets) {
        if (bucket.count >= targetCount) {
          return bucket.le;
        }
      }
      
      return buckets[buckets.length - 1]?.le ?? null;
    },
    getGauge: (name: string, labels?: Record<string, string>): number | null => {
      const metric = metrics.get(name);
      if (!metric) return null;
      
      if (labels) {
        const match = metric.values.find(v => 
          Object.entries(labels).every(([k, val]) => v.labels[k] === val)
        );
        return match?.value ?? null;
      }
      
      return metric.values[0]?.value ?? null;
    },
    getCounter: (name: string, labels?: Record<string, string>): number | null => {
      return metrics.get(name)?.values.find(v => 
        labels ? Object.entries(labels).every(([k, val]) => v.labels[k] === val) : true
      )?.value ?? null;
    },
  };
}

/**
 * Extract histogram percentiles (p50, p95, p99) for a given metric name
 */
export function extractHistogramPercentiles(
  parsed: ParsedPrometheusMetrics,
  baseName: string
): { p50: number | null; p95: number | null; p99: number | null } {
  return {
    p50: parsed.getHistogramPercentile(`${baseName}_bucket`, 50),
    p95: parsed.getHistogramPercentile(`${baseName}_bucket`, 95),
    p99: parsed.getHistogramPercentile(`${baseName}_bucket`, 99),
  };
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * Format number with specified precision
 */
export function formatNumber(value: number, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
