const fs = require('fs');
const path = require('path');

function loadLatestLog(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

const inputPath = process.argv[2];
const logsDir = path.join(process.cwd(), 'server', 'logs', 'dryrun');
const filePath = inputPath || loadLatestLog(logsDir);

if (!filePath || !fs.existsSync(filePath)) {
  console.error('dryrun_summary_no_log_file');
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8').trim();
const lines = raw ? raw.split('\n') : [];

let flipCount = 0;
let winSum = 0;
let winCount = 0;
let lossSum = 0;
let lossCount = 0;
let totalFee = 0;
let netPnl = 0;

for (const line of lines) {
  if (!line) continue;
  let evt;
  try {
    evt = JSON.parse(line);
  } catch {
    continue;
  }
  if (evt?.type === 'ACTION' && evt?.reason_code === 'FLIP_CONFIRMED') {
    flipCount += 1;
  }
  if (evt?.type === 'EXIT' && evt?.pnl) {
    const net = Number(evt.pnl.netUsdt || 0);
    const fee = Number(evt.pnl.feeUsdt || 0);
    netPnl += net;
    totalFee += fee;
    if (net > 0) {
      winSum += net;
      winCount += 1;
    } else if (net < 0) {
      lossSum += net;
      lossCount += 1;
    }
  }
}

const avgWin = winCount > 0 ? winSum / winCount : 0;
const avgLoss = lossCount > 0 ? lossSum / lossCount : 0;
const profitFactor = lossSum === 0 ? null : winSum / Math.abs(lossSum);

const summary = {
  flips_count: flipCount,
  avg_win: Number(avgWin.toFixed(8)),
  avg_loss: Number(avgLoss.toFixed(8)),
  profit_factor: profitFactor == null ? null : Number(profitFactor.toFixed(6)),
  total_fee: Number(totalFee.toFixed(8)),
  net_pnl: Number(netPnl.toFixed(8)),
  file: filePath,
};

console.log(JSON.stringify(summary, null, 2));
