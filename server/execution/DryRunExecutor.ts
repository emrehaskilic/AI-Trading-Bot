import { MarketImpactSimulator } from '../dryrun/MarketImpactSimulator';
import { decimalToNumber, parseDecimal } from '../utils/decimal';
import { ExecutionDecision, ExecutionResult, IExecutor } from './types';

type DryRunSubmit = (decision: ExecutionDecision) => Promise<ExecutionResult>;
type RetryClassifier = (result: ExecutionResult) => boolean;

export interface DryRunExecutorOptions {
  maxRetries?: number;
  baseRetryDelayMs?: number;
  classifyRetryable?: RetryClassifier;
  onLatency?: (latencyMs: number) => void;
}

const defaultRetryClassifier: RetryClassifier = (result) => {
  if (result.ok) return false;
  if (result.errorType === 'PERMANENT') return false;
  if (result.errorType === 'TRANSIENT') return true;
  const errorText = String(result.error || '').toLowerCase();
  return (
    errorText.includes('timeout')
    || errorText.includes('temporar')
    || errorText.includes('rate limit')
    || errorText.includes('429')
    || errorText.includes('network')
  );
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export class DryRunExecutor implements IExecutor {
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly classifyRetryable: RetryClassifier;

  constructor(
    private readonly submit: DryRunSubmit,
    private readonly marketImpactSimulator?: MarketImpactSimulator,
    private readonly options: DryRunExecutorOptions = {}
  ) {
    this.maxRetries = Math.max(0, Math.trunc(options.maxRetries ?? 2));
    this.baseRetryDelayMs = Math.max(50, Math.trunc(options.baseRetryDelayMs ?? 200));
    this.classifyRetryable = options.classifyRetryable || defaultRetryClassifier;
  }

  async execute(decision: ExecutionDecision): Promise<ExecutionResult> {
    const requestTimestampMs = Date.now();
    if (!this.marketImpactSimulator) {
      const result = await this.submitWithRetry(decision);
      const finalized = this.finalizeResult(result, decision, requestTimestampMs);
      if (Number.isFinite(finalized.latencyMs as number) && this.options.onLatency) {
        this.options.onLatency(Number(finalized.latencyMs));
      }
      return finalized;
    }
    const price = decision.price ? decimalToNumber(parseDecimal(decision.price)) : 0;
    const qty = decimalToNumber(parseDecimal(decision.quantity));
    const simulatedPrice = this.marketImpactSimulator.simulateImpact(decision.side, qty, price);
    const nextDecision: ExecutionDecision = {
      ...decision,
      price: Number.isFinite(simulatedPrice) ? simulatedPrice.toFixed(8) : decision.price,
    };
    const result = await this.submitWithRetry(nextDecision);
    const finalized = this.finalizeResult(result, nextDecision, requestTimestampMs, decision.price);
    if (Number.isFinite(finalized.latencyMs as number) && this.options.onLatency) {
      this.options.onLatency(Number(finalized.latencyMs));
    }
    return finalized;
  }

  private async submitWithRetry(decision: ExecutionDecision): Promise<ExecutionResult> {
    let lastResult: ExecutionResult | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.submit(decision);
        lastResult = result;
        if (result.ok) {
          return result;
        }
        const retryable = this.classifyRetryable(result);
        if (!retryable || attempt >= this.maxRetries) {
          return result;
        }
      } catch (error: any) {
        lastResult = {
          ok: false,
          error: error?.message || 'executor_submit_failed',
          errorType: 'TRANSIENT',
        };
        if (attempt >= this.maxRetries) {
          return lastResult;
        }
      }

      const delay = this.baseRetryDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
    return lastResult || {
      ok: false,
      error: 'executor_unknown_failure',
      errorType: 'PERMANENT',
    };
  }

  private finalizeResult(
    result: ExecutionResult,
    decision: ExecutionDecision,
    requestTimestampMs: number,
    explicitRequestedPrice?: string
  ): ExecutionResult {
    const responseTimestampMs = Date.now();
    const latencyMs = Math.max(0, responseTimestampMs - requestTimestampMs);
    if (result.ok) {
      return {
        ...result,
        requestedPrice: result.requestedPrice ?? explicitRequestedPrice ?? decision.price,
        filledPrice: result.filledPrice ?? result.executedPrice ?? decision.price,
        requestTimestampMs,
        responseTimestampMs,
        latencyMs,
      };
    }
    return {
      ...result,
      requestTimestampMs,
      responseTimestampMs,
      latencyMs,
      errorType: result.errorType || 'PERMANENT',
    };
  }
}
