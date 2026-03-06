import * as path from 'path';
import { replayDecisionLogFile } from '../replay/DecisionReplayHarness';

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const file = readArg('--file') ?? path.join(process.cwd(), 'logs', 'decision_log.jsonl');
  const symbol = readArg('--symbol') ?? undefined;
  const fromMs = readArg('--from') ? Number(readArg('--from')) : undefined;
  const toMs = readArg('--to') ? Number(readArg('--to')) : undefined;
  const limit = readArg('--limit') ? Number(readArg('--limit')) : undefined;

  const summary = await replayDecisionLogFile(file, { symbol, fromMs, toMs, limit });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.mismatchedRecords > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
