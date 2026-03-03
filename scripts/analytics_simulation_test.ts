import * as AnalyticsEngineModule from '../server/analytics/AnalyticsEngine.ts';
import type { FillEvent, PositionUpdateEvent, PriceTickEvent } from '../server/analytics/types';

const AnalyticsEngine =
  (AnalyticsEngineModule as any).AnalyticsEngine
  ?? (AnalyticsEngineModule as any).default?.AnalyticsEngine
  ?? (AnalyticsEngineModule as any).default
  ?? (AnalyticsEngineModule as any)['module.exports']?.AnalyticsEngine
  ?? (AnalyticsEngineModule as any)['module.exports'];

type EventEnvelope =
  | { type: 'FILL'; data: FillEvent }
  | { type: 'POSITION_UPDATE'; data: PositionUpdateEvent }
  | { type: 'PRICE_TICK'; data: PriceTickEvent };

interface TestScenario {
  name: string;
  description: string;
  events: EventEnvelope[];
  expected: {
    totalTrades: number;
    totalRealizedPnl: number;
    totalFees: number;
    winRate: number;
  };
}

const BASE_TS = 1_741_012_200_000;

const scenarios: TestScenario[] = [
  {
    name: 'Simple Long Trade',
    description: 'Single entry and exit for BTCUSDT long position',
    events: [
      {
        type: 'FILL',
        data: {
          type: 'FILL',
          symbol: 'BTCUSDT',
          side: 'BUY',
          qty: 0.1,
          price: 50000,
          fee: 5,
          feeType: 'taker',
          timestamp: BASE_TS,
          orderId: 'order-001',
          tradeId: 'trade-001',
          isReduceOnly: false,
        },
      },
      {
        type: 'FILL',
        data: {
          type: 'FILL',
          symbol: 'BTCUSDT',
          side: 'SELL',
          qty: 0.1,
          price: 51000,
          fee: 5.1,
          feeType: 'taker',
          timestamp: BASE_TS + 60_000,
          orderId: 'order-002',
          tradeId: 'trade-001',
          isReduceOnly: true,
        },
      },
    ],
    expected: {
      totalTrades: 1,
      totalRealizedPnl: 100,
      totalFees: 10.1,
      winRate: 100,
    },
  },
  {
    name: 'Partial Fills',
    description: 'Multiple partial entry fills and single exit',
    events: [
      {
        type: 'FILL',
        data: {
          type: 'FILL',
          symbol: 'ETHUSDT',
          side: 'BUY',
          qty: 0.05,
          price: 3000,
          fee: 1.5,
          feeType: 'maker',
          timestamp: BASE_TS,
          orderId: 'order-003',
          tradeId: 'trade-002',
          isReduceOnly: false,
        },
      },
      {
        type: 'FILL',
        data: {
          type: 'FILL',
          symbol: 'ETHUSDT',
          side: 'BUY',
          qty: 0.05,
          price: 3010,
          fee: 1.505,
          feeType: 'maker',
          timestamp: BASE_TS + 10_000,
          orderId: 'order-004',
          tradeId: 'trade-002',
          isReduceOnly: false,
        },
      },
      {
        type: 'FILL',
        data: {
          type: 'FILL',
          symbol: 'ETHUSDT',
          side: 'SELL',
          qty: 0.1,
          price: 3050,
          fee: 3.05,
          feeType: 'taker',
          timestamp: BASE_TS + 120_000,
          orderId: 'order-005',
          tradeId: 'trade-002',
          isReduceOnly: true,
        },
      },
    ],
    expected: {
      totalTrades: 1,
      totalRealizedPnl: 4.5,
      totalFees: 6.055,
      winRate: 100,
    },
  },
  {
    name: 'Flip Scenario',
    description: 'Long to short flip with price/position updates',
    events: [
      {
        type: 'FILL',
        data: {
          type: 'FILL',
          symbol: 'BTCUSDT',
          side: 'BUY',
          qty: 0.1,
          price: 50000,
          fee: 5,
          feeType: 'taker',
          timestamp: BASE_TS,
          orderId: 'order-006',
          tradeId: 'trade-003',
          isReduceOnly: false,
        },
      },
      {
        type: 'PRICE_TICK',
        data: {
          type: 'PRICE_TICK',
          symbol: 'BTCUSDT',
          markPrice: 50200,
          timestamp: BASE_TS + 10_000,
        },
      },
      {
        type: 'PRICE_TICK',
        data: {
          type: 'PRICE_TICK',
          symbol: 'BTCUSDT',
          markPrice: 49800,
          timestamp: BASE_TS + 20_000,
        },
      },
      {
        type: 'FILL',
        data: {
          type: 'FILL',
          symbol: 'BTCUSDT',
          side: 'SELL',
          qty: 0.15,
          price: 49900,
          fee: 7.485,
          feeType: 'taker',
          timestamp: BASE_TS + 30_000,
          orderId: 'order-007',
          tradeId: 'trade-003',
          isReduceOnly: false,
        },
      },
      {
        type: 'POSITION_UPDATE',
        data: {
          type: 'POSITION_UPDATE',
          symbol: 'BTCUSDT',
          side: 'SHORT',
          qty: 0.05,
          entryPrice: 49900,
          markPrice: 49900,
          unrealizedPnl: 0,
          timestamp: BASE_TS + 30_000,
        },
      },
    ],
    expected: {
      totalTrades: 1,
      totalRealizedPnl: -10,
      totalFees: 12.485,
      winRate: 0,
    },
  },
];

