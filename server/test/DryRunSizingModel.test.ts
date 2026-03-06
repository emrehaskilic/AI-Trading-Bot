import assert from 'node:assert/strict';
import { DryRunSessionService } from '../dryrun/DryRunSessionService';
import { DryRunConfig } from '../dryrun/types';

function createConfig(sizing: DryRunConfig['sizing'] = {}): DryRunConfig {
  return {
    runId: 'sizing-model-test',
    walletBalanceStartUsdt: 1000,
    initialMarginUsdt: 500,
    leverage: 33,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0006,
    maintenanceMarginRate: 0.005,
    fundingRate: 0,
    fundingIntervalMs: 28_800_000,
    proxy: { mode: 'backend-proxy', restBaseUrl: '', marketWsBaseUrl: '' },
    sizing,
  };
}

function createSession(posQty = 0, price = 10, addsUsed = 0) {
  return {
    dynamicLeverage: 33,
    capital: {
      effectiveReserveUsdt: 1000,
      initialMarginUsdt: 500,
      effectiveInitialMarginUsdt: 500,
    },
    lastState: {
      position: posQty > 0 ? { qty: posQty } : null,
    },
    addOnState: { count: addsUsed },
  };
}

export function runTests(): void {
  const service = new DryRunSessionService({} as any) as any;
  service.config = createConfig({});

  {
    const session = createSession(0, 10, 0);
    const result = service.computeRiskSizing(session, 10, 'TR', 1, { mode: 'ENTRY' });
    assert.equal(result.qty, 1650, 'entry should use full seed margin: 500 * 33 / 10 = 1650 qty');
  }

  {
    const session = createSession(1650, 10, 0);
    const result = service.computeRiskSizing(session, 10, 'TR', 1, { mode: 'ADD' });
    assert.equal(result.qty, 495, 'add1 should use 30% of seed notional by default');
  }

  {
    const session = createSession(2145, 10, 1);
    const result = service.computeRiskSizing(session, 10, 'TR', 1, { mode: 'ADD' });
    assert.equal(result.qty, 330, 'add2 should use 20% of seed notional by default');
  }

  {
    service.config = createConfig({ maxPositionNotional: 18_000 });
    const session = createSession(1650, 10, 0);
    const result = service.computeRiskSizing(session, 10, 'TR', 1, { mode: 'ADD' });
    assert.equal(result.qty, 150, 'add must be clipped by maxPositionNotional');
  }
}
