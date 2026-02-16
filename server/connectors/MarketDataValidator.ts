import { AlertService } from '../notifications/AlertService';

export interface RawMarketData {
  symbol: string;
  price: number;
  quantity?: number;
  timestamp: number;
}

export interface ValidatedMarketData extends RawMarketData {
  quantity: number;
}

interface ValidatorOptions {
  maxFutureSkewMs?: number;
  maxPastSkewMs?: number;
  outlierWindow?: number;
  maxOutlierDeviationPct?: number;
}

/**
 * Validates and sanitizes market data before metrics/strategy pipelines consume it.
 */
export class MarketDataValidator {
  private readonly maxFutureSkewMs: number;
  private readonly maxPastSkewMs: number;
  private readonly outlierWindow: number;
  private readonly maxOutlierDeviationPct: number;
  private readonly priceWindows = new Map<string, number[]>();

  constructor(
    private readonly alertService?: AlertService,
    options: ValidatorOptions = {}
  ) {
    this.maxFutureSkewMs = Math.max(0, Math.trunc(options.maxFutureSkewMs ?? 60_000));
    this.maxPastSkewMs = Math.max(1_000, Math.trunc(options.maxPastSkewMs ?? (6 * 60 * 60 * 1000)));
    this.outlierWindow = Math.max(5, Math.trunc(options.outlierWindow ?? 20));
    this.maxOutlierDeviationPct = Math.max(0.1, Number(options.maxOutlierDeviationPct ?? 5));
  }

  validate(input: RawMarketData): ValidatedMarketData | null {
    const symbol = String(input?.symbol || '').toUpperCase();
    const price = Number(input?.price);
    const quantity = Number(input?.quantity ?? 0);
    const timestamp = Number(input?.timestamp);
    const now = Date.now();

    if (!symbol) {
      this.emitIssue('empty_symbol', input);
      return null;
    }
    if (!Number.isFinite(price) || price <= 0) {
      this.emitIssue('invalid_price', { symbol, price, raw: input });
      return null;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      this.emitIssue('invalid_quantity', { symbol, quantity, raw: input });
      return null;
    }
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      this.emitIssue('invalid_timestamp', { symbol, timestamp, raw: input });
      return null;
    }
    if (timestamp > now + this.maxFutureSkewMs) {
      this.emitIssue('future_timestamp', { symbol, timestamp, now });
      return null;
    }
    if (timestamp < now - this.maxPastSkewMs) {
      this.emitIssue('stale_timestamp', { symbol, timestamp, now });
      return null;
    }
    if (this.isOutlier(symbol, price)) {
      this.emitIssue('price_outlier', { symbol, price });
      return null;
    }

    this.pushPrice(symbol, price);
    return {
      symbol,
      price,
      quantity,
      timestamp,
    };
  }

  private pushPrice(symbol: string, price: number): void {
    const arr = this.priceWindows.get(symbol) || [];
    arr.push(price);
    if (arr.length > this.outlierWindow) {
      arr.shift();
    }
    this.priceWindows.set(symbol, arr);
  }

  private isOutlier(symbol: string, price: number): boolean {
    const arr = this.priceWindows.get(symbol) || [];
    if (arr.length < 5) return false;
    const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    if (!(mean > 0)) return false;
    const deviationPct = Math.abs((price - mean) / mean) * 100;
    return deviationPct > this.maxOutlierDeviationPct;
  }

  private emitIssue(reason: string, details: unknown): void {
    if (!this.alertService) return;
    void this.alertService.send(
      'DATA_QUALITY_ISSUE',
      `market_data_${reason}:${JSON.stringify(details).slice(0, 240)}`,
      'HIGH'
    );
  }
}
