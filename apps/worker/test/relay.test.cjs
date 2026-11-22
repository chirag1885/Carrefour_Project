const assert = require('node:assert/strict');
const test = require('node:test');
const { failureDelay, toMessage } = require('../dist/outbox.js');
const { relayBatch } = require('../dist/relay.js');

function price(n) {
  const id = `00000000-0000-4000-8000-00000000000${n}`;
  return {
    id, key: '42', topic: 'price.changed',
    payload: {
      event_id: id, event_type: 'price.changed', schema_version: 1,
      occurred_at: '2026-11-22T10:15:30.123456Z',
      product_id: 42, sku: 'LAPTOP', old_price: 3000 - n * 100, new_price: 2900 - n * 100,
      currency: 'AED', source: 'admin',
    },
  };
}

function harness(rows) {
  const calls = [];
  const client = {
    async query(sql, args) {
      if (sql.includes('FOR UPDATE OF o')) return { rows };
      if (sql.includes('RETURNING attempts')) {
        calls.push(['attempt', ...args]);
        return { rows: [{ attempts: 5 }] };
      }
      if (sql.startsWith('UPDATE')) calls.push(['publish', ...args[0]]);
      else calls.push(sql);
      return { rows: [] };
    },
  };
  const producer = {
    async transaction() { calls.push('broker begin'); },
    async send(message) { calls.push(message.messages[0].headers.event_id); },
    async commit() { calls.push('broker commit'); },
    async abort() { calls.push('broker abort'); },
  };
  return { calls, client, producer };
}

test('validates the envelope, routing key, topic and event ID', () => {
  const row = price(1);
  assert.equal(toMessage(row).messages[0].headers.event_id, row.id);
  assert.equal(toMessage({ ...row, key: '43' }), null);
  assert.equal(toMessage({ ...row, topic: 'stock.changed' }), null);
  assert.equal(toMessage({ ...row, payload: { ...row.payload, schema_version: 2 } }), null);
});

test('also accepts the current admin stock event shape', () => {
  const { id, key, payload } = price(1);
  const stock = {
    id, key, topic: 'stock.changed',
    payload: {
      event_id: id, event_type: 'stock.changed', schema_version: 1,
      occurred_at: payload.occurred_at, product_id: 42, store_id: 1, old_qty: 0, new_qty: 5,
    },
  };
  assert.equal(toMessage(stock).messages[0].headers.event_type, 'stock.changed');
});

test('backoff grows, is bounded and includes jitter', () => {
  assert.equal(failureDelay(200, 1, () => 0), 100);
  assert.equal(failureDelay(200, 2, () => 1), 400);
  assert.equal(failureDelay(200, 100, () => 1), 30000);
});

test('publishes in selection order and marks rows only after broker commit', async () => {
  const a = price(1), b = price(2);
  const { calls, client, producer } = harness([a, b]);
  assert.equal(await relayBatch(client, producer, () => {}), 2);
  assert.deepEqual(calls, ['BEGIN', 'broker begin', a.id, b.id, 'SELECT 1',
    'broker commit', ['publish', a.id, b.id], 'COMMIT']);
});

test('broker outage aborts and rolls back without marking rows or counting a row attempt', async () => {
  const { calls, client, producer } = harness([price(1)]);
  producer.send = async () => { throw new Error('broker unavailable'); };
  await assert.rejects(relayBatch(client, producer, () => {}), /broker unavailable/);
  assert.deepEqual(calls, ['BEGIN', 'broker begin', 'broker abort', 'ROLLBACK']);
});

test('replay after a failed SQL acknowledgement reuses the same event ID', async () => {
  const row = price(1);
  const { calls, client, producer } = harness([row]);
  const query = client.query;
  client.query = async (sql, args) => {
    if (sql.startsWith('UPDATE')) throw new Error('SQL session lost');
    return query(sql, args);
  };
  await assert.rejects(relayBatch(client, producer, () => {}), /SQL session lost/);
  assert.ok(calls.includes('broker commit'));
  client.query = query;
  await relayBatch(client, producer, () => {});
  assert.equal(calls.filter((call) => call === row.id).length, 2);
});

test('lost ownership after send aborts before broker commit', async () => {
  const row = price(1);
  const { calls, client, producer } = harness([row]);
  await assert.rejects(relayBatch(client, producer, () => {
    if (calls.includes(row.id)) throw new Error('lost lock');
  }), /lost lock/);
  assert.deepEqual(calls, ['BEGIN', 'broker begin', row.id, 'broker abort', 'ROLLBACK']);
});

test('an oversized broker record commits only the attributed failure attempt', async () => {
  const row = price(1);
  const { calls, client, producer } = harness([row]);
  producer.send = async () => { throw Object.assign(new Error('oversized'), { code: 10 }); };
  assert.equal(await relayBatch(client, producer, () => {}), -1);
  assert.deepEqual(calls, ['BEGIN', 'broker begin', 'broker abort',
    ['attempt', row.id, 'message_too_large'], 'COMMIT']);
});

test('malformed payload records a poison attempt without opening a broker transaction', async () => {
  const row = { ...price(1), payload: {} };
  const { calls, client, producer } = harness([row]);
  assert.equal(await relayBatch(client, producer, () => {}), -1);
  assert.deepEqual(calls, ['BEGIN', ['attempt', row.id, 'invalid_outbox_payload'], 'COMMIT']);
});
