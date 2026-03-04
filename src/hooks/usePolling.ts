/**
 * Generic Polling Hook with Cleanup
 * Features: Pause/resume, error handling, cleanup on unmount, configurable interval
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface PollingOptions<T> {
  /** Polling interval in milliseconds */
  intervalMs?: number;
  /** Polling interval in milliseconds (alias for intervalMs for backward compatibility) */
  interval?: number;
  /** Whether polling is initially enabled */
  enabled?: boolean;
  /** Whether to retry on error */
  retryOnError?: boolean;
  /** Maximum number of retries before giving up */
  maxRetries?: number;
  /** Delay multiplier for retry backoff (exponential) */
  retryBackoffMultiplier?: number;
  /** Maximum delay between retries */
  maxRetryDelayMs?: number;
  /** Base retry delay in ms (for backward compatibility) */
  retryDelay?: number;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Callback when data is successfully fetched */
  onSuccess?: (data: T) => void;
  /** Callback when polling starts */
  onStart?: () => void;
  /** Callback when polling stops */
  onStop?: () => void;
  /** Whether to continue polling when the tab is hidden */
  pollWhenHidden?: boolean;
  /** Whether to reset the retry count on successful fetch */
  resetRetryOnSuccess?: boolean;
  /** Fetcher function (for backward compatibility with object-style options) */
  fetcher?: () => Promise<T>;
}

export interface PollingState<T> {
  /** The fetched data */
  data: T | null;
  /** Whether a fetch is in progress */
  isLoading: boolean;
  /** Error from the last fetch attempt */
  error: Error | null;
  /** Timestamp of the last successful update */
  lastUpdated: number | null;
  /** Current retry attempt count */
  retryCount: number;
  /** Whether polling is currently active */
  isPolling: boolean;
}

export interface PollingControls {
  /** Start or resume polling */
  start: () => void;
  /** Pause polling */
  pause: () => void;
  /** Stop polling and reset state */
  stop: () => void;
  /** Manually trigger a fetch */
  refetch: () => Promise<void>;
  /** Reset error and retry count */
  reset: () => void;
}

export type PollingResult<T> = PollingState<T> & PollingControls;

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if the document is visible (tab is active)
 */
function isDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  multiplier: number
): number {
  const exponentialDelay = baseDelay * Math.pow(multiplier, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  return Math.min(Math.round(exponentialDelay + jitter), maxDelay);
}

// =============================================================================
// usePolling Hook
// =============================================================================

/**
 * Generic polling hook for fetching data at regular intervals
 * 
 * @param fetchFn - Function that returns a promise with the data (optional if fetcher is in options)
 * @param options - Polling configuration options
 * @returns Polling state and controls
 * 
 * @example
 * ```typescript
 * // New style
 * const { data, isLoading, error, start, pause, refetch } = usePolling(
 *   () => fetchHealthStatus(),
 *   { intervalMs: 5000, enabled: true }
 * );
 * 
 * // Legacy style (backward compatible)
 * const { data, isLoading, error, refresh } = usePolling({
 *   fetcher: () => fetchHealthStatus(),
 *   interval: 5000,
 *   maxRetries: 3,
 *   retryDelay: 500,
 * });
 * ```
 */
export function usePolling<T>(
  fetchFnOrOptions: (() => Promise<T>) | PollingOptions<T>,
  optionsArg?: PollingOptions<T>
): PollingResult<T> & { refresh: () => Promise<void> } {
  // Determine which interface is being used
  const isLegacyStyle = typeof fetchFnOrOptions === 'object';
  
  const fetchFn = isLegacyStyle 
    ? (fetchFnOrOptions as PollingOptions<T>).fetcher! 
    : fetchFnOrOptions as () => Promise<T>;
  
  const options = isLegacyStyle 
    ? fetchFnOrOptions as PollingOptions<T> 
    : optionsArg!;

  if (!fetchFn) {
    throw new Error('usePolling: fetchFn or options.fetcher is required');
  }

  // Support both interval and intervalMs
  const intervalMs = options.intervalMs || options.interval || 5000;
  
  const {
    enabled = true,
    retryOnError = true,
    maxRetries = 3,
    retryBackoffMultiplier = 2,
    maxRetryDelayMs = options.retryDelay ? options.retryDelay * 5 : 30000,
    onError,
    onSuccess,
    onStart,
    onStop,
    // Keep polling active by default to avoid permanent "first load" stalls on
    // browsers/runtimes that report hidden visibility unexpectedly.
    pollWhenHidden = true,
    resetRetryOnSuccess = true,
  } = options;

  // State
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(enabled);

  // Refs for mutable values that shouldn't trigger re-renders
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const currentRetryCountRef = useRef<number>(0);

  // Update ref when state changes
  currentRetryCountRef.current = retryCount;

  /**
   * Clear all timers
   */
  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  /**
   * Cancel any in-flight requests
   */
  const cancelPendingRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  /**
   * Execute the fetch function
   */
  const executeFetch = useCallback(async (): Promise<void> => {
    // Don't fetch if component is unmounted
    if (!isMountedRef.current) return;

    // Don't fetch if tab is hidden and pollWhenHidden is false
    if (!pollWhenHidden && !isDocumentVisible()) return;

    // Cancel any pending request
    cancelPendingRequest();

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    setIsLoading(true);

    try {
      const result = await fetchFn();

      // Only update state if component is still mounted and request wasn't aborted
      if (isMountedRef.current && !abortControllerRef.current.signal.aborted) {
        setData(result);
        setError(null);
        setLastUpdated(Date.now());
        
        if (resetRetryOnSuccess) {
          setRetryCount(0);
          currentRetryCountRef.current = 0;
        }

        onSuccess?.(result);
      }
    } catch (err) {
      // Only update error state if component is still mounted and request wasn't aborted
      if (isMountedRef.current && !abortControllerRef.current.signal.aborted) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);

        // Handle retry logic
        if (retryOnError && currentRetryCountRef.current < maxRetries) {
          const newRetryCount = currentRetryCountRef.current + 1;
          setRetryCount(newRetryCount);
          currentRetryCountRef.current = newRetryCount;

          const backoffDelay = calculateBackoffDelay(
            newRetryCount,
            intervalMs,
            maxRetryDelayMs,
            retryBackoffMultiplier
          );

          retryTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current && isPolling) {
              executeFetch();
            }
          }, backoffDelay);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    fetchFn,
    pollWhenHidden,
    retryOnError,
    maxRetries,
    intervalMs,
    maxRetryDelayMs,
    retryBackoffMultiplier,
    resetRetryOnSuccess,
    onSuccess,
    onError,
    cancelPendingRequest,
    isPolling,
  ]);

  /**
   * Start polling
   */
  const start = useCallback(() => {
    if (!isMountedRef.current) return;
    
    setIsPolling(true);
    onStart?.();

    // Clear any existing timers
    clearTimers();

    // Execute immediately
    executeFetch();

    // Set up interval
    intervalRef.current = setInterval(() => {
      executeFetch();
    }, intervalMs);
  }, [executeFetch, intervalMs, clearTimers, onStart]);

  /**
   * Pause polling
   */
  const pause = useCallback(() => {
    setIsPolling(false);
    clearTimers();
    cancelPendingRequest();
  }, [clearTimers, cancelPendingRequest]);

  /**
   * Stop polling and reset state
   */
  const stop = useCallback(() => {
    setIsPolling(false);
    clearTimers();
    cancelPendingRequest();
    setData(null);
    setError(null);
    setLastUpdated(null);
    setRetryCount(0);
    currentRetryCountRef.current = 0;
    onStop?.();
  }, [clearTimers, cancelPendingRequest, onStop]);

  /**
   * Manually trigger a fetch
   */
  const refetch = useCallback(async (): Promise<void> => {
    // Reset retry count for manual refetch
    setRetryCount(0);
    currentRetryCountRef.current = 0;
    await executeFetch();
  }, [executeFetch]);

  /**
   * Reset error and retry count
   */
  const reset = useCallback(() => {
    setError(null);
    setRetryCount(0);
    currentRetryCountRef.current = 0;
  }, []);

  // Handle visibility change
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (isPolling) {
        if (isDocumentVisible()) {
          // Tab became visible - resume polling
          start();
        } else if (!pollWhenHidden) {
          // Tab hidden and pollWhenHidden is false - pause polling
          clearTimers();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isPolling, pollWhenHidden, start, clearTimers]);

  // Start/stop polling based on enabled state
  useEffect(() => {
    if (enabled) {
      start();
    } else {
      pause();
    }

    return () => {
      pause();
    };
  }, [enabled, start, pause]);

  // Cleanup on unmount
  useEffect(() => {
    // React.StrictMode re-mount cycle can leave this ref as false unless we
    // explicitly restore it on effect setup.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimers();
      cancelPendingRequest();
    };
  }, [clearTimers, cancelPendingRequest]);

  // Alias refresh for refetch (backward compatibility)
  const refresh = refetch;

  return {
    data,
    isLoading,
    error,
    lastUpdated,
    retryCount,
    isPolling,
    start,
    pause,
    stop,
    refetch,
    refresh,
    reset,
  };
}

