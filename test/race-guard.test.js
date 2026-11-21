import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRaceGuard, StaleOperationError, isAbortOrStaleError } from '../dist/index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('createRaceGuard - resolves latest call when multiple are in-flight', async () => {
  const safeFn = createRaceGuard(async (query, { signal }) => {
    // Artificial latency: older query takes LONGER than newer query
    const delay = query === 'first' ? 100 : 20;
    await sleep(delay);
    if (signal.aborted) throw new Error('aborted');
    return `result for ${query}`;
  });

  // Call first (takes 100ms)
  const p1 = safeFn('first');
  // Immediately call second (takes 20ms)
  const p2 = safeFn('second');

  // p1 should reject as stale or be aborted
  await assert.rejects(p1, (err) => {
    return isAbortOrStaleError(err);
  });

  // p2 should resolve successfully with the latest result
  const res2 = await p2;
  assert.equal(res2, 'result for second');
});

test('createRaceGuard - onStale: silent resolves undefined without throwing', async () => {
  const safeFn = createRaceGuard(
    async (id) => {
      await sleep(id === 1 ? 80 : 10);
      return id;
    },
    { onStale: 'silent' }
  );

  const p1 = safeFn(1);
  const p2 = safeFn(2);

  const res1 = await p1;
  const res2 = await p2;

  assert.equal(res1, undefined);
  assert.equal(res2, 2);
});

test('createRaceGuard - onSuccess callback only fires for the latest invocation', async () => {
  const successResults = [];

  const safeFn = createRaceGuard(
    async (text) => {
      await sleep(text === 'slow' ? 60 : 15);
      return text.toUpperCase();
    },
    {
      onStale: 'silent',
      onSuccess: (data) => successResults.push(data),
    }
  );

  safeFn('slow');
  safeFn('fast');

  await sleep(100);

  // Only 'FAST' should have triggered the success callback
  assert.deepEqual(successResults, ['FAST']);
});

test('createRaceGuard - manual cancellation aborts in-flight operation', async () => {
  let wasAborted = false;

  const safeFn = createRaceGuard(async (_, { signal }) => {
    signal.addEventListener('abort', () => {
      wasAborted = true;
    });
    await sleep(100);
    return 'done';
  });

  const promise = safeFn('test');
  safeFn.cancel();

  await assert.rejects(promise, (err) => isAbortOrStaleError(err));
  assert.equal(wasAborted, true);
});
