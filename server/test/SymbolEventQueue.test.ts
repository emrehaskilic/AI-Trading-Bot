function assert(condition: any, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

import { SymbolEventQueue } from '../utils/SymbolEventQueue';

export async function runTests() {
  const processed: number[] = [];
  let releaseFirst: (() => void) | null = null;

  const queue = new SymbolEventQueue('TEST', async (event: any) => {
    processed.push(Number(event.id));
    if (event.blocking) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
  }, 1000);

  queue.enqueue({ id: 1, blocking: true });
  queue.enqueue({ id: 2 });
  queue.enqueue({ id: 3 });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert(processed.length === 1 && processed[0] === 1, 'first event should start processing immediately');
  assert(queue.getQueueLength() >= 2, 'subsequent events should remain queued before reset');

  queue.reset();
  assert(queue.getQueueLength() === 0, 'reset should clear queued raw events');

  if (!releaseFirst) {
    throw new Error('expected blocking processor to be armed');
  }
  const release = releaseFirst as unknown as (() => void);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert(processed.length === 1, 'reset should prevent stale queued events from being processed after release');

  queue.enqueue({ id: 4 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert(processed[processed.length - 1] === 4, 'queue should continue processing fresh events after reset');
}
