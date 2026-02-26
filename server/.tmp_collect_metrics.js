const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const target = Number(process.env.TARGET || 10000);
const url = process.env.METRICS_WS_URL || 'ws://localhost:8787/ws?symbols=BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT';
const outDir = path.join(process.cwd(), 'logs', 'audit');
const outFile = path.join(outDir, `metrics_samples_${Date.now()}.jsonl`);
const progressFile = path.join(outDir, 'collect_progress.json');

fs.mkdirSync(outDir, { recursive: true });
const out = fs.createWriteStream(outFile, { flags: 'a' });

const state = {
  startedAt: Date.now(),
  target,
  collected: 0,
  url,
  outFile,
  done: false,
  error: null,
};

function writeProgress() {
  fs.writeFileSync(progressFile, JSON.stringify(state, null, 2));
}

writeProgress();

const ws = new WebSocket(url);

ws.on('open', () => {
  state.openedAt = Date.now();
  writeProgress();
  console.log(JSON.stringify({ event: 'collect_open', url, target, outFile }));
});

ws.on('message', (data) => {
  let obj;
  try {
    obj = JSON.parse(String(data));
  } catch {
    return;
  }
  if (!obj || obj.type !== 'metrics') return;

  out.write(JSON.stringify(obj) + '\n');
  state.collected += 1;
  state.lastTs = Date.now();

  if (state.collected % 250 === 0) {
    writeProgress();
    console.log(JSON.stringify({ event: 'collect_progress', collected: state.collected, target }));
  }

  if (state.collected >= target) {
    state.done = true;
    state.finishedAt = Date.now();
    writeProgress();
    out.end(() => {
      console.log(JSON.stringify({ event: 'collect_done', collected: state.collected, outFile }));
      ws.close();
      process.exit(0);
    });
  }
});

ws.on('error', (err) => {
  state.error = err && err.message ? err.message : String(err);
  state.done = true;
  state.finishedAt = Date.now();
  writeProgress();
  out.end(() => process.exit(1));
});

ws.on('close', (code, reason) => {
  if (!state.done) {
    state.error = `closed_before_completion:${code}:${String(reason || '')}`;
    state.done = true;
    state.finishedAt = Date.now();
    writeProgress();
    out.end(() => process.exit(1));
  }
});

setInterval(() => {
  writeProgress();
}, 1000).unref();
