/**
 * FAZ 2 risk simulation suite.
 * Runs 7 scenario groups and exits non-zero on failure.
 */

import { InstitutionalRiskEngine } from '../risk/InstitutionalRiskEngine';
import { RiskState } from '../risk/RiskStateManager';

function logCase(name: string, ok: boolean, details?: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${details ? ` | ${details}` : ''}`);
}

function testPositionLimits(): boolean {
  const build = () => {
    const engine = new InstitutionalRiskEngine({
      position: {
        maxPositionNotional: 10_000,
        maxLeverage: 5,
        maxPositionQty: 5,
        maxTotalNotional: 20_000,
      },
    });
    engine.initialize(10_000);
    return engine;
  };

  let engine = build();
  let result = engine.canTrade('BTCUSDT', 1, 15_000, 'long');
  if (result.allowed) return false;

  engine = build();
  result = engine.canTrade('BTCUSDT', 10, 60_000, 'long');
  if (result.allowed) return false;

  engine = build();
  result = engine.canTrade('BTCUSDT', 10, 5_000, 'long');
  if (result.allowed) return false;

  engine = build();
  result = engine.canTrade('BTCUSDT', 2, 5_000, 'long');
  return result.allowed;
}

function testDrawdownLimits(): boolean {
  const engine = new InstitutionalRiskEngine({
    drawdown: {
      dailyLossLimitRatio: 0.1,
      dailyLossWarningRatio: 0.07,
      maxDrawdownRatio: 0.15,
      checkIntervalMs: 1_000,
      autoHaltOnLimit: true,
    },
  });
  engine.initialize(10_000);

  engine.updateEquity(9_300);
  if (!engine.getGuards().drawdown.getDrawdownStatus().isWarning) return false;
  engine.updateEquity(8_900);
  if (!engine.getGuards().drawdown.getDrawdownStatus().isLimit) return false;
  if (engine.getRiskState() !== RiskState.HALTED) return false;
  const result = engine.canTrade('BTCUSDT', 1, 1_000, 'long');
  engine.stop();
  return !result.allowed;
}

function testConsecutiveLosses(): boolean {
  const engine = new InstitutionalRiskEngine({
    consecutiveLoss: {
      maxConsecutiveLosses: 3,
      lossWindowMs: 60_000,
      minLossAmount: 1,
      resetAfterWin: true,
      reducedRiskThreshold: 2,
      reducedRiskMultiplier: 0.5,
    },
  });
  engine.initialize(10_000);

  const ts = Date.now();
  engine.recordTradeResult('BTCUSDT', -100, 1, ts);
  engine.recordTradeResult('BTCUSDT', -150, 1, ts + 1);
  if (engine.getGuards().consecutiveLoss.getLossStatistics().consecutiveLosses !== 2) return false;
  if (engine.getPositionMultiplier() !== 0.5) return false;
  engine.recordTradeResult('BTCUSDT', -200, 1, ts + 2);
  if (engine.getRiskState() !== RiskState.HALTED) return false;
  engine.getGuards().consecutiveLoss.reset();
  engine.recordTradeResult('BTCUSDT', 100, 1, ts + 3);
  return engine.getGuards().consecutiveLoss.getLossStatistics().consecutiveLosses === 0;
}

function testMultiSymbolExposure(): boolean {
  const engine = new InstitutionalRiskEngine({
    multiSymbol: {
      maxConcurrentPositions: 3,
      maxCorrelatedExposureRatio: 0.6,
      maxSymbolConcentrationRatio: 0.5,
      correlationGroups: [['BTCUSDT', 'ETHUSDT']],
    },
  });
  engine.initialize(10_000);

  engine.updatePosition('BTCUSDT', 1, 1_000, 1);
  engine.updatePosition('ETHUSDT', 1, 1_000, 1);
  engine.updatePosition('ADAUSDT', 1, 1_000, 1);
  let result = engine.canTrade('SOLUSDT', 1, 1_000, 'long');
  if (result.allowed) return false;

  engine.getGuards().multiSymbol.reset();
  engine.updatePosition('BTCUSDT', 5, 7_000, 1);
  result = engine.canTrade('ETHUSDT', 1, 1_000, 'long');
  if (result.allowed) return false;

  engine.getGuards().multiSymbol.reset();
  engine.updatePosition('BTCUSDT', 6, 6_000, 1);
  result = engine.canTrade('BTCUSDT', 1, 1_000, 'long');
  return !result.allowed;
}

function testExecutionFailures(): boolean {
  const engine = new InstitutionalRiskEngine({
    execution: {
      maxPartialFillRate: 0.3,
      maxRejectRate: 0.2,
      executionTimeoutMs: 5_000,
      rateWindowMs: 60_000,
      autoHaltOnFailure: true,
    },
  });
  engine.initialize(10_000);

  for (let i = 0; i < 5; i += 1) {
    engine.recordExecutionEvent(`order${i}`, 'BTCUSDT', 'partial_fill', 1, 0.5);
  }
  if (engine.getGuards().execution.getExecutionStats().partialFillRate < 0.3) return false;

  for (let i = 0; i < 5; i += 1) {
    engine.recordExecutionEvent(`reject${i}`, 'BTCUSDT', 'reject', 1, 0);
  }
  if (engine.getGuards().execution.getExecutionStats().rejectRate < 0.2) return false;

  return engine.getRiskState() === RiskState.HALTED;
}

function testKillSwitch(): boolean {
  const engine = new InstitutionalRiskEngine({
    killSwitch: {
      latencySpikeThresholdMs: 100,
      volatilitySpikeThreshold: 0.05,
      disconnectTimeoutMs: 1_000,
      priceWindowMs: 60_000,
      autoClosePositions: true,
      alertChannels: ['webhook'],
    },
  });
  engine.initialize(10_000);

  const ts = Date.now();
  for (let i = 0; i < 5; i += 1) {
    engine.recordLatency(200, ts + i);
  }
  if (engine.getRiskState() !== RiskState.KILL_SWITCH) return false;

  engine.reset();
  engine.initialize(10_000);
  engine.recordPrice('BTCUSDT', 50_000, ts + 100);
  engine.recordPrice('BTCUSDT', 53_000, ts + 101);
  return engine.getRiskState() === RiskState.KILL_SWITCH;
}

function testStateMachineTransitions(): boolean {
  const engine = new InstitutionalRiskEngine();
  engine.initialize(10_000);
  if (engine.getRiskState() !== RiskState.TRACKING) return false;

  const ts = Date.now();
  engine.getGuards().consecutiveLoss.recordTrade({ timestamp: ts, symbol: 'BTCUSDT', pnl: -100, quantity: 1 });
  engine.getGuards().consecutiveLoss.recordTrade({ timestamp: ts + 1, symbol: 'BTCUSDT', pnl: -100, quantity: 1 });
  engine.getGuards().consecutiveLoss.recordTrade({ timestamp: ts + 2, symbol: 'BTCUSDT', pnl: -100, quantity: 1 });
  if (engine.getPositionMultiplier() >= 1) return false;

  engine.getGuards().drawdown.initialize(10_000);
  engine.updateEquity(8_500);
  if (engine.getRiskState() !== RiskState.HALTED) return false;

  engine.activateKillSwitch('manual_test');
  return engine.getRiskState() === RiskState.KILL_SWITCH;
}

function testAutoRecovery(): boolean {
  const baseTs = Date.now();
  const engine = new InstitutionalRiskEngine({
    consecutiveLoss: {
      maxConsecutiveLosses: 3,
      lossWindowMs: 200,
      minLossAmount: 1,
      resetAfterWin: true,
      reducedRiskThreshold: 2,
      reducedRiskMultiplier: 0.5,
    },
    autoRecovery: {
      enabled: true,
      haltedStableMs: 1000,
      reducedStableMs: 1000,
      haltedExecutionHeadroom: 1,
      reducedExecutionHeadroom: 1,
      haltedNotionalUtilization: 1,
      haltedLeverageUtilization: 1,
      reducedNotionalUtilization: 1,
      reducedLeverageUtilization: 1,
      maxHeartbeatAgeMs: 60_000,
    },
  });
  engine.initialize(10_000);

  engine.recordHeartbeat(baseTs);
  engine.recordTradeResult('BTCUSDT', -100, 1, baseTs + 1);
  engine.recordTradeResult('BTCUSDT', -120, 1, baseTs + 2);
  engine.recordTradeResult('BTCUSDT', -140, 1, baseTs + 3);
  if (engine.getRiskState() !== RiskState.HALTED) return false;

  // Before loss-window expiry there should be no recovery.
  let recovery = engine.evaluateAutoRecovery(baseTs + 150);
  if (recovery.transitioned) return false;
  if (engine.getRiskState() !== RiskState.HALTED) return false;

  // Once the loss window expires, recovery can start and then step down via hysteresis windows.
  engine.recordHeartbeat(baseTs + 210);
  recovery = engine.evaluateAutoRecovery(baseTs + 210);
  if (recovery.transitioned) return false;
  if (engine.getRiskState() !== RiskState.HALTED) return false;

  engine.recordHeartbeat(baseTs + 1_250);
  recovery = engine.evaluateAutoRecovery(baseTs + 1_250);
  if (!recovery.transitioned) return false;
  if (engine.getRiskState() !== RiskState.REDUCED_RISK) return false;

  engine.recordHeartbeat(baseTs + 1_300);
  recovery = engine.evaluateAutoRecovery(baseTs + 1_300);
  if (recovery.transitioned) return false;
  if (engine.getRiskState() !== RiskState.REDUCED_RISK) return false;

  engine.recordHeartbeat(baseTs + 2_350);
  recovery = engine.evaluateAutoRecovery(baseTs + 2_350);
  if (!recovery.transitioned) return false;

  engine.stop();
  return engine.getRiskState() === RiskState.TRACKING;
}

async function main(): Promise<void> {
  const tests: Array<{ name: string; run: () => boolean }> = [
    { name: 'Position Limits (R1-R4)', run: testPositionLimits },
    { name: 'Drawdown Limits (R5-R8)', run: testDrawdownLimits },
    { name: 'Consecutive Losses (R9-R12)', run: testConsecutiveLosses },
    { name: 'Multi-symbol Exposure (R13-R15)', run: testMultiSymbolExposure },
    { name: 'Execution Failures (R16-R18)', run: testExecutionFailures },
    { name: 'Kill Switch (R19-R20)', run: testKillSwitch },
    { name: 'State Machine', run: testStateMachineTransitions },
    { name: 'Auto Recovery (HALTED -> REDUCED -> TRACKING)', run: testAutoRecovery },
  ];

  let passed = 0;
  for (const test of tests) {
    let ok = false;
    try {
      ok = test.run();
    } catch (error) {
      logCase(test.name, false, String(error));
      continue;
    }
    if (ok) passed += 1;
    logCase(test.name, ok);
  }

  const failed = tests.length - passed;
  console.log(`SUMMARY | passed=${passed} failed=${failed} total=${tests.length}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAILED_TO_RUN | ${String(error)}`);
  process.exit(1);
});
