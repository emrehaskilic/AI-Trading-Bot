import { OrderType, TimeInForce } from '../connectors/executionTypes';

export interface ExecutionDecision {
  symbol: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  type?: OrderType;
  timeInForce?: TimeInForce;
  stopPrice?: string;
  reduceOnly?: boolean;
  clientOrderId?: string;
}

export interface ExecutionResult {
  ok: boolean;
  orderId?: string;
  error?: string;
  errorCode?: string;
  errorType?: 'TRANSIENT' | 'PERMANENT';
  executedQuantity?: string;
  executedPrice?: string;
  fee?: string;
  feeAsset?: string;
  feeTier?: 'MAKER' | 'TAKER';
  requestedPrice?: string;
  filledPrice?: string;
  requestTimestampMs?: number;
  responseTimestampMs?: number;
  latencyMs?: number;
}

export interface IExecutor {
  execute(decision: ExecutionDecision): Promise<ExecutionResult>;
}