function approxEqual(actual: number, expected: number, tolerance = 0.01): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

async function run(): Promise<void> {
  let passCount = 0;

  console.log('============================================================');
  console.log('Analytics Simulation Test Suite');
  console.log('============================================================');

  for (const scenario of scenarios) {
    const engine = new AnalyticsEngine({
      persistToDisk: false,
      snapshotIntervalMs: Number.MAX_SAFE_INTEGER,
    });

    const errors: string[] = [];

    for (const event of scenario.events) {
      if (event.type === 'FILL') {
        engine.ingestFill(event.data);
      } else if (event.type === 'POSITION_UPDATE') {
        engine.ingestPosition(event.data);
      } else {
        engine.ingestPrice(event.data);
      }
    }

    const snapshot = engine.getSnapshot();
    const closedTrades = snapshot.trades.filter((trade) => trade.status === 'CLOSED').length;
    const realizedPnl = snapshot.summary.totalRealizedPnl;
    const totalFees = snapshot.summary.totalFees;
    const winRate = snapshot.summary.winRate;

    if (closedTrades !== scenario.expected.totalTrades) {
      errors.push(`trade_count expected=${scenario.expected.totalTrades} actual=${closedTrades}`);
    }
    if (!approxEqual(realizedPnl, scenario.expected.totalRealizedPnl)) {
      errors.push(`realized_pnl expected=${scenario.expected.totalRealizedPnl} actual=${realizedPnl}`);
    }
    if (!approxEqual(totalFees, scenario.expected.totalFees)) {
      errors.push(`total_fees expected=${scenario.expected.totalFees} actual=${totalFees}`);
    }
    if (!approxEqual(winRate, scenario.expected.winRate, 0.1)) {
      errors.push(`win_rate expected=${scenario.expected.winRate} actual=${winRate}`);
    }

    if (errors.length === 0) {
      passCount += 1;
      console.log(`PASS: ${scenario.name}`);
    } else {
      console.log(`FAIL: ${scenario.name}`);
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
    }
  }

  console.log('------------------------------------------------------------');
  console.log(`Result: ${passCount}/${scenarios.length} scenarios passed`);

  if (passCount !== scenarios.length) {
    process.exitCode = 1;
    return;
  }

  console.log('ALL TESTS PASSED');
}

run().catch((error) => {
  console.error('analytics_simulation_test_failed', error);
  process.exitCode = 1;
});
