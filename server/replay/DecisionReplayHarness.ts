import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { NewStrategyV11 } from '../strategy/NewStrategyV11';
import {
  StrategyAction,
  StrategyConfig,
  StrategyDecision,
  StrategyDecisionLog,
  StrategyInput,
} from '../types/strategy';

export interface DecisionReplayRecord extends StrategyDecisionLog {
  replayInput?: StrategyInput;
}

export interface DecisionReplayLoadOptions {
  symbol?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  requireReplayInput?: boolean;
}

export interface DecisionReplayMismatch {
  index: number;
  symbol: string;
  timestampMs: number;
  recorded: {
    regime: string;
    gatePassed: boolean;
    reasons: string[];
    actions: StrategyAction[];
  };
  replayed: {
    regime: string;
    gatePassed: boolean;
    reasons: string[];
    actions: StrategyAction[];
  };
}

export interface DecisionReplaySummary {
  filePath: string;
  totalRecords: number;
  replayedRecords: number;
  skippedRecords: number;
  matchedRecords: number;
  mismatchedRecords: number;
  symbols: string[];
  mismatchSamples: DecisionReplayMismatch[];
}

function actionsComparable(actions: StrategyAction[]): Array<Record<string, unknown>> {
  return actions.map((action) => ({
    type: action.type,
    side: action.side ?? null,
    reason: action.reason,
    sizeMultiplier: action.sizeMultiplier ?? null,
    reducePct: action.reducePct ?? null,
  }));
}

function normalizeReasons(reasons: string[]): string[] {
  return [...reasons];
}

function decisionMatches(record: DecisionReplayRecord, replayed: StrategyDecision): boolean {
  const sameRegime = record.regime === replayed.regime;
  const sameGate = record.gate.passed === replayed.gatePassed;
  const sameReasons = JSON.stringify(normalizeReasons(record.reasons)) === JSON.stringify(normalizeReasons(replayed.reasons));
  const sameActions = JSON.stringify(actionsComparable(record.actions)) === JSON.stringify(actionsComparable(replayed.actions));
  return sameRegime && sameGate && sameReasons && sameActions;
}

export async function loadDecisionReplayRecords(
  filePath: string,
  options: DecisionReplayLoadOptions = {},
): Promise<DecisionReplayRecord[]> {
  const resolvedPath = path.resolve(filePath);
  await fs.access(resolvedPath);

  const limit = options.limit && options.limit > 0 ? Math.trunc(options.limit) : Number.MAX_SAFE_INTEGER;
  const records: DecisionReplayRecord[] = [];

  const rl = readline.createInterface({
    input: createReadStream(resolvedPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: DecisionReplayRecord;
    try {
      parsed = JSON.parse(trimmed) as DecisionReplayRecord;
    } catch {
      continue;
    }
    if (options.symbol && parsed.symbol !== options.symbol) continue;
    if (options.fromMs && parsed.timestampMs < options.fromMs) continue;
    if (options.toMs && parsed.timestampMs > options.toMs) continue;
    if (options.requireReplayInput && !parsed.replayInput) continue;
    records.push(parsed);
    if (records.length >= limit) break;
  }

  return records;
}

export async function replayDecisionRecords(
  records: DecisionReplayRecord[],
  config?: Partial<StrategyConfig>,
): Promise<DecisionReplaySummary> {
  const strategyBySymbol = new Map<string, NewStrategyV11>();
  const mismatches: DecisionReplayMismatch[] = [];
  let replayedRecords = 0;
  let skippedRecords = 0;
  let matchedRecords = 0;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record.replayInput) {
      skippedRecords += 1;
      continue;
    }
    let strategy = strategyBySymbol.get(record.symbol);
    if (!strategy) {
      strategy = new NewStrategyV11(config);
      strategyBySymbol.set(record.symbol, strategy);
    }
    const replayed = strategy.evaluate(record.replayInput);
    replayedRecords += 1;
    if (decisionMatches(record, replayed)) {
      matchedRecords += 1;
      continue;
    }
    if (mismatches.length < 20) {
      mismatches.push({
        index: i,
        symbol: record.symbol,
        timestampMs: record.timestampMs,
        recorded: {
          regime: record.regime,
          gatePassed: record.gate.passed,
          reasons: normalizeReasons(record.reasons),
          actions: record.actions,
        },
        replayed: {
          regime: replayed.regime,
          gatePassed: replayed.gatePassed,
          reasons: normalizeReasons(replayed.reasons),
          actions: replayed.actions,
        },
      });
    }
  }

  return {
    filePath: '',
    totalRecords: records.length,
    replayedRecords,
    skippedRecords,
    matchedRecords,
    mismatchedRecords: replayedRecords - matchedRecords,
    symbols: [...new Set(records.map((record) => record.symbol))],
    mismatchSamples: mismatches,
  };
}

export async function replayDecisionLogFile(
  filePath: string,
  options: DecisionReplayLoadOptions = {},
  config?: Partial<StrategyConfig>,
): Promise<DecisionReplaySummary> {
  const resolvedPath = path.resolve(filePath);
  const records = await loadDecisionReplayRecords(resolvedPath, {
    ...options,
    requireReplayInput: options.requireReplayInput ?? true,
  });
  const summary = await replayDecisionRecords(records, config);
  summary.filePath = resolvedPath;
  return summary;
}
