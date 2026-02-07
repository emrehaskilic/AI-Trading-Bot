const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LOG_DIR = './server/logs/orchestrator';
const REPORT_FILE = 'C:\\Users\\Administrator\\Desktop\\TeleCodex_Trade_Report.md';

const decisionMap = new Map(); // order_attempt_id -> { reason, type, symbol, side, ts }
const executions = [];

async function parseDecisions() {
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
    const files = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('execution')).sort();
    for (const file of files) {
        const stream = fs.createReadStream(path.join(LOG_DIR, file));
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);

                // We look for successful order placements or trade updates
                // 1. order_result with status NEW or FILLED
                // 2. TRADE_UPDATE (actual fills)

                if (entry.type === 'order_result') {
                    const attemptId = entry.order_attempt_id;
                    const payload = entry.payload;

                    if (payload.status === 'NEW' || payload.status === 'FILLED' || payload.status === 'PARTIALLY_FILLED') {
                        const decision = decisionMap.get(attemptId);
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
                    } else if (payload.status === 'REJECTED' || payload.code < 0) {
                        const decision = decisionMap.get(attemptId);
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
                }

                // Also capturing raw trade updates which are the ultimate truth of execution
                if (entry.type === 'TRADE_UPDATE') {
                    executions.push({
                        time: new Date(entry.event_time_ms).toISOString(),
                        category: 'TRADE_FILL',
                        symbol: entry.symbol,
                        side: entry.side,
                        price: entry.fillPrice,
                        qty: entry.fillQty,
                        realizedPnl: entry.realizedPnl,
                        commission: entry.commission
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
        report += `**No trades or orders found in the logs.**\n`;
        report += `Check if Execution was enabled and if errors prevented orders.\n`;
    } else {
        report += `| Time | Category | Symbol | Side | Action | Reason | Details |\n`;
        report += `|---|---|---|---|---|---|---|\n`;

        for (const ex of executions) {
            if (ex.category === 'ORDER_PLACED') {
                report += `| ${ex.time} | 🟢 ORDER SENT | ${ex.symbol} | ${ex.side} | ${ex.actionType} | ${ex.reason} | Status: ${ex.status}, Qty: ${ex.qty} |\n`;
            } else if (ex.category === 'ORDER_REJECTED') {
                report += `| ${ex.time} | 🔴 REJECTED | ${ex.symbol} | ${ex.side} | ${ex.actionType} | ${ex.reason} | Error: ${ex.error} (Code: ${ex.code}) |\n`;
            } else if (ex.category === 'TRADE_FILL') {
                report += `| ${ex.time} | 💰 FILLED | ${ex.symbol} | ${ex.side} | - | - | Price: ${ex.price}, Qty: ${ex.qty}, Fee: ${ex.commission}, PnL: ${ex.realizedPnl} |\n`;
            }
        }
    }

    // Add Summary of reasons
    report += `\n\n## Strategy Logic Summary\n`;
    const reasons = {};
    for (const ex of executions) {
        if (ex.reason) {
            reasons[ex.reason] = (reasons[ex.reason] || 0) + 1;
        }
    }

    if (Object.keys(reasons).length > 0) {
        report += `Counts of reasons triggering orders (successful or attempted):\n`;
        for (const [reason, count] of Object.entries(reasons)) {
            report += `- **${reason}**: ${count}\n`;
        }
    } else {
        report += `No strategy triggers recorded in executed orders.\n`;
    }

    fs.writeFileSync(REPORT_FILE, report);
    console.log(`Report saved to ${REPORT_FILE}`);
}

generateReport();
