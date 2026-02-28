#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'server', 'logs', 'audit');
const NOW = Date.now();
const WS_URL = process.env.METRIC_AUDIT_WS_URL || 'ws://localhost:8787/ws?symbols=BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT';
const TARGET = Math.max(120, Number(process.env.METRIC_AUDIT_SAMPLES || 600));
const TIMEOUT_MS = Math.max(5000, Number(process.env.METRIC_AUDIT_TIMEOUT_MS || 20000));
const BASE_QTY = Math.max(0.001, Number(process.env.MICRO_BASE_QTY || 10));

const RAW_FILE = path.join(OUT, `ws_metrics_samples_${NOW}.jsonl`);
const JSON_FILE = path.join(OUT, `metric_validation_report_${NOW}.json`);
const MD_FILE = path.join(OUT, `metric_validation_report_${NOW}.md`);

const UI_TOP = new Set([
  'type', 'symbol', 'state', 'snapshot', 'timeAndSales', 'cvd', 'absorption', 'openInterest', 'funding',
  'aiTrend', 'legacyMetrics', 'orderbookIntegrity', 'signalDisplay', 'advancedMetrics', 'liquidityMetrics',
  'passiveFlowMetrics', 'derivativesMetrics', 'toxicityMetrics', 'regimeMetrics', 'crossMarketMetrics',
  'enableCrossMarketConfirmation', 'bids', 'asks', 'midPrice', 'lastUpdateId',
]);

function getTop(p) { return String(p || '').split('.')[0] || ''; }
function aiMapped(p) {
  return p === 'symbol' || p === 'midPrice' || p === 'spreadPct' || p === 'absorption'
    || p.startsWith('timeAndSales.') || p.startsWith('legacyMetrics.') || p.startsWith('liquidityMetrics.')
    || p.startsWith('passiveFlowMetrics.') || p.startsWith('derivativesMetrics.')
    || p.startsWith('toxicityMetrics.') || p.startsWith('regimeMetrics.')
    || p.startsWith('crossMarketMetrics.') || p === 'enableCrossMarketConfirmation'
    || p.startsWith('openInterest.oiChangePct');
}
function formula(p) {
  if (p === 'spreadPct') return 'spreadPct=((bestAsk-bestBid)/midPrice)*100';
  if (p === 'midPrice') return 'midPrice=(bestBid+bestAsk)/2';
  if (p.startsWith('cvd.tf')) return 'cvd_tf=sum(signedQty), delta_tf=cvd_tf';
  if (p.startsWith('timeAndSales.')) return 'rolling trade tape aggregates';
  if (p.startsWith('legacyMetrics.')) return 'legacy depth+trade formulas (OBI,deltaZ,CVD slope,VWAP)';
  if (p.startsWith('liquidityMetrics.')) return 'advanced micro liquidity formulas incl slippage simulation';
  if (p.startsWith('passiveFlowMetrics.')) return 'passive flow add/cancel + spoof decay';
  if (p.startsWith('derivativesMetrics.')) return 'mark/index deviation + basis + liquidation proxy';
  if (p.startsWith('toxicityMetrics.')) return 'vpin + signed ratio + impact + burst persistence';
  if (p.startsWith('regimeMetrics.')) return 'realized vol + volOfVol + chop/trendiness';
  if (p.startsWith('crossMarketMetrics.')) return 'spot-perp divergence + beta regression + imbalance diff';
  if (p.startsWith('openInterest.')) return 'OI polling, 5m delta baseline';
  if (p.startsWith('funding.')) return 'funding polling + trend';
  if (p.startsWith('orderbookIntegrity.')) return 'sequence gap + crossed book + staleness';
  return 'direct payload/runtime field';
}
function source(p) {
  if (p.startsWith('openInterest.')) return 'REST polling https://fapi.binance.com/fapi/v1/openInterest';
  if (p.startsWith('funding.') || p.startsWith('derivativesMetrics.mark') || p.startsWith('derivativesMetrics.index') || p.startsWith('derivativesMetrics.perpBasis')) {
    return 'REST polling https://fapi.binance.com/fapi/v1/premiumIndex';
  }
  if (p.startsWith('crossMarketMetrics.')) return 'REST polling https://api.binance.com/api/v3/depth + stream fusion';
  return 'WS stream wss://fstream.binance.com/stream (@depth + @trade)';
}
function impossible(p, v) {
  if (!(typeof v === 'number' && Number.isFinite(v))) return false;
  if (p === 'spreadPct' && v < 0) return true;
  if (p.startsWith('liquidityMetrics.imbalanceCurve.') && (v < 0 || v > 1)) return true;
  if (p.endsWith('signedVolumeRatio') && (v < 0 || v > 1)) return true;
  if (p.endsWith('vpinApprox') && (v < 0 || v > 1)) return true;
  if (p.endsWith('chopScore') && (v < 0 || v > 1)) return true;
  if (p.endsWith('trendinessScore') && (v < 0 || v > 1)) return true;
  return false;
}

