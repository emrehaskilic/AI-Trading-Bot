import { test, describe, expect, beforeEach } from 'vitest';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Input } from '../orchestrator_v1/types';

function buildInput(nowMs: number, overrides: Partial<OrchestratorV1Input> = {}): OrchestratorV1Input {
    return {
        symbol: 'BTCUSDT',
        nowMs,
        price: 65000,
        bestBid: 64999.5,
        bestAsk: 65000.5,
        spreadPct: 0.0001,
        printsPerSecond: 10,
        deltaZ: 1.5,     // BUY side candidate
        cvdSlope: 0.005, // BUY side candidate
        cvdTf5mState: 'BUY',
        obiDeep: 0.1,    // BUY side candidate
        obiWeighted: 0.1,
        trendinessScore: 0.8,
        chopScore: 0.2,
        volOfVol: 0.1,
        realizedVol1m: 0.05,
        atr3m: 200,
        atrSource: 'BACKFILL_ATR',
        orderbookIntegrityLevel: 100,
        oiChangePct: 0.01,
        sessionVwapValue: 64800, // Distance to 65k is ~0.3%, valid for gateC
        htfH1BarStartMs: nowMs - 3600_000,
        htfH4BarStartMs: nowMs - 4 * 3600_000,
        backfillDone: true,
        barsLoaded1m: 500,
        htfH1SwingLow: 64000,
        htfH1SwingHigh: 66000,
        htfH1StructureBreakUp: false,
        htfH1StructureBreakDn: false,
        ...overrides,
    };
}

describe('OrchestratorV1 - HTF Filters (Hard Veto & Soft Bias)', () => {
    let orc: OrchestratorV1;

    beforeEach(() => {
        orc = new OrchestratorV1();
    });

    test('allows ENTRY straight away if confirmations reached (No HTF veto/bias)', () => {
        const now = Date.now();
        let decision;
        let ticks = 0;

        while (ticks < 10) {
            decision = orc.evaluate(buildInput(now + ticks * 1000));
            ticks++;
            if (decision.intent === 'ENTRY') break;
        }

        expect(decision!.intent).toBe('ENTRY');
        expect(decision!.telemetry.htf.vetoed).toBe(false);
        expect(decision!.telemetry.htf.softBiasApplied).toBe(false);
    });

    test('blocks BUY when h1StructureBreakDn == true (Hard Veto)', () => {
        const now = Date.now();
        let decision;

        for (let i = 0; i < 10; i++) {
            decision = orc.evaluate(buildInput(now + i * 1000, {
                htfH1StructureBreakDn: true,
            }));
            expect(decision.intent).toBe('HOLD');
        }

        // By the end of 10 ticks, sideForEntry is definitely established and GateA should be blocked
        expect(decision!.gateA.passed).toBe(false);
        expect(decision!.telemetry.htf.vetoed).toBe(true);
        expect(decision!.telemetry.htf.reason).toBe('H1_STRUCTURE_BREAK_DN');
    });

    test('blocks SELL when h1StructureBreakUp == true (Hard Veto)', () => {
        const now = Date.now();
        let decision;

        for (let i = 0; i < 10; i++) {
            decision = orc.evaluate(buildInput(now + i * 1000, {
                deltaZ: -1.5,
                cvdSlope: -0.005,
                obiDeep: -0.1, // Switch to SELL candidate
                htfH1StructureBreakUp: true,
                sessionVwapValue: 65100 // Valid GateC vwap
            }));
            expect(decision.intent).toBe('HOLD');
        }

        expect(decision!.gateA.passed).toBe(false);
        expect(decision!.telemetry.htf.vetoed).toBe(true);
        expect(decision!.telemetry.htf.reason).toBe('H1_STRUCTURE_BREAK_UP');
    });

    test('applies Soft Bias (needs +1 confirmation) when BUY price <= h1SwingLow without structure break', () => {
        const now = Date.now();
        let baseDecision;
        let softBiasDecision;

        // First, measure how many ticks we need WITHOUT soft bias
        let orcBase = new OrchestratorV1();
        let baseTicks = 0;
        while (baseTicks < 15) {
            baseDecision = orcBase.evaluate(buildInput(now + baseTicks * 1000));
            baseTicks++;
            if (baseDecision.intent === 'ENTRY') break;
        }
        expect(baseDecision!.intent).toBe('ENTRY');

        // Now reproduce WITH soft bias (price drops below swing low)
        let softBiasTicks = 0;
        while (softBiasTicks < 15) {
            softBiasDecision = orc.evaluate(buildInput(now + softBiasTicks * 1000, {
                price: 63500, // Below swingLow of 64000
                bestBid: 63499.5,
                bestAsk: 63500.5,
                sessionVwapValue: 63400 // keep gateC valid
            }));
            softBiasTicks++;
            if (softBiasDecision.intent === 'ENTRY') break;
        }

        // Soft bias should require exactly 1 more tick than the base requirement
        expect(softBiasDecision!.intent).toBe('ENTRY');
        expect(softBiasTicks).toBe(baseTicks + 1);

        expect(softBiasDecision!.telemetry.htf.softBiasApplied).toBe(true);
        expect(softBiasDecision!.telemetry.htf.vetoed).toBe(false);
        expect(softBiasDecision!.telemetry.htf.reason).toBe('H1_SWING_BELOW_SOFT');
    });

    test('applies Soft Bias (+1 confirmation) when SELL price >= h1SwingHigh without structure break', () => {
        const now = Date.now();
        let baseDecision;
        let softBiasDecision;

        // Base SELL requirement
        let orcBase = new OrchestratorV1();
        let baseTicks = 0;
        while (baseTicks < 15) {
            baseDecision = orcBase.evaluate(buildInput(now + baseTicks * 1000, {
                deltaZ: -1.5, cvdSlope: -0.005, obiDeep: -0.1, sessionVwapValue: 65100
            }));
            baseTicks++;
            if (baseDecision.intent === 'ENTRY') break;
        }
        expect(baseDecision!.intent).toBe('ENTRY');

        // Soft Bias SELL requirement
        let softBiasTicks = 0;
        while (softBiasTicks < 15) {
            softBiasDecision = orc.evaluate(buildInput(now + softBiasTicks * 1000, {
                deltaZ: -1.5, cvdSlope: -0.005, obiDeep: -0.1,
                price: 67000, // Above swingHigh of 66000
                bestBid: 66999.5,
                bestAsk: 67000.5,
                sessionVwapValue: 66900
            }));
            softBiasTicks++;
            if (softBiasDecision.intent === 'ENTRY') break;
        }

        expect(softBiasDecision!.intent).toBe('ENTRY');
        expect(softBiasTicks).toBe(baseTicks + 1);

        expect(softBiasDecision!.telemetry.htf.softBiasApplied).toBe(true);
        expect(softBiasDecision!.telemetry.htf.vetoed).toBe(false);
        expect(softBiasDecision!.telemetry.htf.reason).toBe('H1_SWING_ABOVE_SOFT');
    });
});