// =============================================================================
// Specialized Polling Hooks
// =============================================================================

/**
 * Hook for polling health status
 */
export function useHealthPolling(
  fetchFn: () => Promise<{ status: string; version: string; timestamp: string }>,
  options?: Partial<PollingOptions<{ status: string; version: string; timestamp: string }>>
) {
  const intervalMs = Number(import.meta.env.VITE_POLLING_INTERVAL_HEALTH || 5000);
  
  return usePolling(fetchFn, {
    intervalMs,
    enabled: true,
    retryOnError: true,
    maxRetries: 5,
    pollWhenHidden: false,
    ...options,
  });
}

/**
 * Hook for polling metrics
 */
export function useMetricsPolling<T>(
  fetchFn: () => Promise<T>,
  options?: Partial<PollingOptions<T>>
) {
  const intervalMs = Number(import.meta.env.VITE_POLLING_INTERVAL_METRICS || 10000);
  
  return usePolling(fetchFn, {
    intervalMs,
    enabled: true,
    retryOnError: true,
    maxRetries: 3,
    pollWhenHidden: true, // Continue polling metrics in background
    ...options,
  });
}

/**
 * Hook for polling system status
 */
export function useStatusPolling<T>(
  fetchFn: () => Promise<T>,
  options?: Partial<PollingOptions<T>>
) {
  const intervalMs = Number(import.meta.env.VITE_POLLING_INTERVAL_STATUS || 30000);
  
  return usePolling(fetchFn, {
    intervalMs,
    enabled: true,
    retryOnError: true,
    maxRetries: 3,
    pollWhenHidden: false,
    ...options,
  });
}

// =============================================================================
// useInterval Hook (simpler alternative)
// =============================================================================

/**
 * Simple interval hook that executes a callback at regular intervals
 * Automatically pauses when tab is hidden
 */
export function useInterval(
  callback: () => void,
  delay: number | null,
  options?: {
    pauseWhenHidden?: boolean;
    runImmediately?: boolean;
  }
): { start: () => void; stop: () => void } {
  const { pauseWhenHidden = true, runImmediately = false } = options || {};
  const savedCallback = useRef<(() => void) | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const start = useCallback(() => {
    if (delay === null) return;
    
    if (runImmediately && savedCallback.current) {
      savedCallback.current();
    }

    intervalRef.current = setInterval(() => {
      if (savedCallback.current) {
        savedCallback.current();
      }
    }, delay);
  }, [delay, runImmediately]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Set up the interval
  useEffect(() => {
    if (delay !== null) {
      start();
    }

    return stop;
  }, [delay, start, stop]);

  // Handle visibility change
  useEffect(() => {
    if (!pauseWhenHidden || typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else if (delay !== null) {
        start();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [delay, pauseWhenHidden, start, stop]);

  return { start, stop };
}

// =============================================================================
// useTimeout Hook
// =============================================================================

/**
 * Hook for executing a callback after a delay
 */
export function useTimeout(
  callback: () => void,
  delay: number | null
): { clear: () => void; reset: () => void } {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clear();
    if (delay !== null) {
      timeoutRef.current = setTimeout(callback, delay);
    }
  }, [callback, delay, clear]);

  useEffect(() => {
    if (delay !== null) {
      timeoutRef.current = setTimeout(callback, delay);
    }

    return clear;
  }, [callback, delay, clear]);

  return { clear, reset };
}

export default usePolling;
