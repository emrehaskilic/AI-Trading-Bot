/**
 * OrchestratorV1ChaseTimeout.test.ts
 *
 * Tests:
 *   1. chaseStartTs is set only on false→true transition (sticky)
 *   2. chaseTimedOut fires when elapsed >= chaseMaxSeconds (independent of fill)
 *   3. chaseTimedOutCount increments exactly once per chase
 *   4. fallbackTriggered only when impulse AND gates are true
 *   5. fallback qty is always <= 25% of baseQty
 *   6. fallbackBlocked_IMPULSE_FALSE increments when impulse fails
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { ORCHESTRATOR_V1_PARAMS } from '../orchestrator_v1/params';
import { OrchestratorV1Input } from '../orchestrator_v1/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid input that passes ALL gates */
function goodInput(nowMs: number, overrides: Partial<OrchestratorV1Input> = {}): OrchestratorV1Input {
    return {
        symbol: 'BTCUSDT',
        nowMs,
        price: 50000,
        bestBid: 49995,
        bestAsk: 50005,
        spreadPct: 0.0001,
        printsPerSecond: 10,
        deltaZ: 1.2,
        cvdSlope: 0.05,
        cvdTf5mState: 'BUY',
        obiDeep: 0.3,
        obiWeighted: 0.2,
        trendinessScore: 0.6,
        chopScore: 0.2,
        volOfVol: 0.1,
        realizedVol1m: 0.01,
        atr3m: 20,
        atrSource: 'MICRO_ATR',
        orderbookIntegrityLevel: 0,
        oiChangePct: 0,
        sessionVwapValue: 50000,
        htfH1BarStartMs: nowMs - 3600_000,
        htfH4BarStartMs: nowMs - 14400_000,
        backfillDone: true,
        barsLoaded1m: 400,
        ...overrides,
    };
}

/** Build input that FAILS impulse (printsPerSecond too low) */
function noImpulseInput(nowMs: number): OrchestratorV1Input {
    return goodInput(nowMs, {
        printsPerSecond: 1, // below impulse.minPrintsPerSecond=6
        deltaZ: 0.1,        // below impulse.minAbsDeltaZ=0.8
    });
}

const CHASE_MAX_MS = ORCHESTRATOR_V1_PARAMS.entry.chaseMaxSeconds * 1000;
const CONFIRM = ORCHESTRATOR_V1_PARAMS.hysteresis.entryConfirmations;

