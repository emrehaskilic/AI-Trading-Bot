import * as AntiSpoofGuardModule from '../server/metrics/AntiSpoofGuard.ts';
import * as DeltaBurstFilterModule from '../server/metrics/DeltaBurstFilter.ts';
import * as ChurnDetectorModule from '../server/analytics/ChurnDetector.ts';
import * as LatencyGuardModule from '../server/perf/LatencyGuard.ts';
import * as FlashCrashGuardModule from '../server/risk/FlashCrashGuard.ts';
import * as ResiliencePatchesModule from '../server/risk/ResiliencePatches.ts';

type TestResult = {
  name: string;
  passed: boolean;
  details: string;
};

function resolveCtor(moduleObj: any, namedExport: string): any {
  const direct = moduleObj?.[namedExport];
  if (typeof direct === 'function') return direct;
  if (typeof moduleObj?.default === 'function') return moduleObj.default;
  if (typeof direct?.default === 'function') return direct.default;
  if (typeof moduleObj?.default?.default === 'function') return moduleObj.default.default;
  return direct ?? moduleObj;
}

const AntiSpoofGuardCtor: any = resolveCtor(AntiSpoofGuardModule, 'AntiSpoofGuard');
const DeltaBurstFilterCtor: any = resolveCtor(DeltaBurstFilterModule, 'DeltaBurstFilter');
const ChurnDetectorCtor: any = resolveCtor(ChurnDetectorModule, 'ChurnDetector');
const LatencyGuardCtor: any = resolveCtor(LatencyGuardModule, 'LatencyGuard');
const FlashCrashGuardCtor: any = resolveCtor(FlashCrashGuardModule, 'FlashCrashGuard');
const ResiliencePatchesCtor: any = resolveCtor(ResiliencePatchesModule, 'ResiliencePatches');

const BASE_TS = 1_700_000_000_000;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function expectTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTest(name: string, fn: () => string): TestResult {
  try {
    const details = fn();
    return { name, passed: true, details };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return { name, passed: false, details };
  }
}

function testSpoofing(): TestResult {
  return runTest('S1-OBI-SPOOF', () => {
    const guard = new AntiSpoofGuardCtor('BTCUSDT');
    const spoofPrice = 45_100;

    for (let i = 0; i < 3; i += 1) {
      const t0 = BASE_TS + i * 40;
      guard.recordActivity({ price: spoofPrice, side: 'ask', size: 500, timestampMs: t0, type: 'add' });
      guard.recordActivity({ price: spoofPrice, side: 'ask', size: 500, timestampMs: t0 + 20, type: 'cancel' });
    }

    const check = guard.checkLevel(spoofPrice, 'ask', BASE_TS + 500);
    expectTrue(check.isSpoofSuspected, 'spoofing was not detected');
    expectTrue(check.downWeightFactor < 1, 'down-weight was not applied');

    return `score=${check.spoofScore.toFixed(2)} downWeight=${check.downWeightFactor.toFixed(2)}`;
  });
}

function testDeltaBurst(): TestResult {
  return runTest('S2-DELTA-BURST', () => {
    const filter = new DeltaBurstFilterCtor('BTCUSDT', {
      minSamples: 10,
      zScoreThreshold: 2.5,
      cooldownMs: 500,
    });

    for (let i = 0; i < 12; i += 1) {
      const delta = i % 2 === 0 ? 0.05 : -0.05;
      filter.recordDelta(delta, 45_000, BASE_TS + i * 100);
    }

    const burst = filter.recordDelta(5.0, 45_000, BASE_TS + 1_500);
    const inCooldown = filter.isInCooldown(BASE_TS + 1_600);

    expectTrue(burst.isBurst || inCooldown, 'delta burst mitigation not triggered');
    expectTrue(filter.getConfidenceMultiplier(BASE_TS + 1_600) < 1, 'confidence was not reduced');

    return `isBurst=${burst.isBurst} zScore=${burst.zScore.toFixed(2)} cooldown=${inCooldown}`;
  });
}

function testChurn(): TestResult {
  return runTest('S3-CHOP-CHURN', () => {
    const detector = new ChurnDetectorCtor('BTCUSDT', {
      maxFlipsInWindow: 3,
      chopScoreThreshold: 0.7,
      minChopSamples: 4,
      confidenceCap: 0.5,
    });

    const sides: Array<'BUY' | 'SELL'> = ['BUY', 'SELL', 'BUY', 'SELL'];
    for (let i = 0; i < sides.length; i += 1) {
      detector.recordFlip(sides[i], 45_000 + i * 5, BASE_TS + i * 5_000);
      detector.recordChopScore(0.78, BASE_TS + i * 5_000);
    }

    const result = detector.detectChurn(BASE_TS + 25_000);
    expectTrue(result.action !== 'ALLOW', 'churn mitigation not triggered');

    return `action=${result.action} flips=${result.flipCount} chop=${result.chopScore.toFixed(2)}`;
  });
}

