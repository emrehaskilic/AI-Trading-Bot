const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LOG_DIR = path.resolve(__dirname, 'server/logs/orchestrator');
const REPORT_FILE = 'C:\\Users\\Administrator\\Desktop\\FORENSIC_TRADE_REPORT.md';

let balances = [];
let availableBalances = [];
let trades = [];
let failures = [];
let attempts = new Map(); // attemptId -> info
let orders = new Map(); // orderId -> attemptId
let decisions = new Map(); // decisionId -> info
let emergencyExits = [];
let metrics = new Map(); // decisionId -> metrics

async function processLine(line, fileType) {
    if (!line.trim()) return;
    try {
        const entry = JSON.parse(line);

        // DECISION LOGS
        if (fileType === 'decision') {
            const ts = entry.canonical_time_ms;
            if (entry.actions && entry.actions.length > 0) {
                const action = entry.actions[0];
                if (action.type !== 'NOOP') {
                    // Heuristic Decision ID: symbol_actionTime
                    const decisionId = `${entry.symbol}_${action.event_time_ms}`;
                    decisions.set(decisionId, {
                        ts,
                        symbol: entry.symbol,
                        reason: action.reason,
                        actionType: action.type
                    });

                    // Metrics Capture (Exit context)
                    if (action.type === 'EXIT_MARKET' || action.reason?.includes('stop') || action.reason?.includes('risk')) {
                        metrics.set(decisionId, {
                            latency: entry.gate?.network_latency_ms,
                            spread: entry.metrics?.spreadPct,
                            cvd: entry.metrics?.cvd?.tf1m?.cvd,
                            walletBefore: entry.stateSnapshot?.walletBalance,
                            slippage: entry.stateSnapshot?.execQuality?.recentSlippageBps
                        });
                    }

                    if (action.reason && (action.reason.includes('emergency') || action.reason.includes('stop') || action.reason.includes('risk'))) {
                        emergencyExits.push({
                            ts,
                            symbol: entry.symbol,
                            reason: action.reason,
                            side: action.side,
                            decisionId
                        });
                    }
                }
            }
            return;
        }

        // EXECUTION LOGS
        const ts = entry.ts || entry.event_time_ms || Date.now();

        // Balance Tracking (Wrapped Event)
        if (entry.state) {
            if (typeof entry.state.walletBalance === 'number') {
                balances.push({ ts, val: entry.state.walletBalance });
            }
            if (typeof entry.state.availableBalance === 'number') {
                availableBalances.push({ ts, val: entry.state.availableBalance });
            }
        }
        // Balance Tracking (Raw Event)
        if (entry.event && entry.event.type === 'ACCOUNT_UPDATE') {
            if (entry.event.walletBalance !== undefined) balances.push({ ts: entry.event_time_ms, val: entry.event.walletBalance });
            if (entry.event.availableBalance !== undefined) availableBalances.push({ ts: entry.event_time_ms, val: entry.event.availableBalance });
        }

        // Attempts (Direct or Debug)
        if (entry.type === 'order_attempt') {
            attempts.set(entry.order_attempt_id, {
                attemptId: entry.order_attempt_id,
                decisionId: entry.decision_id,
                symbol: entry.symbol,
                side: entry.payload?.params?.side,
                qty: entry.payload?.params?.quantity
            });
        }

        // Results (Direct or Debug)
        if (entry.type === 'order_result') {
            const p = entry.payload || {};
            const attId = entry.order_attempt_id;

            if (p.response && p.response.orderId) {
                orders.set(String(p.response.orderId), attId);
            }
            // Failure check
            if (p.status === 'REJECTED' || (p.code && p.code < 0) || (p.response && p.response.code < 0)) {
                failures.push({
                    ts,
                    symbol: entry.symbol,
                    code: p.code || p.response?.code,
                    msg: p.message || p.response?.msg,
                    internalReason: p.error_class || 'order_result_rejected',
                    attemptId: attId
                });
            }
        }

        // Request Errors
        if (entry.type === 'request_error' || entry.type === 'order_error') {
            const p = entry.payload || {};
            failures.push({
                ts,
                symbol: entry.symbol,
                code: p.code || p.response?.code,
                msg: p.message || p.response?.msg,
                internalReason: p.error_class || entry.type,
                attemptId: entry.order_attempt_id
            });
        }

        // Trades (Wrapped Event)
        if (entry.event && (entry.event.type === 'TRADE_UPDATE' || entry.event.type === 'ORDER_TRADE_UPDATE')) {
            const e = entry.event;
            // Infer entry/exit price logic
            // If realized pnl is significant, likely a close.
            let entryP = '-';
            let exitP = '-';

            if (Math.abs(e.realizedPnl) > 0.000001) {
                exitP = e.fillPrice;
            } else {
                entryP = e.fillPrice;
            }

            trades.push({
                ts: entry.event_time_ms,
                symbol: entry.symbol,
                side: e.side,
                posSide: 'BOTH',
                qty: e.fillQty,
                entryPrice: entryP,
                exitPrice: exitP,
                pnl: e.realizedPnl,
                fee: e.commission + ' ' + (e.commissionAsset || ''),
                orderId: String(e.orderId)
            });
        }

    } catch { }
}

