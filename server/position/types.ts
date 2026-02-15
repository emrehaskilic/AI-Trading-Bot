import { ExecutionDecision, ExecutionResult } from '../execution/types';

export interface OpenTrade {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  entryPrice: string;
  timestamp: number;
  fees: string;
  feeAsset: string;
}

export interface IPositionManager {
  recordExecution(decision: ExecutionDecision, result: ExecutionResult): void;
  getPosition(symbol: string): number;
  getOpenTrades(symbol: string): OpenTrade[];
  closeTrade(orderId: string, closePrice: string, fees: string): void;
  getAccountBalance(): number;
  getInitialCapital(): number;
}
