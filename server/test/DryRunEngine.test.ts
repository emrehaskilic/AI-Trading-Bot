function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

import { DryRunConfig, DryRunEngine, DryRunEventInput } from '../dryrun';

function baseConfig(overrides: Partial<DryRunConfig> = {}): DryRunConfig {
  return {
    runId: 'run-deterministic-001',
    walletBalanceStartUsdt: 5000,
    initialMarginUsdt: 200,
    takerFeeRate: 0.0004,
    maintenanceMarginRate: 0.005,
    fundingRate: 0,
    fundingIntervalMs: 8 * 60 * 60 * 1000,
    proxy: {
      mode: 'backend-proxy',
      restBaseUrl: 'https://fapi.binance.com',
      marketWsBaseUrl: 'wss://fstream.binance.com/stream',
    },
    ...overrides,
  };
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value);
}

export function runTests() {
  // Determinism + deterministic IDs
  {
    const events: DryRunEventInput[] = [
      {
        timestampMs: 1_700_000_000_000,
        markPrice: 100,
        orderBook: {
          bids: [{ price: 99, qty: 3 }],
          asks: [{ price: 100, qty: 2 }],
        },
        orders: [{ side: 'BUY', type: 'MARKET', qty: 3 }],
      },
      {
        timestampMs: 1_700_000_001_000,
        markPrice: 101,
        orderBook: {
          bids: [{ price: 101, qty: 2 }],
          asks: [{ price: 102, qty: 2 }],
        },
        orders: [{ side: 'SELL', type: 'MARKET', qty: 1 }],
      },
    ];

    const cfg = baseConfig({ initialMarginUsdt: 500 });
    const runA = new DryRunEngine(cfg).run(events);
    const runB = new DryRunEngine(cfg).run(events);

    assert(runA.finalState.walletBalance === runB.finalState.walletBalance, 'determinism wallet balance mismatch');
    const idsA = runA.logs.flatMap((l) => [
      l.eventId,
      ...l.orderResults.map((o) => o.orderId),
      ...l.orderResults.flatMap((o) => o.tradeIds),
    ]);
    const idsB = runB.logs.flatMap((l) => [
      l.eventId,
      ...l.orderResults.map((o) => o.orderId),
      ...l.orderResults.flatMap((o) => o.tradeIds),
    ]);
    assert(idsA.join('|') === idsB.join('|'), 'determinism ids mismatch');
    assert(idsA.every((id) => !isUuidLike(id)), 'uuid-like id detected');

    const firstOrder = runA.logs[0].orderResults[0];
    assert(firstOrder.filledQty === 2, 'market IOC partial fill expected (filledQty=2)');
    assert(firstOrder.remainingQty === 1, 'market IOC remainder must be canceled');
  }

  // Liquidation must force full close even when book depth is below position size.
  {
    const cfg = baseConfig({
      runId: 'run-liquidation-001',
      walletBalanceStartUsdt: 100,
      initialMarginUsdt: 1000,
      takerFeeRate: 0.001,
      maintenanceMarginRate: 0.01,
    });
    const engine = new DryRunEngine(cfg);
    engine.processEvent({
      timestampMs: 1_700_001_000_000,
      markPrice: 100,
      orderBook: {
        bids: [{ price: 99, qty: 10 }],
        asks: [{ price: 100, qty: 10 }],
      },
      orders: [{ side: 'BUY', type: 'MARKET', qty: 5 }],
    });

    const out = engine.processEvent({
      timestampMs: 1_700_001_001_000,
      markPrice: 1,
      orderBook: {
        bids: [{ price: 1, qty: 1 }],
        asks: [{ price: 2, qty: 1 }],
      },
      orders: [],
    });

    assert(out.log.liquidationTriggered === true, 'liquidation must trigger');
    assert(out.state.position === null, 'position must be fully closed on liquidation');
    const liq = out.log.orderResults.find((o) => o.reason === 'FORCED_LIQUIDATION');
    assert(Boolean(liq), 'forced liquidation order result must exist');
    assert((liq?.filledQty || 0) === 5, 'forced liquidation must close full size');
  }

  // Funding gap loop must apply all missed periods.
  {
    const cfg = baseConfig({
      runId: 'run-funding-gap-001',
      takerFeeRate: 0,
      fundingRate: 0.01,
      initialMarginUsdt: 500,
    });
    const engine = new DryRunEngine(cfg);
    engine.processEvent({
      timestampMs: 1,
      markPrice: 100,
      orderBook: {
        bids: [{ price: 99, qty: 10 }],
        asks: [{ price: 100, qty: 10 }],
      },
      orders: [{ side: 'BUY', type: 'MARKET', qty: 1 }],
    });

    const gapResult = engine.processEvent({
      timestampMs: (16 * 60 * 60 * 1000) + 1,
      markPrice: 100,
      orderBook: {
        bids: [{ price: 99, qty: 10 }],
        asks: [{ price: 100, qty: 10 }],
      },
      orders: [],
    });

    assert(gapResult.log.fundingImpact === -2, 'funding gap loop must apply 2 periods');
    assert(gapResult.state.walletBalance === 4998, 'wallet after funding gap must be exact');
  }

  // Upstream guard: non-mainnet upstream must hard-fail.
  {
    let threw = false;
    try {
      new DryRunEngine(baseConfig({
        runId: 'run-upstream-guard-001',
        proxy: {
          mode: 'backend-proxy',
          restBaseUrl: 'https://testnet.binancefuture.com',
          marketWsBaseUrl: 'wss://stream.binancefuture.com/stream',
        },
      }));
    } catch (e: any) {
      threw = true;
    }
    assert(threw, 'upstream guard must reject testnet hosts');
  }
}
