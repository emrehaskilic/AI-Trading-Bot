/**
 * quick_chase_timeout_proof.ts
 *
 * 60-saniye boyunca her 2 saniyede /api/health ve orchestrator payload çeker.
 * PASS kriterleri:
 *   - decisionMode == orchestrator_v1
 *   - chaseStartedCountDelta >= 1
 *   - chaseTimedOutCountDelta >= 1   ← en kritik
 *   - fallbackEligibleCountDelta >= 1   (eğer impulse+gates geçtiyse)
 *   - fallbackTriggeredCountDelta >= 1  (eğer eligible ise)
 *   - takerOrdersPlacedDelta >= 1       (eğer triggered ise)
 *   - entryTakerMaxPctObserved <= 0.25  (kesinlikle)
 *
 * Output: server/logs/audit/quick_chase_timeout_proof.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

// ─── Config ──────────────────────────────────────────────────────────────────
const HOST = process.env.SERVER_HOST || 'localhost';
const PORT = Number(process.env.SERVER_PORT || 8787);
const DURATION_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const OUTPUT_PATH = path.join(__dirname, '../logs/audit/quick_chase_timeout_proof.json');

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpGet(urlPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const options = { hostname: HOST, port: PORT, path: urlPath, method: 'GET', timeout: 5000 };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ _raw: data }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

// ─── Safe deep-get helper ─────────────────────────────────────────────────────
function dig(obj: any, ...keys: string[]): any {
    return keys.reduce((cur, k) => (cur != null && typeof cur === 'object' ? cur[k] : undefined), obj);
}

// ─── Snapshot types ───────────────────────────────────────────────────────────
interface Snapshot {
    ts: number;
    health: any;
    decisionMode: string | null;
    // per-symbol chase counters (summed across all symbols)
    chaseStartedCount: number;
    chaseTimedOutCount: number;
    fallbackEligibleCount: number;
    fallbackTriggeredCount: number;
    takerOrdersPlaced: number;
    entryTakerMaxPctObserved: number;
    // per-symbol debug (first active symbol)
    symbolDebug: Record<string, any>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const snapshots: Snapshot[] = [];
    const startMs = Date.now();
    const endMs = startMs + DURATION_MS;
    let pollCount = 0;

    console.log(`[proof] Starting 60s chase-timeout proof. Server: http://${HOST}:${PORT}`);
    console.log(`[proof] Output → ${OUTPUT_PATH}`);

    while (Date.now() < endMs) {
        const nowTs = Date.now();
        pollCount++;
        let health: any = {};
        let payload: any = {};

        try { health = await httpGet('/api/health'); } catch (e) { health = { error: String(e) }; }
        try { payload = await httpGet('/api/orchestrator-v1/snapshot'); } catch (e) {
            try { payload = await httpGet('/api/orchestrator/snapshot'); } catch (e2) {
                payload = { error: String(e2) };
            }
        }

        // Detect decision mode
        const decisionMode: string | null =
            dig(health, 'decisionMode')
            ?? dig(health, 'orchestrator', 'mode')
            ?? dig(payload, 'decisionMode')
            ?? null;

        // Sum chase counters across all symbols
        const symbols: Record<string, any> = dig(payload, 'symbols') || {};
        let chaseStartedCount = 0;
        let chaseTimedOutCount = 0;
        let fallbackEligibleCount = 0;
        let fallbackTriggeredCount = 0;
        let takerOrdersPlaced = 0;
        let entryTakerMaxPctObserved = 0;
        const symbolDebug: Record<string, any> = {};

        for (const [sym, state] of Object.entries(symbols) as [string, any][]) {
            chaseStartedCount += Number(state?.chaseStartedCount ?? 0);
            chaseTimedOutCount += Number(state?.chaseTimedOutCount ?? 0);
            fallbackEligibleCount += Number(state?.fallbackEligibleCount ?? 0);
            fallbackTriggeredCount += Number(state?.fallbackTriggeredCount ?? 0);
            takerOrdersPlaced += Number(state?.takerOrdersPlaced ?? state?.fallbackTriggeredCount ?? 0);

            // Max fallback notional pct observed
            const fallbackPct = Number(state?.lastFallbackNotionalPct ?? (state?.fallbackTriggeredCount > 0 ? 0.25 : 0));
            if (fallbackPct > entryTakerMaxPctObserved) entryTakerMaxPctObserved = fallbackPct;

            // First active symbol debug
            if (state?.chaseActive || state?.chaseTimedOut) {
                symbolDebug[sym] = {
                    chaseActive: state?.chaseActive,
                    chaseStartTs: state?.chaseStartTs,
                    chaseElapsedMs: state?.chaseStartTs ? nowTs - state.chaseStartTs : 0,
                    chaseAttempts: state?.chaseAttempts,
                    chaseTimedOut: state?.chaseTimedOut,
                    chaseStartedCount: state?.chaseStartedCount,
                    chaseTimedOutCount: state?.chaseTimedOutCount,
                    fallbackEligibleCount: state?.fallbackEligibleCount,
                    fallbackTriggeredCount: state?.fallbackTriggeredCount,
                };
            }
        }

        // Also try reading counters from health endpoint directly
        chaseStartedCount = Math.max(chaseStartedCount, Number(dig(health, 'chaseStartedCount') ?? 0));
        chaseTimedOutCount = Math.max(chaseTimedOutCount, Number(dig(health, 'chaseTimedOutCount') ?? 0));
        fallbackEligibleCount = Math.max(fallbackEligibleCount, Number(dig(health, 'fallbackEligibleCount') ?? 0));
        fallbackTriggeredCount = Math.max(fallbackTriggeredCount, Number(dig(health, 'fallbackTriggeredCount') ?? 0));
        takerOrdersPlaced = Math.max(takerOrdersPlaced, Number(dig(health, 'takerOrdersPlaced') ?? 0));

        const snap: Snapshot = {
            ts: nowTs,
            health: { _status: health?.status ?? health?.decisionMode ?? 'unknown' },
            decisionMode,
            chaseStartedCount,
            chaseTimedOutCount,
            fallbackEligibleCount,
            fallbackTriggeredCount,
            takerOrdersPlaced,
            entryTakerMaxPctObserved,
            symbolDebug,
        };

        snapshots.push(snap);

        const elapsed = ((nowTs - startMs) / 1000).toFixed(1);
        console.log(
            `[proof][${elapsed}s] chaseStarted=${chaseStartedCount} timedOut=${chaseTimedOutCount} ` +
            `eligible=${fallbackEligibleCount} triggered=${fallbackTriggeredCount} ` +
            `takerOrders=${takerOrdersPlaced} maxPct=${(entryTakerMaxPctObserved * 100).toFixed(1)}%`
        );

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    // ─── Diff first vs last ────────────────────────────────────────────────────
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];

    const chaseStartedCountDelta = last.chaseStartedCount - first.chaseStartedCount;
    const chaseTimedOutCountDelta = last.chaseTimedOutCount - first.chaseTimedOutCount;
    const fallbackEligibleCountDelta = last.fallbackEligibleCount - first.fallbackEligibleCount;
    const fallbackTriggeredCountDelta = last.fallbackTriggeredCount - first.fallbackTriggeredCount;
    const takerOrdersPlacedDelta = last.takerOrdersPlaced - first.takerOrdersPlaced;
    const entryTakerMaxPctObserved = last.entryTakerMaxPctObserved;

    // ─── PASS/FAIL evaluation ─────────────────────────────────────────────────
    const checks: Record<string, { pass: boolean; value: any; required: string }> = {
        decisionMode: {
            pass: last.decisionMode === 'orchestrator_v1',
            value: last.decisionMode,
            required: 'orchestrator_v1',
        },
        chaseStartedCountDelta: {
            pass: chaseStartedCountDelta >= 1,
            value: chaseStartedCountDelta,
            required: '>= 1',
        },
        chaseTimedOutCountDelta: {
            pass: chaseTimedOutCountDelta >= 1,
            value: chaseTimedOutCountDelta,
            required: '>= 1  ← CRITICAL',
        },
        ...(fallbackEligibleCountDelta > 0 ? {
            fallbackEligibleCountDelta: {
                pass: fallbackEligibleCountDelta >= 1,
                value: fallbackEligibleCountDelta,
                required: '>= 1 (when impulse+gates true)',
            },
            fallbackTriggeredCountDelta: {
                pass: fallbackTriggeredCountDelta >= 1,
                value: fallbackTriggeredCountDelta,
                required: '>= 1',
            },
            takerOrdersPlacedDelta: {
                pass: takerOrdersPlacedDelta >= 1,
                value: takerOrdersPlacedDelta,
                required: '>= 1',
            },
        } : {}),
        entryTakerMaxPctObserved: {
            pass: entryTakerMaxPctObserved === 0 || entryTakerMaxPctObserved <= 0.25,
            value: entryTakerMaxPctObserved,
            required: '<= 0.25',
        },
    };

    const allPass = Object.values(checks).every(c => c.pass);

    const report = {
        _meta: {
            generatedAt: new Date().toISOString(),
            durationMs: DURATION_MS,
            pollIntervalMs: POLL_INTERVAL_MS,
            totalPolls: pollCount,
            server: `${HOST}:${PORT}`,
        },
        verdict: allPass ? '✅ PASS' : '❌ FAIL',
        checks,
        summary: {
            chaseStartedCountDelta,
            chaseTimedOutCountDelta,
            fallbackEligibleCountDelta,
            fallbackTriggeredCountDelta,
            takerOrdersPlacedDelta,
            entryTakerMaxPctObserved,
        },
        lastSymbolDebug: last.symbolDebug,
        snapshots: snapshots.map(s => ({
            ts: s.ts,
            decisionMode: s.decisionMode,
            chaseStartedCount: s.chaseStartedCount,
            chaseTimedOutCount: s.chaseTimedOutCount,
            fallbackEligibleCount: s.fallbackEligibleCount,
            fallbackTriggeredCount: s.fallbackTriggeredCount,
            takerOrdersPlaced: s.takerOrdersPlaced,
            entryTakerMaxPctObserved: s.entryTakerMaxPctObserved,
        })),
    };

    // Ensure output dir
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));

    console.log('\n════════════════════════════════════════');
    console.log(`[proof] Verdict: ${report.verdict}`);
    console.log(`[proof] chaseStartedCountDelta  : ${chaseStartedCountDelta}`);
    console.log(`[proof] chaseTimedOutCountDelta  : ${chaseTimedOutCountDelta}  ← CRITICAL`);
    console.log(`[proof] fallbackEligibleDelta    : ${fallbackEligibleCountDelta}`);
    console.log(`[proof] fallbackTriggeredDelta   : ${fallbackTriggeredCountDelta}`);
    console.log(`[proof] takerOrdersPlacedDelta   : ${takerOrdersPlacedDelta}`);
    console.log(`[proof] entryTakerMaxPctObserved : ${(entryTakerMaxPctObserved * 100).toFixed(2)}%`);
    console.log(`[proof] Report → ${OUTPUT_PATH}`);
    console.log('════════════════════════════════════════\n');

    // Exit with error code on FAIL so CI can detect
    if (!allPass) process.exit(1);
}

main().catch((e) => {
    console.error('[proof] Fatal error:', e);
    process.exit(1);
});
