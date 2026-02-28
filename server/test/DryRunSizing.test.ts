import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DryRunSessionService } from '../dryrun/DryRunSessionService';
import { DryRunConfig } from '../dryrun/types';

describe('DryRun Sizing Logic (MODEL A Array Scaling)', () => {
    let service: any;

    beforeEach(() => {
        service = new DryRunSessionService({} as any);
        service.runId = 'test-id';
    });

    const createConfig = (sizing: any = {}): DryRunConfig => ({
        runId: 'test-id',
        walletBalanceStartUsdt: 1000,
        initialMarginUsdt: 500,
        leverage: 33,
        makerFeeRate: 0.0002,
        takerFeeRate: 0.0006,
        maintenanceMarginRate: 0.005,
        fundingRate: 0,
        fundingIntervalMs: 28800000,
        proxy: { mode: 'backend-proxy', restBaseUrl: '', marketWsBaseUrl: '' },
        sizing
    });

    const createSession = (posQty = 0, price = 10, addsUsed = 0) => ({
        dynamicLeverage: 33,
        lastState: {
            position: posQty > 0 ? { qty: posQty } : null
        },
        addOnState: { count: addsUsed }
    });

    it('ENTRY: initialMargin=500, lev=33 -> [0.5, 0.3, 0.2] basis=16500 -> entryNotional(50%)=8250', () => {
        service.config = createConfig({});
        const session = createSession(0, 10, 0);

        const res = service.computeRiskSizing(session, 10, 'TREND', 1, { mode: 'ENTRY' });
        // Target: 500 * 33 = 16500. Entry (0.50): 16500 * 0.50 = 8250.
        // Qty = 8250 / 10 = 825.
        expect(res.qty).toBe(825);
    });

    it('ADD1: addsUsed=0, current=8250 -> ADD target (30%)=4950 -> total 13200', () => {
        service.config = createConfig({});
        // after ENTRY it was 8250
        const session = createSession(825, 10, 0); // (addsUsed starts at 0 initially when triggering ADD1)

        const res = service.computeRiskSizing(session, 10, 'TREND', 1, { mode: 'ADD' });
        // Target Add1 (index 1 of [0.5, 0.3, 0.2]): 16500 * 0.3 = 4950.
        // Qty = 4950 / 10 = 495. 
        expect(res.qty).toBe(495);
    });

    it('ADD2: addsUsed=1, current=13200 -> ADD target (20%)=3300 -> total 16500', () => {
        service.config = createConfig({});
        // after ADD1 it was 13200
        const session = createSession(1320, 10, 1);

        const res = service.computeRiskSizing(session, 10, 'TREND', 1, { mode: 'ADD' });
        // Target Add2 (index 2 of [0.5, 0.3, 0.2]): 16500 * 0.2 = 3300.
        // Qty = 3300 / 10 = 330. 
        expect(res.qty).toBe(330);
    });

    it('ADD3: addsUsed=2 -> Veto (Out of bounds array -> qty 0)', () => {
        service.config = createConfig({});
        const session = createSession(1650, 10, 2);
        const res = service.computeRiskSizing(session, 10, 'TREND', 1, { mode: 'ADD' });
        expect(res.qty).toBe(0);
    });

    it('maxPositionNotional=10000 ise ADD kırpılmalı (ADD1 için target 4950, ama kap 10000 - 8250 = 1750 onaylanır)', () => {
        service.config = createConfig({ maxPositionNotional: 10000 });
        const session = createSession(825, 10, 0); // currentNotional=8250

        const res = service.computeRiskSizing(session, 10, 'TREND', 1, { mode: 'ADD' });
        // target=4950 (Add1). var olan: 8250. tavan: 10000. kalan büyüme=1750.
        // res.qty = 1750 / 10 = 175
        expect(res.qty).toBe(175);
    });
});