async function analyze() {
    if (!fs.existsSync(LOG_DIR)) return;
    const files = fs.readdirSync(LOG_DIR).sort();

    // 1. Decisions
    for (const f of files.filter(n => n.startsWith('decision'))) {
        const stream = fs.createReadStream(path.join(LOG_DIR, f));
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) await processLine(line, 'decision');
    }

    // 2. Executions
    for (const f of files.filter(n => n.startsWith('execution'))) {
        const stream = fs.createReadStream(path.join(LOG_DIR, f));
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) await processLine(line, 'execution');
    }

    // Sort
    balances.sort((a, b) => a.ts - b.ts);
    availableBalances.sort((a, b) => a.ts - b.ts);
    trades.sort((a, b) => a.ts - b.ts);
    failures.sort((a, b) => a.ts - b.ts);
    emergencyExits.sort((a, b) => a.ts - b.ts);

    // Summary Params
    const startTs = balances[0]?.ts || (trades[0]?.ts) || Date.now();
    const endTs = balances[balances.length - 1]?.ts || Date.now();
    const startBal = balances.length ? balances[0].val : 0;
    const endBal = balances.length ? balances[balances.length - 1].val : 0;
    const minBal = balances.length ? Math.min(...balances.map(b => b.val)) : 0;
    const minAvail = availableBalances.length ? Math.min(...availableBalances.map(b => b.val)) : 0;

    // Report Construction
    let md = `## 1) ÖZET ZAMAN ÇİZELGESİ\n`;
    md += `- Başlangıç UTC zamanı: ${new Date(startTs).toISOString()}\n`;
    md += `- Bitiş UTC zamanı: ${new Date(endTs).toISOString()}\n`;
    md += `- Toplam çalışma süresi (dakika): ${((endTs - startTs) / 60000).toFixed(2)}\n`;
    md += `- Başlangıç bakiyesi (USDT): ${startBal}\n`;
    md += `- En düşük bakiye (USDT): ${minBal}\n`;
    md += `- En düşük Available Balance (USDT): ${minAvail}\n`;
    md += `- Kapanış bakiyesi (USDT): ${endBal}\n\n`;

    md += `## 2) TRADE LİSTESİ (KRONOLOJİK, TAM)\n`;
    md += `| timestamp_utc | symbol | side | position_side | qty | entry_price | exit_price | realized_pnl | fees | exit_reason | decision_id | order_attempt_id |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

    for (const t of trades) {
        const attId = orders.get(t.orderId);
        const decId = attId ? attempts.get(attId)?.decisionId : '-';
        const reason = decId !== '-' ? decisions.get(decId)?.reason : '-';
        md += `| ${new Date(t.ts).toISOString()} | ${t.symbol} | ${t.side} | ${t.posSide} | ${t.qty} | ${t.entryPrice} | ${t.exitPrice} | ${t.pnl} | ${t.fee} | ${reason} | ${decId} | ${attId || '-'} |\n`;
    }
    md += `\n`;

    md += `## 3) REDDEDİLEN / BAŞARISIZ EMİRLER\n`;
    md += `| timestamp | symbol | side | qty | binance_error_code | binance_error_msg | internal_reason | order_attempt_id |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    for (const f of failures) {
        const att = attempts.get(f.attemptId);
        const side = att ? att.side : '-';
        const qty = att ? att.qty : '-';
        md += `| ${new Date(f.ts).toISOString()} | ${f.symbol} | ${side} | ${qty} | ${f.code} | ${f.msg} | ${f.internalReason} | ${f.attemptId} |\n`;
    }
    md += `\n`;

    md += `## 4) EMERGENCY EXIT OLAYLARI\n`;
    md += `| timestamp | symbol | side | reason | unrealized_pnl | realized_pnl | latency_ms | slippage_bps |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    for (const e of emergencyExits) {
        const m = metrics.get(e.decisionId) || {};
        md += `| ${new Date(e.ts).toISOString()} | ${e.symbol} | ${e.side} | ${e.reason} | - | - | ${m.latency || '-'} | ${m.slippage || '-'} |\n`;
    }
    md += `\n`;

    md += `## 5) RİSK & EXECUTION KALİTESİ HAM METRİKLERİ\n`;
    md += `| timestamp | decision_id | latency_ms | slippage_bps | spread_pct | obiDeep | deltaZ | cvdSlope | wallet_balance |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;
    for (const [did, m] of metrics) {
        const dec = decisions.get(did);
        md += `| ${dec ? new Date(dec.ts).toISOString() : '-'} | ${did} | ${m.latency || '-'} | ${m.slippage || '-'} | ${m.spread || '-'} | - | - | ${m.cvd || '-'} | ${m.walletBefore || '-'} |\n`;
    }
    md += `\n`;

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((a, b) => a + b.pnl, 0);

    md += `## 6) TOPLAM SAYIM (MEKANİK)\n`;
    md += `- total_trades: ${trades.length}\n`;
    md += `- winning_trades_count: ${wins.length}\n`;
    md += `- losing_trades_count: ${losses.length}\n`;
    md += `- avg_win_usdt: ${(wins.length ? wins.reduce((a, b) => a + b.pnl, 0) / wins.length : 0).toFixed(4)}\n`;
    md += `- avg_loss_usdt: ${(losses.length ? losses.reduce((a, b) => a + b.pnl, 0) / losses.length : 0).toFixed(4)}\n`;
    md += `- total_pnl_usdt: ${totalPnl.toFixed(4)}\n`;
    md += `- max_drawdown_usdt: ${(Math.max(...balances.map(b => b.val)) - minBal).toFixed(4)}\n\n`;

    md += `## 7) HAM LOG REFERANSLARI\n`;
    files.forEach(f => md += `- ${f}\n`);

    fs.writeFileSync(REPORT_FILE, md);
    console.log('Report generated.');
}

analyze();
