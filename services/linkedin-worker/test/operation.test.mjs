import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SerialOperationQueue,
  WorkerOperationError,
  createOperationContext,
} from '../src/operation.mjs';

test('rejects malformed and absurd absolute deadlines', () => {
  assert.throws(
    () => createOperationContext({ deadline: 'NaN' }),
    (error) => error instanceof WorkerOperationError && error.code === 'invalid_request',
  );
  assert.throws(
    () => createOperationContext({ deadline: Date.now() + 1_000_000, maxTimeoutMs: 1_000 }),
    (error) => error instanceof WorkerOperationError && error.code === 'invalid_request',
  );
});

test('an expired deadline is distinct from client cancellation', () => {
  const context = createOperationContext({ deadline: Date.now() - 1 });
  assert.throws(
    () => context.throwIfUnavailable(),
    (error) => error.code === 'deadline_exceeded',
  );
  context.dispose();
});

test('a cancelled active item releases the serial queue for the next item', async () => {
  const queue = new SerialOperationQueue({ maxDepth: 2, waitTimeoutMs: 500 });
  const firstContext = createOperationContext({ deadline: Date.now() + 2_000 });
  const secondContext = createOperationContext({ deadline: Date.now() + 2_000 });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });

  const first = queue.enqueue(async () => {
    firstStarted();
    await firstContext.wait(1_000);
  }, { context: firstContext, operation: 'first' });
  await started;
  const second = queue.enqueue(async () => 'processed', { context: secondContext, operation: 'second' });

  firstContext.abort();
  await assert.rejects(first, (error) => error.code === 'request_cancelled');
  assert.equal(await second, 'processed');
  assert.equal(queue.health().queueDepth, 0);
  assert.equal(queue.health().activeOperation, null);

  firstContext.dispose();
  secondContext.dispose();
});

test('queue applies max depth and a typed wait timeout', async () => {
  const queue = new SerialOperationQueue({ maxDepth: 1, waitTimeoutMs: 15 });
  const activeContext = createOperationContext({ deadline: Date.now() + 2_000 });
  const waitingContext = createOperationContext({ deadline: Date.now() + 2_000 });
  const rejectedContext = createOperationContext({ deadline: Date.now() + 2_000 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const active = queue.enqueue(() => gate, { context: activeContext, operation: 'active' });
  const waiting = queue.enqueue(() => 'too-late', { context: waitingContext, operation: 'waiting' });

  assert.throws(
    () => queue.enqueue(() => undefined, { context: rejectedContext, operation: 'rejected' }),
    (error) => error.code === 'queue_full',
  );
  await assert.rejects(waiting, (error) => error.code === 'queue_timeout');
  release();
  await active;
  await queue.onIdle();

  activeContext.dispose();
  waitingContext.dispose();
  rejectedContext.dispose();
});
