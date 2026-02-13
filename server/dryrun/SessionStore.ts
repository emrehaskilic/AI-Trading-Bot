import { promises as fs } from 'fs';
import path from 'path';

export interface StoredDryRunSession {
  sessionId: string;
  savedAt: number;
  payload: unknown;
}

export class SessionStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ? path.resolve(dir) : path.resolve(process.cwd(), 'server', 'sessions');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async save(sessionId: string, payload: unknown): Promise<void> {
    await this.ensureDir();
    const file = path.join(this.dir, `${sessionId}.json`);
    const data: StoredDryRunSession = {
      sessionId,
      savedAt: Date.now(),
      payload,
    };
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }

  async load(sessionId: string): Promise<StoredDryRunSession | null> {
    try {
      const file = path.join(this.dir, `${sessionId}.json`);
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as StoredDryRunSession;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async list(): Promise<string[]> {
    try {
      await this.ensureDir();
      const files = await fs.readdir(this.dir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }
}