function testLatency(): TestResult {
  return runTest('S4-LATENCY-SPIKE', () => {
    const rng = mulberry32(7);
    const guard = new LatencyGuardCtor({
      p95ThresholdMs: 100,
      p99ThresholdMs: 200,
      eventLoopLagThresholdMs: 50,
      consecutiveViolations: 3,
      killSwitchAfterViolations: 5,
    });

    for (let i = 0; i < 40; i += 1) {
      const latency = 20 + Math.floor(rng() * 20);
      guard.recordLatency(latency, BASE_TS + i * 100, 'network');
    }

    for (let i = 0; i < 5; i += 1) {
      guard.recordLatency(180 + i * 10, BASE_TS + 4_500 + i * 100, 'network');
    }

    guard.recordEventLoopLag(80, BASE_TS + 5_200);

    const shouldSuppress = guard.shouldSuppressTrades(BASE_TS + 5_300);
    expectTrue(shouldSuppress, 'latency suppression not triggered');

    const status = guard.getStatus(BASE_TS + 5_300);
    return `p95=${status.metrics.p95.toFixed(1)} suppress=${shouldSuppress}`;
  });
}

function testFlashCrash(): TestResult {
  return runTest('S5-FLASH-CRASH', () => {
    const guard = new FlashCrashGuardCtor('BTCUSDT', {
      gapThreshold: 0.02,
      spreadThreshold: 0.005,
      consecutiveGapTicks: 2,
      enableKillSwitch: true,
    });

    guard.start();

    guard.recordTick({
      price: 45_000,
      volume: 1_000,
      timestampMs: BASE_TS,
      bestBid: 44_995,
      bestAsk: 45_005,
    });

    const t1 = guard.recordTick({
      price: 44_000,
      volume: 3_000,
      timestampMs: BASE_TS + 500,
      bestBid: 43_995,
      bestAsk: 44_005,
    });

    const t2 = guard.recordTick({
      price: 43_000,
      volume: 5_000,
      timestampMs: BASE_TS + 1_000,
      bestBid: 42_995,
      bestAsk: 43_005,
    });

    const vacuum = guard.recordOrderbook(42_000, 42_800, BASE_TS + 1_200);
    const shouldHalt = guard.shouldHalt(BASE_TS + 1_300);

    expectTrue(t1.gapDetected || t2.isFlashCrash || vacuum.isFlashCrash || shouldHalt, 'flash crash mitigation not triggered');

    return `gap1=${t1.gapPercent.toFixed(2)} flashCrash=${t2.isFlashCrash} halt=${shouldHalt}`;
  });
}

function testResilienceIntegration(): TestResult {
  return runTest('RESILIENCE-INTEGRATION', () => {
    const patches = new ResiliencePatchesCtor({
      enableAll: true,
      autoKillSwitch: true,
      autoHalt: true,
    });

    const symbol = 'BTCUSDT';

    for (let i = 0; i < 3; i += 1) {
      const t0 = BASE_TS + i * 30;
      patches.recordOrderActivity(symbol, 45_100, 'ask', 500, 'add', t0);
      patches.recordOrderActivity(symbol, 45_100, 'ask', 500, 'cancel', t0 + 20);
    }

    for (let i = 0; i < 12; i += 1) {
      patches.recordDelta(symbol, 0.1, 45_000, BASE_TS + 1_000 + i * 100);
    }
    patches.recordDelta(symbol, 8.0, 45_000, BASE_TS + 2_500);

    patches.recordSideFlip(symbol, 'BUY', 45_000, BASE_TS + 3_000);
    patches.recordSideFlip(symbol, 'SELL', 44_990, BASE_TS + 8_000);
    patches.recordSideFlip(symbol, 'BUY', 45_010, BASE_TS + 13_000);
    patches.recordSideFlip(symbol, 'SELL', 45_005, BASE_TS + 18_000);

    patches.recordChopScore(symbol, 0.78, BASE_TS + 18_000);
    patches.recordLatency(250, BASE_TS + 18_100, 'network');
    patches.recordLatency(260, BASE_TS + 18_200, 'network');
    patches.recordLatency(270, BASE_TS + 18_300, 'network');

    patches.recordPriceTick(symbol, 42_000, 10_000, 41_990, 42_010, BASE_TS + 18_400);
    patches.recordOrderbook(symbol, 41_500, 42_500, BASE_TS + 18_500);

    const result = patches.evaluate(symbol, BASE_TS + 18_600);
    expectTrue(!result.allow || result.confidenceMultiplier < 1, 'resilience integration did not affect decision');

    return `allow=${result.allow} action=${result.action} multiplier=${result.confidenceMultiplier.toFixed(2)}`;
  });
}

async function main(): Promise<void> {
  const tests = [
    testSpoofing,
    testDeltaBurst,
    testChurn,
    testLatency,
    testFlashCrash,
    testResilienceIntegration,
  ];

  const results = tests.map((test) => test());
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${result.name} | ${result.details}`);
  }

  console.log(`SUMMARY | passed=${passed} failed=${failed} total=${results.length}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('redteam_simulation_failed', error);
  process.exitCode = 1;
});


