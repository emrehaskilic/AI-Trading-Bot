import { describe, it, expect } from 'vitest';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Input, OrchestratorV1DryRunPositionSnapshot } from '../orchestrator_v1/types';
import { ORCHESTRATOR_V1_PARAMS } from '../orchestrator_v1/params';

const NOW = 1_700_000_000_000;

function baseInput(symbol: string, overrides: Partial<OrchestratorV1Input> = {}): OrchestratorV1Input {
    return {
        symbol,
        nowMs: NOW,
        price: 100,
        bestBid: 99.99,
        bestAsk: 100.01,
        spreadPct: 0.0002,
        printsPerSecond: 20,
        deltaZ: 1.5,        // BUY signal
        cvdSlope: 0.05,
        cvdTf5mState: 'BUY',
        obiDeep: 0.3,
        obiWeighted: 0.25,
        trendinessScore: 0.6,
        chopScore: 0.3,
        volOfVol: 0.2,
        realizedVol1m: 0.01,
        atr3m: 0.5,
        atrSource: 'MICRO_ATR',
        orderbookIntegrityLevel: 0,
        oiChangePct: 0.01,
        sessionVwapValue: 100,
        htfH1BarStartMs: NOW - 1000,
        htfH4BarStartMs: NOW - 2000,
        backfillDone: true,
        barsLoaded1m: 400,
        ...overrides,
    };
}

function makeDrp(side: 'LONG' | 'SHORT' | null, qty: number): OrchestratorV1DryRunPositionSnapshot {
    return {
        hasPosition: qty > 0 && side != null,
        side,
        qty,
        entryPrice: 100,
        notional: qty * 100,
        addsUsed: 0,
    };
}

// Params with low thresholds for testability
function testParams() {
    return {
        ...ORCHESTRATOR_V1_PARAMS,
        hysteresis: {
            ...ORCHESTRATOR_V1_PARAMS.hysteresis,
            entryConfirmations: 2,
            minFlipIntervalMs: 1000, // 1 second for test speed
        },
    };
}

