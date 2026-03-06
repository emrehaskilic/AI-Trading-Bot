const fs = require('fs');
const path = require('path');

function loadLatestLog(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.jsonl')).sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

function round(value, digits = 6) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function topEntries(map, limit) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => ({ key, count: value }));
}

const inputPath = process.argv[2];
const logsDir = path.join(process.cwd(), 'server', 'logs', 'dryrun');
const filePath = inputPath || loadLatestLog(logsDir);

if (!filePath || !fs.existsSync(filePath)) {
  console.error('dryrun_diagnostics_no_log_file');
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8').trim();
const lines = raw ? raw.split(/\r?\n/) : [];

const summary = {
  exits: 0,
  wins: 0,
  losses: 0,
  netPnl: 0,
  totalFee: 0,
  grossPnl: 0,
  durationMs: 0,
  exitReasons: new Map(),
};

const perSymbol = new Map();

function getSymbolBucket(symbol) {
  if (!perSymbol.has(symbol)) {
    perSymbol.set(symbol, {
      symbol,
      trades: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      totalFee: 0,
      grossPnl: 0,
      durationMs: 0,
      exitReasons: new Map(),
    });
  }
  return perSymbol.get(symbol);
}

for (const line of lines) {
  if (!line) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  if (event?.type !== 'EXIT') continue;

  const symbol = String(event.symbol || 'UNKNOWN');
  const reason = String(event.reason || 'UNKNOWN');
  const netUsdt = Number(event?.pnl?.netUsdt || 0);
  const feeUsdt = Number(event?.pnl?.feeUsdt || 0);
  const realizedUsdt = Number(event?.pnl?.realizedUsdt || 0);
  const durationMs = Number(event.durationMs || 0);

  summary.exits += 1;
  summary.netPnl += netUsdt;
  summary.totalFee += feeUsdt;
  summary.grossPnl += realizedUsdt;
  summary.durationMs += durationMs;
  summary.exitReasons.set(reason, (summary.exitReasons.get(reason) || 0) + 1);
  if (netUsdt > 0) summary.wins += 1;
  if (netUsdt < 0) summary.losses += 1;

  const bucket = getSymbolBucket(symbol);
  bucket.trades += 1;
  bucket.netPnl += netUsdt;
  bucket.totalFee += feeUsdt;
  bucket.grossPnl += realizedUsdt;
  bucket.durationMs += durationMs;
  bucket.exitReasons.set(reason, (bucket.exitReasons.get(reason) || 0) + 1);
  if (netUsdt > 0) bucket.wins += 1;
  if (netUsdt < 0) bucket.losses += 1;
}

let totalWinUsdt = 0;
let totalLossUsdt = 0;
for (const line of lines) {
  if (!line) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  if (event?.type !== 'EXIT') continue;
  const netUsdt = Number(event?.pnl?.netUsdt || 0);
  if (netUsdt > 0) totalWinUsdt += netUsdt;
  if (netUsdt < 0) totalLossUsdt += netUsdt;
}

const output = {
  file: filePath,
  summary: {
    exits: summary.exits,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.exits > 0 ? round(summary.wins / summary.exits, 4) : 0,
    netPnl: round(summary.netPnl, 8),
    grossPnl: round(summary.grossPnl, 8),
    totalFee: round(summary.totalFee, 8),
    feeToGrossLossRatio: summary.grossPnl !== 0 ? round(Math.abs(summary.totalFee / summary.grossPnl), 4) : null,
    profitFactor: totalLossUsdt === 0 ? null : round(totalWinUsdt / Math.abs(totalLossUsdt), 6),
    avgDurationMs: summary.exits > 0 ? Math.round(summary.durationMs / summary.exits) : 0,
    topExitReasons: topEntries(summary.exitReasons, 8),
  },
  symbols: Array.from(perSymbol.values())
    .sort((a, b) => a.netPnl - b.netPnl)
    .map((bucket) => ({
      symbol: bucket.symbol,
      trades: bucket.trades,
      wins: bucket.wins,
      losses: bucket.losses,
      winRate: bucket.trades > 0 ? round(bucket.wins / bucket.trades, 4) : 0,
      netPnl: round(bucket.netPnl, 8),
      grossPnl: round(bucket.grossPnl, 8),
      totalFee: round(bucket.totalFee, 8),
      avgDurationMs: bucket.trades > 0 ? Math.round(bucket.durationMs / bucket.trades) : 0,
      topExitReasons: topEntries(bucket.exitReasons, 5),
    })),
};

console.log(JSON.stringify(output, null, 2));
