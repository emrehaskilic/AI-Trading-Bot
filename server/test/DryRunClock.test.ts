import { DryRunClock } from '../dryrun/DryRunClock';

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

export function runTests() {
  {
    const clock = new DryRunClock();
    const now = clock.now();
    assert(now === 1, 'default clock should return 1 when uninitialized');
  }

  {
    const clock = new DryRunClock();
    clock.set(1234.56);
    assert(clock.now() === 1234, 'clock should truncate timestamp');
    clock.set(-5);
    assert(clock.now() === 1234, 'invalid set should not overwrite timestamp');
  }
}
