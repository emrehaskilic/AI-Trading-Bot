import { createHash } from 'crypto';

export class DeterministicIdGenerator {
  private orderCounter = 0;
  private tradeCounter = 0;
  private eventCounter = 0;

  constructor(private readonly runId: string) {
    if (!runId || !runId.trim()) {
      throw new Error('run_id_required');
    }
  }

  nextOrderId(input: {
    timestampMs: number;
    side: 'BUY' | 'SELL';
    qty: number;
    type: 'MARKET' | 'LIMIT';
    price?: number;
  }): string {
    this.orderCounter += 1;
    return `ord_${this.hash([
      this.runId,
      'order',
      this.orderCounter,
      input.timestampMs,
      input.side,
      input.qty,
      input.type,
      input.price ?? 0,
    ])}`;
  }

  nextTradeId(input: {
    entryTimestampMs: number;
    side: 'LONG' | 'SHORT';
    qty: number;
    closeTimestampMs: number;
  }): string {
    this.tradeCounter += 1;
    return `trd_${this.hash([
      this.runId,
      'trade',
      this.tradeCounter,
      input.entryTimestampMs,
      input.closeTimestampMs,
      input.side,
      input.qty,
    ])}`;
  }

  nextEventId(timestampMs: number): string {
    this.eventCounter += 1;
    return `evt_${this.hash([this.runId, 'event', this.eventCounter, timestampMs])}`;
  }

  private hash(parts: Array<string | number>): string {
    const payload = parts.join('|');
    return createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }
}
