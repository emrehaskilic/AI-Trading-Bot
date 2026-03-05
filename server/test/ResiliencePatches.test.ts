import assert from 'node:assert/strict';
import { ResiliencePatches } from '../risk/ResiliencePatches';

class FakeRiskEngine {
  public killSwitchReasons: string[] = [];

  activateKillSwitch(reason: string): void {
    this.killSwitchReasons.push(reason);
  }

  getStateManager(): { transition: () => void } {
    return {
      transition: () => {
        // No-op in test.
      },
    };
  }
}

function createPatches(autoKillSwitch: boolean): ResiliencePatches {
  return new ResiliencePatches({
    enableAll: true,
    autoKillSwitch,
    autoHalt: false,
    latency: {
      p95ThresholdMs: 1,
      p99ThresholdMs: 1,
      eventLoopLagThresholdMs: 1,
      sampleWindowSize: 32,
      consecutiveViolations: 1,
      cooldownMs: 250,
      enableKillSwitch: true,
      killSwitchAfterViolations: 1,
    },
  });
}

export function runTests(): void {
  const now = Date.now();

  const riskOff = new FakeRiskEngine();
  const patchesOff = createPatches(false);
  patchesOff.initialize(riskOff as any);
  patchesOff.recordLatency(25, now, 'processing');
  patchesOff.stop();
  assert.equal(riskOff.killSwitchReasons.length, 0, 'kill-switch must remain inactive when autoKillSwitch=false');

  const riskOn = new FakeRiskEngine();
  const patchesOn = createPatches(true);
  patchesOn.initialize(riskOn as any);
  patchesOn.recordLatency(25, now + 1, 'processing');
  patchesOn.stop();
  assert.ok(riskOn.killSwitchReasons.length >= 1, 'kill-switch should trigger when autoKillSwitch=true and threshold is violated');
}
