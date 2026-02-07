const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Correct path based on context
const LOG_DIR = path.resolve(__dirname, 'server/logs/orchestrator');
const REPORT_FILE = 'C:\\Users\\Administrator\\Desktop\\TeleCodex_Trade_Report.md';

const decisionMap = new Map(); // order_attempt_id -> { reason, type, symbol, side, ts }
const executions = [];

async function parseDecisions() {
    if (!fs.existsSync(LOG_DIR)) {
        console.error(`Log directory not found: ${LOG_DIR}`);
        return;
    }

    const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('decision')).sort();
    for (const file of files) {
        const stream = fs.createReadStream(path.join(LOG_DIR, file));
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                if (entry.actions && entry.actions.length > 0) {
                    const action = entry.actions[0];
                    if (action.type === 'NOOP') continue;

                    // Construct IDs to map back from execution logs
                    const decisionId = `${entry.symbol}_${action.event_time_ms}`;
                    const orderAttemptId = `${decisionId}_${action.type}`;

                    decisionMap.set(orderAttemptId, {
                        ts: new Date(action.event_time_ms).toISOString(),
                        symbol: entry.symbol,
                        type: action.type,
                        side: action.side,
                        quantity: action.quantity,
                        reason: action.reason || 'Unknown',
                        expectedPrice: action.expectedPrice
                    });
                }
            } catch (e) {
                // ignore incomplete lines
            }
        }
    }
}

async function parseExecutions() {
    if (!fs.existsSync(LOG_DIR)) return;

    const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('execution')).sort();
    for (const file of files) {
        const stream = fs.createReadStream(path.join(LOG_DIR, file));
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);

                // We look for successful order placements or trade updates
                // 1. order_result
                if (entry.type === 'order_result') {
                    const attemptId = entry.order_attempt_id;
                    const payload = entry.payload;

                    // Match with decision to get reason
                    const decision = decisionMap.get(attemptId);

                    if (payload.status === 'NEW' || payload.status === 'FILLED' || payload.status === 'PARTIALLY_FILLED') {
                        if (decision) {
                            executions.push({
                                time: new Date(entry.ts).toISOString(),
                                category: 'ORDER_PLACED',
                                symbol: decision.symbol,
                                side: decision.side,
                                actionType: decision.type,
                                qty: decision.quantity,
                                price: payload.response?.price || 'MARKET',
                                status: payload.status,
                                reason: decision.reason,
                                orderId: payload.orderId
                            });
                        }
                    } else if (payload.status === 'REJECTED' || (payload.code && payload.code < 0)) {
                        if (decision) {
                            executions.push({
                                time: new Date(entry.ts).toISOString(),
                                category: 'ORDER_REJECTED',
                                symbol: decision.symbol,
                                side: decision.side,
                                actionType: decision.type,
                                reason: decision.reason,
                                error: payload.response?.msg || payload.message,
                                code: payload.code
                            });
                        }
                    }
                } else if (entry.type === 'order_error') {
                    const attemptId = entry.order_attempt_id;
                    const payload = entry.payload;
                    const decision = decisionMap.get(attemptId);
                    if (decision) {
                        executions.push({
                            time: new Date(entry.ts).toISOString(),
                            category: 'ORDER_ERROR',
                            symbol: decision.symbol,
                            side: decision.side,
                            actionType: decision.type,
                            reason: decision.reason,
                            error: payload.message || payload.error,
                            code: payload.code
                        });
                    }
                }

                // 2. TRADE_UPDATE (actual fills)
                if (entry.type === 'TRADE_UPDATE') {
                    executions.push({
                        time: new Date(entry.event_time_ms).toISOString(),
                        category: 'TRADE_FILL',
                        symbol: entry.symbol,
                        side: entry.side,
                        price: entry.fillPrice,
                        qty: entry.fillQty,
                        realizedPnl: entry.realizedPnl,
                        commission: entry.commission,
                        reason: 'Binance Match Engine',
                        actionType: 'FILL'
                    });
                }

            } catch (e) {
                // ignore
            }
        }
    }
}

async function generateReport() {
    console.log('Parsing decisions...');
    await parseDecisions();
    console.log(`Loaded ${decisionMap.size} distinct action attempts.`);

    console.log('Parsing executions...');
    await parseExecutions();
    console.log(`Found ${executions.length} execution events.`);

    // Sort by time
    executions.sort((a, b) => new Date(a.time) - new Date(b.time));

    let report = `# Tele-Codex Trade Report\nGenerated at: ${new Date().toISOString()}\n\n`;

    if (executions.length === 0) {
        report += `**No trades or orders found in the logs.**\n\n`;
        report += `Check if Execution was enabled and if errors prevented orders.\n`;
    } else {
        report += `| Time | Category | Symbol | Side | Action | Reason | Details |\n`;
        report += `|---|---|---|---|---|---|---|\n`;

        for (const ex of executions) {
            if (ex.category === 'ORDER_PLACED') {
                report += `| ${ex.time} | 🟢 ORDER SENT | ${ex.symbol} | ${ex.side} | ${ex.actionType} | ${ex.reason} | Status: ${ex.status}, Qty: ${ex.qty} |\n`;
            } else if (ex.category === 'ORDER_REJECTED' || ex.category === 'ORDER_ERROR') {
                report += `| ${ex.time} | 🔴 REJECTED | ${ex.symbol} | ${ex.side} | ${ex.actionType} | ${ex.reason} | Error: ${ex.error} (Code: ${ex.code}) |\n`;
            } else if (ex.category === 'TRADE_FILL') {
                report += `| ${ex.time} | 💰 FILLED | ${ex.symbol} | ${ex.side} | FILL | - | Price: ${ex.price}, Qty: ${ex.qty}, Fee: ${ex.commission}, PnL: ${ex.realizedPnl} |\n`;
            }
        }
    }

    // Clean up dupes in summary (e.g. same reason multiple times)
    const reasons = {};
    let totalFills = 0;
    let totalRejects = 0;

    for (const ex of executions) {
        if (ex.category === 'ORDER_PLACED' || ex.category === 'ORDER_REJECTED' || ex.category === 'ORDER_ERROR') {
            if (ex.reason) {
                reasons[ex.reason] = (reasons[ex.reason] || 0) + 1;
            }
            if (ex.category !== 'ORDER_PLACED') totalRejects++;
        }
        if (ex.category === 'TRADE_FILL') totalFills++;
    }

    // Add Summary of reasons
    report += `\n\n## Strategy Performance Summary\n`;
    report += `- **Total Attempted Orders**: ${executions.filter(e => e.category !== 'TRADE_FILL').length}\n`;
    report += `- **Total Rejections/Errors**: ${totalRejects}\n`;
    report += `- **Total Trade Fills**: ${totalFills}\n\n`;

    if (Object.keys(reasons).length > 0) {
        report += `### Reason Frequency for Orders:\n`;
        for (const [reason, count] of Object.entries(reasons)) {
            report += `- **${reason}**: ${count}\n`;
        }
    }

    fs.writeFileSync(REPORT_FILE, report);
    console.log(`Report saved to ${REPORT_FILE}`);
}

generateReport();