function flatten(v, p, out) {
  if (v === null || v === undefined) { if (p) out[p] = v; return; }
  if (Array.isArray(v)) {
    if (!p) return;
    out[`${p}.length`] = v.length;
    if (v.length > 0 && Array.isArray(v[0])) {
      out[`${p}.top0.price`] = Number(v[0][0]);
      out[`${p}.top0.qty`] = Number(v[0][1]);
    }
    return;
  }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) flatten(x, p ? `${p}.${k}` : k, out); return; }
  if (p) out[p] = v;
}

function simSlippage(levels, baseQty, ref, side) {
  if (!(ref > 0) || !(baseQty > 0) || !Array.isArray(levels) || levels.length === 0) return 0;
  let rem = baseQty; let qty = 0; let notional = 0;
  for (const lv of levels) {
    const px = Number(lv[0]); const q = Number(lv[1]); if (!(px > 0) || !(q > 0)) continue;
    if (rem <= 1e-12) break; const take = Math.min(rem, q); qty += take; notional += take * px; rem -= take;
  }
  if (rem > 1e-12) { const last = Number(levels[levels.length - 1][0]); const syn = side === 'buy' ? last * 1.0005 : last * 0.9995; qty += rem; notional += rem * syn; }
  if (!(qty > 0)) return 0; const avg = notional / qty;
  return side === 'buy' ? ((avg - ref) / ref) * 100 : ((ref - avg) / ref) * 100;
}