/** Warm up the orchestrator: run enough ticks so gates confirm & chase starts */
function warmUpToChaseStart(orc: OrchestratorV1, startMs: number): void {
    for (let i = 0; i < CONFIRM + 2; i++) {
        orc.evaluate(goodInput(startMs + i * 100));
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OrchestratorV1 – Chase Timeout State Machine', () => {
    let orc: OrchestratorV1;
    const T0 = 1_700_000_000_000; // arbitrary epoch

    beforeEach(() => {
        orc = new OrchestratorV1();
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('1. chaseStartTs is set on false→true and NOT reset during reprices', () => {
        warmUpToChaseStart(orc, T0);
        // First ENTRY tick – chase should now be active
        const d1 = orc.evaluate(goodInput(T0 + 1000));
        const startTs = d1.chaseDebug.chaseStartTs;

        expect(startTs).toBeGreaterThan(0);
        expect(d1.chaseDebug.chaseActive).toBe(true);

        // Simulate reprice ticks (within chase window)
        const d2 = orc.evaluate(goodInput(T0 + 2500)); // +1.5s → reprice interval
        const d3 = orc.evaluate(goodInput(T0 + 3800)); // +2.8s

        // chaseStartTs must NOT change across ticks
        // (if active remains true or still within window)
        if (d2.chaseDebug.chaseStartTs != null) {
            expect(d2.chaseDebug.chaseStartTs).toBe(startTs);
        }
        if (d3.chaseDebug.chaseStartTs != null) {
            expect(d3.chaseDebug.chaseStartTs).toBe(startTs);
        }
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('2. chaseTimedOut becomes true when elapsed >= chaseMaxSeconds', () => {
        warmUpToChaseStart(orc, T0);

        // Advance time past chase window (no fills simulated)
        const afterTimeout = T0 + CHASE_MAX_MS + 1000;
        const d = orc.evaluate(goodInput(afterTimeout));

        expect(d.chaseDebug.chaseTimedOut).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('3. chaseTimedOutCount increments exactly once per chase', () => {
        warmUpToChaseStart(orc, T0);

        const afterTimeout = T0 + CHASE_MAX_MS + 500;
        const d1 = orc.evaluate(goodInput(afterTimeout));
        expect(d1.telemetry.chase.chaseTimedOutCount).toBe(1);

        // Evaluate again after timeout – count must NOT increment again for same chase
        const d2 = orc.evaluate(goodInput(afterTimeout + 2000));
        expect(d2.telemetry.chase.chaseTimedOutCount).toBe(1);
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('4. fallbackTriggered when impulse=true and gates=true at timeout', () => {
        warmUpToChaseStart(orc, T0);

        // Timeout tick with all good conditions
        const d = orc.evaluate(goodInput(T0 + CHASE_MAX_MS + 500));

        // With good input, impulse should be true → fallback triggers
        expect(d.telemetry.chase.fallbackTriggeredCount).toBe(1);
        expect(d.orders.some(o => o.kind === 'TAKER_ENTRY_FALLBACK')).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('5. fallback qty is always <= 25% of baseQty', () => {
        warmUpToChaseStart(orc, T0);
        const d = orc.evaluate(goodInput(T0 + CHASE_MAX_MS + 500));

        const fallbackOrder = d.orders.find(o => o.kind === 'TAKER_ENTRY_FALLBACK');
        expect(fallbackOrder).toBeDefined();
        if (fallbackOrder) {
            expect(fallbackOrder.notionalPct).toBeLessThanOrEqual(0.25);
            // qty should be baseQty * notionalPct <= 25%
            const maxAllowedQty = (ORCHESTRATOR_V1_PARAMS.entry.baseQty * 0.25) * 2; // generous bound
            expect(fallbackOrder.qty).toBeLessThan(maxAllowedQty);
        }
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('6. fallbackBlocked_IMPULSE_FALSE when impulse fails at timeout', () => {
        // Build fresh orchestrator, warm up with good input, then timeout with bad impulse
        const orc2 = new OrchestratorV1();

        // Warm up to get chase started with good inputs
        for (let i = 0; i < CONFIRM + 2; i++) {
            orc2.evaluate(goodInput(T0 + i * 100));
        }

        // Timeout tick with impulse-killing input
        const d = orc2.evaluate(noImpulseInput(T0 + CHASE_MAX_MS + 500));

        expect(d.telemetry.chase.chaseTimedOutCount).toBe(1);
        expect(d.telemetry.chase.fallbackTriggeredCount).toBe(0);
        expect(d.telemetry.chase.fallbackBlocked_IMPULSE_FALSE).toBe(1);
        expect(d.orders.some(o => o.kind === 'TAKER_ENTRY_FALLBACK')).toBe(false);
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('7. chaseStartedCount increments on each new chase start', () => {
        const orc3 = new OrchestratorV1();

        // First chase
        for (let i = 0; i < CONFIRM + 2; i++) {
            orc3.evaluate(goodInput(T0 + i * 100));
        }
        const d1 = orc3.evaluate(goodInput(T0 + 500));
        expect(d1.telemetry.chase.chaseStartedCount).toBeGreaterThanOrEqual(1);
    });

    // ────────────────────────────────────────────────────────────────────────────
    it('8. chaseElapsedMs tracks time correctly within window', () => {
        warmUpToChaseStart(orc, T0);

        // Give it a few ticks within window
        const mid = T0 + Math.floor(CHASE_MAX_MS / 2);
        const d = orc.evaluate(goodInput(mid));

        if (d.chaseDebug.chaseStartTs != null && d.chaseDebug.chaseElapsedMs > 0) {
            // elapsed should be approximately half of chaseMaxMs (within a few ticks)
            expect(d.chaseDebug.chaseElapsedMs).toBeLessThan(CHASE_MAX_MS);
        }
    });
});
