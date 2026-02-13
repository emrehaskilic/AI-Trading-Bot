import * as fs from 'fs/promises';
import * as path from 'path';

export type ArchiveEventType = 'trade' | 'orderbook' | 'funding';

export interface ArchiveEvent {
  type: ArchiveEventType;
  timestampMs: number;
  payload: any;
}

export interface ArchiveLoadOptions {
  fromMs?: number;
  toMs?: number;
  types?: ArchiveEventType[];
  limit?: number;
}

export class MarketDataArchive {
  private readonly baseDir: string;

  constructor(baseDir: string = path.join(process.cwd(), 'data', 'backfill')) {
    this.baseDir = baseDir;
  }

  async record(symbol: string, event: ArchiveEvent): Promise<void> {
    if (!symbol || !event || !Number.isFinite(event.timestampMs)) return;
    await this.ensureSymbolDir(symbol);
    const filePath = this.getFilePath(symbol, event.type);
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(filePath, line, 'utf8');
  }

  async recordTrade(symbol: string, trade: any, timestampMs: number): Promise<void> {
    return this.record(symbol, { type: 'trade', timestampMs, payload: trade });
  }

  async recordOrderbookSnapshot(symbol: string, snapshot: any, timestampMs: number): Promise<void> {
    return this.record(symbol, { type: 'orderbook', timestampMs, payload: snapshot });
  }

  async recordFunding(symbol: string, funding: any, timestampMs: number): Promise<void> {
    return this.record(symbol, { type: 'funding', timestampMs, payload: funding });
  }

  async listSymbols(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async loadEvents(symbol: string, opts: ArchiveLoadOptions = {}): Promise<ArchiveEvent[]> {
    const types: ArchiveEventType[] = opts.types && opts.types.length > 0
      ? opts.types
      : ['trade', 'orderbook', 'funding'];
    const events: ArchiveEvent[] = [];

    for (const type of types) {
      const filePath = this.getFilePath(symbol, type);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as ArchiveEvent;
            events.push(event);
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    const filtered = events
      .filter((e) => (opts.fromMs ? e.timestampMs >= opts.fromMs : true))
      .filter((e) => (opts.toMs ? e.timestampMs <= opts.toMs : true))
      .sort((a, b) => a.timestampMs - b.timestampMs);

    if (opts.limit && filtered.length > opts.limit) {
      return filtered.slice(-opts.limit);
    }

    return filtered;
  }

  private getFilePath(symbol: string, type: ArchiveEventType): string {
    return path.join(this.baseDir, symbol, `${type}.jsonl`);
  }

  private async ensureSymbolDir(symbol: string): Promise<void> {
    const dir = path.join(this.baseDir, symbol);
    await fs.mkdir(dir, { recursive: true });
  }
}