function getJson(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${url}`)));
    req.on('error', reject);
  });
}

async function collect() {
  return new Promise((resolve, reject) => {
    const samples = []; const ws = new WebSocket(WS_URL); let done = false;
    const t = setTimeout(() => finish('timeout'), TIMEOUT_MS);
    function finish(reason) { if (done) return; done = true; clearTimeout(t); try { ws.close(); } catch (_) {} resolve({ samples, reason }); }
    ws.on('message', (buf) => {
      try { const m = JSON.parse(String(buf)); if (!m || m.type !== 'metrics') return;
        samples.push(m); fs.appendFileSync(RAW_FILE, JSON.stringify(m) + '\n'); if (samples.length >= TARGET) finish('target'); } catch (_) {}
    });
    ws.on('error', (e) => { if (samples.length > 0) finish(`ws_error:${String(e.message || e)}`); else reject(e); });
    ws.on('close', () => finish('closed'));
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(RAW_FILE, '');
  const [health, status, ai] = await Promise.allSettled([
    getJson('http://localhost:8787/api/health'),
    getJson('http://localhost:8787/api/status'),
    getJson('http://localhost:8787/api/ai-dry-run/status'),
  ]);
  const H = health.status === 'fulfilled' ? health.value : { error: String(health.reason) };
  const S = status.status === 'fulfilled' ? status.value : { error: String(status.reason) };
  const A = ai.status === 'fulfilled' ? ai.value : { error: String(ai.reason) };
  fs.writeFileSync(path.join(OUT, `api_health_${NOW}.json`), JSON.stringify(H, null, 2));
  fs.writeFileSync(path.join(OUT, `api_status_${NOW}.json`), JSON.stringify(S, null, 2));
  fs.writeFileSync(path.join(OUT, `api_ai_status_${NOW}.json`), JSON.stringify(A, null, 2));

  const { samples, reason } = await collect();
  if (samples.length === 0) throw new Error('No ws samples');
  const total = samples.length;
  const map = new Map();
  const lag = [];
  const perSymbol = {};
  const levels = { OK: 0, DEGRADED: 0, CRITICAL: 0 };
  let maxGap = 0; let crossed = 0;
  const checks = { spread: { n: 0, bad: 0 }, mid: { n: 0, bad: 0 }, cvd: { n: 0, bad: 0 }, slip: { n: 0, bad: 0 }, legacy: { n: 0, bad: 0 }, basis: { n: 0, bad: 0 } };
  const betaVar = {};

  for (const m of samples) {
    perSymbol[m.symbol] = (perSymbol[m.symbol] || 0) + 1;
    if (Number(m.event_time_ms) > 0) lag.push(Date.now() - Number(m.event_time_ms));
    if (m.orderbookIntegrity) { levels[m.orderbookIntegrity.level] = (levels[m.orderbookIntegrity.level] || 0) + 1; maxGap = Math.max(maxGap, Number(m.orderbookIntegrity.sequenceGapCount || 0)); if (m.orderbookIntegrity.crossedBookDetected) crossed += 1; }
    const flat = {}; flatten(m, '', flat);
    for (const [p, v] of Object.entries(flat)) {
      if (!map.has(p)) map.set(p, { present: 0, nulls: 0, nums: 0, sum: 0, sumsq: 0, min: Infinity, max: -Infinity, out: 0, imp: 0, vals: [], samp: [] });
      const s = map.get(p); s.present += 1;
      if (v == null) s.nulls += 1;
      if (typeof v === 'number' && Number.isFinite(v)) { s.nums += 1; s.sum += v; s.sumsq += v * v; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); s.vals.push(v); if (impossible(p, v)) s.imp += 1; }
      if (s.samp.length < 3) s.samp.push(v);
    }
    const bid = Number(m.bestBid), ask = Number(m.bestAsk), mid = Number(m.midPrice), spr = Number(m.spreadPct);
    if (bid > 0 && ask > 0 && mid > 0 && Number.isFinite(spr)) { checks.spread.n++; if (Math.abs((((ask - bid) / mid) * 100) - spr) > 1e-7) checks.spread.bad++; checks.mid.n++; if (Math.abs(((bid + ask) / 2) - mid) > 1e-9) checks.mid.bad++; }
    for (const tf of ['tf1m', 'tf5m', 'tf15m']) { const c = Number(m?.cvd?.[tf]?.cvd), d = Number(m?.cvd?.[tf]?.delta); if (Number.isFinite(c) && Number.isFinite(d)) { checks.cvd.n++; if (Math.abs(c - d) > 1e-9) checks.cvd.bad++; } }
    const lb = Number(m?.legacyMetrics?.price); if (lb > 0 && mid > 0) { checks.legacy.n++; if (Math.abs(lb - mid) > 1e-8) checks.legacy.bad++; }
    if (m.liquidityMetrics && Array.isArray(m.asks) && Array.isArray(m.bids) && ask > 0 && bid > 0) { checks.slip.n += 2; if (Math.abs(simSlippage(m.asks, BASE_QTY, ask, 'buy') - Number(m.liquidityMetrics.expectedSlippageBuy)) > 1e-6) checks.slip.bad++; if (Math.abs(simSlippage(m.bids, BASE_QTY, bid, 'sell') - Number(m.liquidityMetrics.expectedSlippageSell)) > 1e-6) checks.slip.bad++; }
    const idxDev = Number(m?.derivativesMetrics?.indexLastDeviationPct), basis = Number(m?.derivativesMetrics?.perpBasis);
    if (Number.isFinite(idxDev) && Number.isFinite(basis)) { checks.basis.n++; if (Math.abs((-(idxDev / (100 + idxDev))) - basis) > 2e-4) checks.basis.bad++; }
    if (m.crossMarketMetrics) { const s = betaVar[m.symbol] || { btc: new Set(), eth: new Set(), n: 0 }; const b = Number(m.crossMarketMetrics.betaToBTC), e = Number(m.crossMarketMetrics.betaToETH); if (Number.isFinite(b)) s.btc.add(Number(b.toFixed(6))); if (Number.isFinite(e)) s.eth.add(Number(e.toFixed(6))); s.n++; betaVar[m.symbol] = s; }
  }

  const rows = [];
  for (const p of Array.from(map.keys()).sort()) {
    const s = map.get(p); const miss = total - s.present; const mean = s.nums > 0 ? s.sum / s.nums : null; const varr = s.nums > 0 ? Math.max(0, (s.sumsq / s.nums) - (mean * mean)) : null; const std = s.nums > 0 ? Math.sqrt(varr) : null;
    let out = 0; if (s.nums > 2 && std > 0) { for (const v of s.vals) if (Math.abs((v - mean) / std) >= 5) out++; }
    const nullRatio = total > 0 ? (miss + s.nulls) / total : 1;
    const sourceOk = s.present > 0 ? 'OK' : 'PROBLEM';
    let calc = 'OK';
    if (p === 'spreadPct' && checks.spread.bad > 0) calc = 'PROBLEM';
    if (p === 'midPrice' && checks.mid.bad > 0) calc = 'PROBLEM';
    if (p.startsWith('cvd.tf') && checks.cvd.bad > 0) calc = 'PROBLEM';
    if ((p === 'liquidityMetrics.expectedSlippageBuy' || p === 'liquidityMetrics.expectedSlippageSell') && checks.slip.bad > 0) calc = 'PROBLEM';
    if (p === 'derivativesMetrics.perpBasis' && checks.basis.bad > 0) calc = 'PROBLEM';
    if (s.imp > 0) calc = 'PROBLEM';
    const integ = (s.present === 0 || nullRatio > 0.6 || s.imp > 0) ? 'PROBLEM' : 'OK';
    const ui = UI_TOP.has(getTop(p)); const access = (!ui && s.present > 0) ? 'PROBLEM' : (s.present > 0 ? 'OK' : 'PROBLEM');
    rows.push({
      metric: p,
      status: { Source: sourceOk, Calculation: calc, Integrity: integ, Accessibility: access },
      notes: [(!ui && s.present > 0) ? 'payload_only_not_in_ui_type' : null, !aiMapped(p) ? 'not_mapped_to_ai_snapshot' : null].filter(Boolean),
      source: source(p), formula: formula(p),
      stats: { sampleCount: total, present: s.present, missing: miss, nullCount: s.nulls, min: s.nums > 0 ? s.min : null, max: s.nums > 0 ? s.max : null, mean, std, outlierRate: s.nums > 0 ? out / s.nums : null, impossibleCount: s.imp },
      sample: s.samp,
    });
  }

  const spoofCode = fs.readFileSync(path.join(ROOT, 'server', 'metrics', 'AdvancedMicrostructureMetrics.ts'), 'utf8');
  const spoofOk = spoofCode.includes('Math.exp(-(elapsed / this.spoofHalfLifeMs))');
  const crossStale = Object.entries(betaVar).filter(([, v]) => v.n > 20 && v.btc.size <= 1 && v.eth.size <= 1).map(([k]) => k);
  const mandatory = {
    legacyMetrics_vs_market_snapshot: { checked: checks.legacy.n, mismatch: checks.legacy.bad, status: checks.legacy.bad === 0 ? 'OK' : 'PROBLEM' },
    cvd_multi_tf_aggregation: { checked: checks.cvd.n, mismatch: checks.cvd.bad, status: checks.cvd.bad === 0 ? 'OK' : 'PROBLEM' },
    slippage_simulation_vs_book_depth: { checked: checks.slip.n, mismatch: checks.slip.bad, status: checks.slip.bad === 0 ? 'OK' : 'PROBLEM' },
    spoof_decay_half_life: { checked: 1, mismatch: spoofOk ? 0 : 1, status: spoofOk ? 'OK' : 'PROBLEM' },
    basis_mark_index_consistency: { checked: checks.basis.n, mismatch: checks.basis.bad, status: checks.basis.bad === 0 ? 'OK' : 'PROBLEM' },
    cross_market_beta_liveness: { checkedSymbols: Object.keys(betaVar).length, staleSymbols: crossStale, status: crossStale.length === 0 ? 'OK' : 'PROBLEM' },
    spread_formula: { checked: checks.spread.n, mismatch: checks.spread.bad, status: checks.spread.bad === 0 ? 'OK' : 'PROBLEM' },
  };

  const summary = {
    totalMetrics: rows.length,
    fullyValidated: rows.filter((r) => Object.values(r.status).every((x) => x === 'OK')).length,
    calculationProblems: rows.filter((r) => r.status.Calculation === 'PROBLEM').length,
    staleMetrics: rows.filter((r) => r.metric.endsWith('lastUpdated') && r.stats.max && (Date.now() - r.stats.max > 30000)).length,
    payloadOnlyNotInUiType: rows.filter((r) => r.notes.includes('payload_only_not_in_ui_type')).length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    collection: { wsUrl: WS_URL, target: TARGET, collected: total, reason, perSymbol, sampleFile: RAW_FILE },
    runtimeEvidence: {
      health: H, status: S, aiStatus: A,
      eventLagMs: { min: lag.length ? Math.min(...lag) : null, mean: lag.length ? lag.reduce((a, b) => a + b, 0) / lag.length : null, max: lag.length ? Math.max(...lag) : null },
      orderbookIntegrity: { levels, maxSequenceGap: maxGap, crossedBookCount: crossed },
    },
    mandatoryTests: mandatory,
    metrics: rows,
    summary,
  };
  fs.writeFileSync(JSON_FILE, JSON.stringify(report, null, 2));

  const bad = rows.filter((r) => Object.values(r.status).includes('PROBLEM')).slice(0, 40);
  const md = [
    '# Metric Validation Report (Quick)',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Samples: ${total}`,
    `- Stop: ${reason}`,
    '',
    '## Mandatory Tests',
    '| Test | Status | Checked | Mismatch |',
    '|---|---|---:|---:|',
    `| legacyMetrics vs market snapshot | ${mandatory.legacyMetrics_vs_market_snapshot.status} | ${mandatory.legacyMetrics_vs_market_snapshot.checked} | ${mandatory.legacyMetrics_vs_market_snapshot.mismatch} |`,
    `| CVD multi-TF aggregation | ${mandatory.cvd_multi_tf_aggregation.status} | ${mandatory.cvd_multi_tf_aggregation.checked} | ${mandatory.cvd_multi_tf_aggregation.mismatch} |`,
    `| slippage vs book depth | ${mandatory.slippage_simulation_vs_book_depth.status} | ${mandatory.slippage_simulation_vs_book_depth.checked} | ${mandatory.slippage_simulation_vs_book_depth.mismatch} |`,
    `| spoof decay half-life | ${mandatory.spoof_decay_half_life.status} | 1 | ${mandatory.spoof_decay_half_life.mismatch} |`,
    `| basis consistency | ${mandatory.basis_mark_index_consistency.status} | ${mandatory.basis_mark_index_consistency.checked} | ${mandatory.basis_mark_index_consistency.mismatch} |`,
    `| cross-market beta liveness | ${mandatory.cross_market_beta_liveness.status} | ${mandatory.cross_market_beta_liveness.checkedSymbols} | ${mandatory.cross_market_beta_liveness.staleSymbols.length} |`,
    `| spread formula | ${mandatory.spread_formula.status} | ${mandatory.spread_formula.checked} | ${mandatory.spread_formula.mismatch} |`,
    '',
    '## Summary',
    `- Total metrics: ${summary.totalMetrics}`,
    `- Fully validated: ${summary.fullyValidated}`,
    `- Calculation problems: ${summary.calculationProblems}`,
    `- Stale metrics: ${summary.staleMetrics}`,
    `- Payload only (not in UI type): ${summary.payloadOnlyNotInUiType}`,
    '',
    '## Problem Metrics (first 40)',
    '| Metric | Source | Calculation | Integrity | Accessibility | Notes |',
    '|---|---|---|---|---|---|',
    ...bad.map((r) => `| ${r.metric} | ${r.status.Source} | ${r.status.Calculation} | ${r.status.Integrity} | ${r.status.Accessibility} | ${r.notes.join('; ') || '-'} |`),
    '',
    `Raw samples: ${RAW_FILE}`,
    `JSON report: ${JSON_FILE}`,
    'Full per-metric formula/input/unit/window/sample details are in JSON.',
    '',
  ].join('\n');
  fs.writeFileSync(MD_FILE, md);

  console.log(JSON.stringify({ ok: true, json: JSON_FILE, md: MD_FILE, raw: RAW_FILE, summary, mandatory }, null, 2));
}

main().catch((e) => { console.error(String(e && e.stack ? e.stack : e)); process.exit(1); });