describe('2-Step Reversal State Machine', () => {

    describe('Step A: Opposite signal without persistence → HOLD', () => {
        it('does NOT emit ENTRY or EXIT_FLIP on first opposite tick', () => {
            const orch = new OrchestratorV1(testParams());

            // Tick 1: Position is LONG (from DryRun), micro is BUY → same side, no flip
            const drpLong = makeDrp('LONG', 5.0);
            const tick1 = baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: 1.5, cvdSlope: 0.05, obiDeep: 0.3, // BUY
                nowMs: NOW,
            });
            orch.evaluate(tick1);

            // Tick 2: micro flips to SELL (opposite of LONG→BUY position)
            const tick2 = baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5, // SELL
                nowMs: NOW + 100,
            });
            const d2 = orch.evaluate(tick2);

            // Should be HOLD — not enough persistence (only 1 tick, need 2)
            expect(d2.intent).not.toBe('ENTRY');
            expect(d2.intent).not.toBe('EXIT_FLIP');
            expect(d2.telemetry.reversal.flipPersistenceCount).toBe(1);
        });

        it('increments reversalBlocked counter when persistence not met', () => {
            const orch = new OrchestratorV1(testParams());
            const drpLong = makeDrp('LONG', 5.0);

            // First tick to establish side
            orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: 1.5, cvdSlope: 0.05, obiDeep: 0.3,
                nowMs: NOW,
            }));

            // Opposite tick — persistence NOT met (1 tick < 2 entryConfirmations)
            const d = orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                nowMs: NOW + 100, // < minFlipIntervalMs (1000ms)
            }));

            expect(d.telemetry.reversal.reversalBlocked).toBeGreaterThanOrEqual(1);
            expect(d.intent).toBe('HOLD');
        });
    });

    describe('Step A→EXIT_FLIP: Opposite signal persistent → EXIT_FLIP intent', () => {
        it('emits EXIT_FLIP after persistence conditions met (confirmations + interval)', () => {
            const params = testParams();
            params.hysteresis.entryConfirmations = 2;
            params.hysteresis.minFlipIntervalMs = 500;
            const orch = new OrchestratorV1(params);
            const drpLong = makeDrp('LONG', 5.0);

            // Tick 1: establish BUY side
            orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: 1.5, cvdSlope: 0.05, obiDeep: 0.3,
                nowMs: NOW,
            }));

            // Tick 2: first SELL flip (persistence=1, elapsed=200ms)
            orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                nowMs: NOW + 200,
            }));

            // Tick 3: second SELL flip (persistence=2, elapsed=700ms → both conditions met)
            const d3 = orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                nowMs: NOW + 700,
            }));

            expect(d3.intent).toBe('EXIT_FLIP');
            expect(d3.telemetry.reversal.reversalConvertedToExit).toBeGreaterThanOrEqual(1);
            expect(d3.telemetry.reversal.exitOnFlipCount).toBeGreaterThanOrEqual(1);
            expect(d3.telemetry.reversal.flipPersistenceCount).toBeGreaterThanOrEqual(2);
        });

        it('does NOT emit EXIT_FLIP if interval not met even with enough confirmations', () => {
            const params = testParams();
            params.hysteresis.entryConfirmations = 2;
            params.hysteresis.minFlipIntervalMs = 10_000; // 10 seconds
            const orch = new OrchestratorV1(params);
            const drpLong = makeDrp('LONG', 5.0);

            orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: 1.5, cvdSlope: 0.05, obiDeep: 0.3,
                nowMs: NOW,
            }));

            // 2 ticks rapidly (50ms apart) — confirmations=2 but interval < 10s
            orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                nowMs: NOW + 50,
            }));

            const d = orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                nowMs: NOW + 100,
            }));

            // Confirmations met (2) but interval NOT met (100ms < 10000ms)
            expect(d.intent).not.toBe('EXIT_FLIP');
            expect(d.intent).toBe('HOLD');
        });
    });

    describe('Step B: After FLAT → ENTRY in new direction allowed', () => {
        it('allows ENTRY after position becomes FLAT', () => {
            const params = testParams();
            params.hysteresis.entryConfirmations = 2;
            params.hysteresis.minFlipIntervalMs = 100;
            const orch = new OrchestratorV1(params);

            // Simulate: was LONG, flipped to SHORT, position is now FLAT
            const drpFlat = makeDrp(null, 0);

            // Multiple ticks with SHORT bias on flat position → should eventually ENTRY
            let lastDecision = orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpFlat,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5, // SELL side
                nowMs: NOW,
            }));

            for (let i = 1; i <= 20; i++) {
                lastDecision = orch.evaluate(baseInput('ETHUSDT', {
                    dryRunPosition: drpFlat,
                    deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                    nowMs: NOW + i * 500,
                }));
                if (lastDecision.intent === 'ENTRY') break;
            }

            // Should produce ENTRY (no position, no mismatch, gates pass)
            expect(lastDecision.intent).toBe('ENTRY');
            expect(lastDecision.side).toBe('SELL');
        });
    });

    describe('Reversal flow: LONG → EXIT_FLIP → FLAT → SHORT', () => {
        it('never produces direct LONG→SHORT entry', () => {
            const params = testParams();
            params.hysteresis.entryConfirmations = 2;
            params.hysteresis.minFlipIntervalMs = 200;
            const orch = new OrchestratorV1(params);
            const drpLong = makeDrp('LONG', 5.0);

            const allDecisions: { intent: string; side: string | null; tick: number }[] = [];

            // Phase 1: Position LONG, micro is BUY (no conflict)
            for (let i = 0; i < 3; i++) {
                const d = orch.evaluate(baseInput('ETHUSDT', {
                    dryRunPosition: drpLong,
                    deltaZ: 1.5, cvdSlope: 0.05, obiDeep: 0.3,
                    nowMs: NOW + i * 100,
                }));
                allDecisions.push({ intent: d.intent, side: d.side, tick: i });
            }

            // Phase 2: micro flips to SELL, position still LONG
            for (let i = 3; i < 10; i++) {
                const d = orch.evaluate(baseInput('ETHUSDT', {
                    dryRunPosition: drpLong,
                    deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                    nowMs: NOW + i * 100,
                }));
                allDecisions.push({ intent: d.intent, side: d.side, tick: i });
            }

            // No decision should have ENTRY with a side opposite to position
            const longEntries = allDecisions.filter(d =>
                d.intent === 'ENTRY' && d.side === 'SELL'
            );
            expect(longEntries).toHaveLength(0);

            // Should have at least one EXIT_FLIP
            const exitFlips = allDecisions.filter(d => d.intent === 'EXIT_FLIP');
            expect(exitFlips.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Telemetry', () => {
        it('exposes all reversal telemetry fields', () => {
            const orch = new OrchestratorV1(testParams());
            const drpLong = makeDrp('LONG', 5.0);

            const d = orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                nowMs: NOW,
            }));

            const rt = d.telemetry.reversal;
            expect(rt).toBeDefined();
            expect(typeof rt.reversalAttempted).toBe('number');
            expect(typeof rt.reversalBlocked).toBe('number');
            expect(typeof rt.reversalConvertedToExit).toBe('number');
            expect(typeof rt.exitOnFlipCount).toBe('number');
            expect(typeof rt.flipPersistenceCount).toBe('number');
            expect(rt.currentPositionSide).toBe('BUY'); // LONG → BUY
            expect(rt.sideCandidate).toBeDefined();
            expect(typeof rt.minFlipIntervalMs).toBe('number');
            expect(typeof rt.entryConfirmations).toBe('number');
        });
    });

    describe('Flip tracking reset', () => {
        it('resets flip tracking when side returns to same direction', () => {
            const orch = new OrchestratorV1(testParams());
            const drpLong = makeDrp('LONG', 5.0);

            // Tick 1: BUY (same side)
            orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: 1.5, cvdSlope: 0.05, obiDeep: 0.3,
                nowMs: NOW,
            }));

            // Tick 2: SELL (flip starts)
            const d2 = orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: -2.0, cvdSlope: -0.1, obiDeep: -0.5,
                nowMs: NOW + 100,
            }));
            expect(d2.telemetry.reversal.flipPersistenceCount).toBe(1);

            // Tick 3: BUY again (flip cancels → persistence resets)
            const d3 = orch.evaluate(baseInput('ETHUSDT', {
                dryRunPosition: drpLong,
                deltaZ: 1.5, cvdSlope: 0.05, obiDeep: 0.3,
                nowMs: NOW + 200,
            }));
            expect(d3.telemetry.reversal.flipPersistenceCount).toBe(0);
        });
    });
});
