import { describe, it, expect, beforeEach } from 'vitest';
import { OrchestratorV1 } from '../orchestrator_v1/OrchestratorV1';
import { OrchestratorV1Input, OrchestratorV1BtcContext } from '../orchestrator_v1/types';

function goodInput(nowMs: number, overrides: Partial<OrchestratorV1Input> = {}): OrchestratorV1Input {
    return {
        symbol: 'ETHUSDT',
        nowMs,
        price: 2000,
        bestBid: 1999,
        bestAsk: 2001,
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
        atr3m: 10,
        atrSource: 'MICRO_ATR',
        orderbookIntegrityLevel: 0,
        oiChangePct: 0,
        sessionVwapValue: 2000,
        htfH1BarStartMs: nowMs - 3600_000,
        htfH4BarStartMs: nowMs - 14400_000,
        backfillDone: true,
        barsLoaded1m: 400,
        ...overrides,
    };
}

function createBtcContext(
    h1Up: boolean, h1Dn: boolean,
    h4Up: boolean, h4Dn: boolean,
    trendiness = 0.6, chop = 0.2
): OrchestratorV1BtcContext {
    return {
        h1BarStartMs: 1000,
        h4BarStartMs: 1000,
        h1StructureUp: h1Up,
        h1StructureDn: h1Dn,
        h4StructureUp: h4Up,
        h4StructureDn: h4Dn,
        trendiness,
        chop,
    };
}

const T0 = 1_700_000_000_000;

describe('OrchestratorV1 - Cross Market Veto', () => {
    let orc: OrchestratorV1;

    beforeEach(() => {
        orc = new OrchestratorV1();
    });

    function advanceToEntryCandidate(symbol: string, side: 'BUY' | 'SELL', btcContext: OrchestratorV1BtcContext | null) {
        let lastDecision;
        let entryDecision = null;
        const deltaZ = side === 'BUY' ? 1.2 : -1.2;
        const cvdSlope = side === 'BUY' ? 0.05 : -0.05;
        const obiDeep = side === 'BUY' ? 0.3 : -0.3;

        for (let i = 0; i < 5; i++) {
            lastDecision = orc.evaluate(goodInput(T0 + i * 100, {
                symbol,
                deltaZ,
                cvdSlope,
                obiDeep,
                btcContext
            }));
            if (lastDecision.intent === 'ENTRY' && !entryDecision) {
                entryDecision = lastDecision;
            }
        }
        return entryDecision || lastDecision!;
    }

    it('derives btcBias=LONG correctly and blocks altcoin SHORT', () => {
        // BTC is uniformly LONG in H1/H4
        const context = createBtcContext(true, false, true, false);
        // We try to trigger a SELL decision on ETHUSDT
        const dec = advanceToEntryCandidate('ETHUSDT', 'SELL', context);

        // Gate should pass, but vetoed before order
        expect(dec.allGatesPassed).toBe(true);
        expect(dec.intent).toBe('HOLD');
        // We ensure no ENTRY orders were emitted and chase did not start
        expect(dec.orders.length).toBe(0);
        expect(dec.chase.active).toBe(false);
        expect(dec.crossMarketBlockReason).toBeDefined();
        if (dec.crossMarketBlockReason) {
            expect(dec.crossMarketBlockReason.btcBias).toBe('LONG');
        }
        expect(dec.telemetry.crossMarket.crossMarketVetoCount).toBeGreaterThan(0);
    });

    it('derives btcBias=SHORT correctly and blocks altcoin LONG', () => {
        // BTC is uniformly SHORT in H1/H4
        const context = createBtcContext(false, true, false, true);
        const dec = advanceToEntryCandidate('SOLUSDT', 'BUY', context);

        expect(dec.intent).toBe('HOLD');
        expect(dec.orders.length).toBe(0);
        expect(dec.crossMarketBlockReason).toBeDefined();
        if (dec.crossMarketBlockReason) {
            expect(dec.crossMarketBlockReason.btcBias).toBe('SHORT');
        }
    });

    it('does not block aligned direction (BTC LONG, ETH LONG)', () => {
        const context = createBtcContext(true, false, true, false);
        const dec = advanceToEntryCandidate('ETHUSDT', 'BUY', context);

        expect(dec.intent).toBe('ENTRY');
        expect(dec.orders.length).toBeGreaterThan(0);
        expect(dec.crossMarketBlockReason).toBeNull();
        expect(dec.telemetry.crossMarket.crossMarketVetoCount).toBe(0);
        expect(dec.telemetry.crossMarket.crossMarketAllowedCount).toBeGreaterThan(0);
    });

    it('does not block anything if btcBias is NEUTRAL (choppy)', () => {
        // Conflicting structure
        const contextConflicting = createBtcContext(true, false, false, true);
        const dec1 = advanceToEntryCandidate('ETHUSDT', 'SELL', contextConflicting);
        expect(dec1.intent).toBe('ENTRY');
        expect(dec1.crossMarketBlockReason).toBeNull();

        // Or cleanly LONG structure, but chop is too high
        orc = new OrchestratorV1(); // reset state
        const contextChoppy = createBtcContext(true, false, true, false, 0.6, 0.9); // chop = 0.9
        const dec2 = advanceToEntryCandidate('ETHUSDT', 'SELL', contextChoppy);
        expect(dec2.intent).toBe('ENTRY');
        expect(dec2.crossMarketBlockReason).toBeNull();
        expect(dec2.telemetry.crossMarket.crossMarketNeutralCount).toBeGreaterThan(0);
    });

    it('never blocks BTC USDT symbol itself', () => {
        // BTC is LONG, but we trigger SHORT on BTCUSDT
        const context = createBtcContext(true, false, true, false);
        const dec = advanceToEntryCandidate('BTCUSDT', 'SELL', context);

        expect(dec.intent).toBe('ENTRY');
        expect(dec.orders.length).toBeGreaterThan(0);
        expect(dec.crossMarketBlockReason).toBeNull();
    });

    it('disables cross-market when BTC is not selected (crossMarketActive=false)', () => {
        // This context would normally veto ETH SHORT when cross-market is active.
        const context = createBtcContext(true, false, true, false);
        const dec = advanceToEntryCandidate('ETHUSDT', 'SELL', context);

        // Warm-up path uses default crossMarketActive=true; now explicitly disable and retry.
        orc = new OrchestratorV1();
        const decDisabled = (() => {
            let lastDecision;
            for (let i = 0; i < 6; i++) {
                lastDecision = orc.evaluate(goodInput(T0 + 10_000 + i * 100, {
                    symbol: 'ETHUSDT',
                    deltaZ: -1.2,
                    cvdSlope: -0.05,
                    obiDeep: -0.3,
                    btcContext: context,
                    crossMarketActive: false,
                }));
                if (lastDecision.intent === 'ENTRY') break;
            }
            return lastDecision!;
        })();

        expect(dec.intent).toBe('HOLD'); // sanity: active path vetoes
        expect(decDisabled.intent).toBe('ENTRY'); // disabled path allows
        expect(decDisabled.crossMarketBlockReason).toBeNull();
        expect(decDisabled.telemetry.crossMarket.active).toBe(false);
        expect(decDisabled.telemetry.crossMarket.mode).toBe('DISABLED_NO_BTC');
        expect(decDisabled.telemetry.crossMarket.disableReason).toBe('BTC_NOT_SELECTED');
        expect(decDisabled.telemetry.crossMarket.anchorSide).toBe('NONE');
    });
});
