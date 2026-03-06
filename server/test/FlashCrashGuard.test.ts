import assert from 'node:assert/strict';
import { FlashCrashGuard } from '../risk/FlashCrashGuard';

export function runTests(): void {
  const guard = new FlashCrashGuard('ETHUSDT', {
    spreadThreshold: 0.005,
    consecutiveVacuumTicks: 3,
    maxMidDeviationFromLastPriceRatio: 0.03,
    enableKillSwitch: true,
  });

  guard.recordTick({
    price: 3000,
    volume: 5,
    timestampMs: 1_000,
    bestBid: 2999.5,
    bestAsk: 3000.5,
  });

  const desynced = guard.recordOrderbook(1_000, 2_000, 1_010);
  assert.equal(desynced.shouldHalt, false, 'desynced book must not halt trading');
  assert.equal(desynced.shouldKillSwitch, false, 'desynced book must not trigger kill switch');
  assert.equal(desynced.reason, 'desynced_orderbook', 'desynced book should be classified explicitly');

  const validGuard = new FlashCrashGuard('BTCUSDT', {
    spreadThreshold: 0.005,
    consecutiveVacuumTicks: 3,
    maxMidDeviationFromLastPriceRatio: 0.03,
    enableKillSwitch: true,
  });

  validGuard.recordTick({
    price: 100,
    volume: 1,
    timestampMs: 2_000,
    bestBid: 99.99,
    bestAsk: 100.01,
  });

  const first = validGuard.recordOrderbook(99.625, 100.375, 2_010);
  const second = validGuard.recordOrderbook(99.625, 100.375, 2_020);
  const third = validGuard.recordOrderbook(99.625, 100.375, 2_030);
  const fourth = validGuard.recordOrderbook(99.625, 100.375, 2_040);

  assert.equal(first.shouldHalt, false, 'single vacuum tick should only monitor');
  assert.equal(second.shouldHalt, false, 'vacuum should require consecutive confirmations');
  assert.equal(third.shouldHalt, true, 'third consecutive vacuum tick should halt');
  assert.equal(third.shouldKillSwitch, false, 'warning-level vacuum should halt before kill switch');
  assert.equal(fourth.shouldKillSwitch, true, 'continued vacuum after halt should escalate to kill switch');
}
