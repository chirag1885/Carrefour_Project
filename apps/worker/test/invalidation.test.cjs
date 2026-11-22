const assert = require('node:assert/strict');
const test = require('node:test');
const { invalidationKeys, processInvalidation } = require('../dist/invalidation.js');

const event = {
  event_id: '00000000-0000-4000-8000-000000000001', event_type: 'stock.changed',
  schema_version: 1, occurred_at: '2026-11-22T16:15:00.123456Z', product_id: 42,
  store_id: 1, old_qty: 0, new_qty: 5,
};
const keys = ['product:42', 'pstats:42', 'lock:product:42'];

test('validates the event version and routing, and invalidates the fill lock too', () => {
  assert.deepEqual(invalidationKeys('stock.changed', '42', JSON.stringify(event)), keys);
  assert.equal(invalidationKeys('stock.changed', '43', JSON.stringify(event)), null);
  assert.equal(invalidationKeys('price.changed', '42', JSON.stringify(event)), null);
  assert.equal(invalidationKeys('stock.changed', '42', '{'), null);
  assert.equal(invalidationKeys('stock.changed', '42', JSON.stringify({ ...event, schema_version: 2 })), null);
});

test('Redis failure pauses and retries before committing', async () => {
  const calls = [];
  const result = await processInvalidation({
    keys, signal: new AbortController().signal,
    invalidate: async (names) => {
      assert.deepEqual(names, keys);
      calls.push('delete');
      if (calls.length === 1) throw new Error('Redis unavailable');
    },
    pause: () => { calls.push('pause'); return () => calls.push('resume'); },
    wait: async () => { calls.push('wait'); },
    commit: async () => { calls.push('commit'); },
  });
  assert.equal(result, 'success');
  assert.deepEqual(calls, ['delete', 'pause', 'wait', 'delete', 'commit', 'resume']);
});

test('shutdown during a Redis outage leaves the offset uncommitted', async () => {
  const controller = new AbortController();
  const result = await processInvalidation({
    keys, signal: controller.signal,
    invalidate: async () => { throw new Error('Redis unavailable'); },
    pause: () => () => {},
    wait: async () => controller.abort(),
    commit: async () => assert.fail('must not commit'),
  });
  assert.equal(result, 'stopped');
});

test('invalid data is skipped and its offset is committed', async () => {
  let committed = 0;
  const result = await processInvalidation({
    keys: null, signal: new AbortController().signal,
    invalidate: async () => assert.fail('must not delete'),
    pause: () => () => {}, wait: async () => {},
    commit: async () => { committed++; },
  });
  assert.equal(result, 'invalid');
  assert.equal(committed, 1);
});

test('an offset commit failure reaches the worker so it can reconnect and replay', async () => {
  await assert.rejects(processInvalidation({
    keys, signal: new AbortController().signal,
    invalidate: async () => {}, pause: () => () => {}, wait: async () => {},
    commit: async () => { throw new Error('commit failed'); },
  }), /commit failed/);
});
