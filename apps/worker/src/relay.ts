import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { z } from 'zod';
import { failureDelay, MARK_FAILED, RETAIN, TAKE_BATCH, toMessage } from './outbox';
import type { OutboxRow } from './outbox';

loadEnv({ path: resolve(__dirname, '../../../.env'), quiet: true });

const int = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const env = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: int(1, 65535, 5432),
  POSTGRES_USER: z.string().default('wishlist'),
  POSTGRES_DB: z.string().default('wishlist'),
  POSTGRES_PASSWORD: z.string().optional(),
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),
  RELAY_TRANSACTIONAL_ID: z.string().min(1).default('wishlist-outbox-relay'),
  RELAY_BATCH_SIZE: int(1, 1000, 500),
  RELAY_POLL_MS: int(10, 1000, 200),
  RELAY_PUBLISH_TIMEOUT_MS: int(1000, 60_000, 10_000),
  RELAY_RETENTION_DAYS: int(1, 365, 7),
  RELAY_METRICS_PORT: int(1, 65535, 9464),
}).parse(process.env);

const stop = new AbortController();
let active = false;
let ready = false;
const metrics = {
  outbox_oldest_unpublished_age_seconds: 0,
  outbox_published_total: 0,
  outbox_publish_errors_total: 0,
  outbox_batch_size: 0,
  outbox_quarantined_total: 0,
};
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...fields }));

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready, active }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(Object.entries(metrics).map(([key, value]) => `${key} ${value}\n`).join(''));
  } else {
    res.writeHead(404).end();
  }
});

const kafka = new KafkaJS.Kafka({
  'bootstrap.servers': env.KAFKA_BROKERS,
});
const createProducer = () => kafka.producer({
  'transactional.id': env.RELAY_TRANSACTIONAL_ID,
  'enable.idempotence': true,
  'acks': -1,
  'compression.type': 'zstd',
  'linger.ms': 5,
  'message.timeout.ms': env.RELAY_PUBLISH_TIMEOUT_MS,
  'transaction.timeout.ms': Math.max(30_000, 2 * env.RELAY_PUBLISH_TIMEOUT_MS),
  'socket.timeout.ms': env.RELAY_PUBLISH_TIMEOUT_MS,
  'allow.auto.create.topics': false,
});
type Producer = ReturnType<typeof createProducer>;

const kafkaError = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { type, code } = error as { type?: unknown; code?: unknown };
  if (typeof type === 'string' && /^[A-Z0-9_]+$/.test(type)) return type;
  return typeof code === 'number' ? String(code) : 'unknown';
};

async function countFailure(client: Client, row: OutboxRow, reason: string) {
  const result = await client.query<{ attempts: number }>(MARK_FAILED, [row.id, reason]);
  const attempts = result.rows[0].attempts;
  return () => {
    metrics.outbox_publish_errors_total++;
    if (attempts >= 5) metrics.outbox_quarantined_total++;
    log(attempts >= 5 ? 'outbox_quarantined' : 'outbox_row_failed', {
      event_id: row.id, product_id: row.key, topic: row.topic, attempts, reason,
    });
  };
}

export async function relayBatch(client: Client, producer: Producer, assertOwnership: () => void) {
  await client.query('BEGIN');
  let brokerTransaction = false;
  try {
    const { rows } = await client.query<OutboxRow>(TAKE_BATCH, [env.RELAY_BATCH_SIZE]);
    const messages = [];
    for (const row of rows) {
      const message = toMessage(row);
      if (!message) {
        // Publish the valid prefix first so an invalid row cannot be overtaken.
        if (messages.length) break;
        const report = await countFailure(client, row, 'invalid_outbox_payload');
        await client.query('COMMIT');
        report();
        return -1;
      }
      messages.push(message);
    }
    if (messages.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    assertOwnership();
    await producer.transaction();
    brokerTransaction = true;
    assertOwnership();
    const results = await Promise.allSettled(messages.map((message) => producer.send(message)));
    assertOwnership();

    const rejected = results.findIndex((result) => result.status === 'rejected');
    if (rejected !== -1) {
      const failure = results[rejected] as PromiseRejectedResult;
      const code = kafkaError(failure.reason);
      await producer.abort();
      brokerTransaction = false;
      // Unknown topics can be a provisioning outage. Only quarantine definite row errors.
      if (['10', 'MSG_SIZE_TOO_LARGE', 'MESSAGE_TOO_LARGE', 'ERR_MSG_SIZE_TOO_LARGE'].includes(code)) {
        const report = await countFailure(client, rows[rejected], 'message_too_large');
        await client.query('COMMIT');
        report();
        return -1;
      }
      throw failure.reason;
    }

    // Round-trip on the session holding the advisory lock before making the batch visible.
    await client.query('SELECT 1');
    assertOwnership();
    await producer.commit();
    brokerTransaction = false;

    // A crash between the two commits can replay the same event IDs. Delivery is at-least-once.
    const ids = rows.slice(0, messages.length).map(({ id }) => id);
    await client.query('UPDATE outbox_events SET published_at = clock_timestamp() WHERE id = ANY($1::uuid[])', [ids]);
    await client.query('COMMIT');
    metrics.outbox_published_total += ids.length;
    return ids.length;
  } catch (error) {
    if (brokerTransaction) await producer.abort().catch(() => undefined);
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

const wait = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => undefined);

async function updateLag(client: Client) {
  const stats = await client.query<{ age: number }>(`
    SELECT coalesce(greatest(0, extract(epoch FROM now() - min(created_at))), 0)::float8 AS age
    FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL
  `);
  metrics.outbox_oldest_unpublished_age_seconds = stats.rows[0].age;
}

async function run() {
  let failures = 0;
  let nextRetention = 0;
  while (!stop.signal.aborted) {
    const client = new Client({
      ...(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
        host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
        database: env.POSTGRES_DB, password: env.POSTGRES_PASSWORD,
      }),
      connectionTimeoutMillis: 5000,
      query_timeout: 10_000,
      keepAlive: true,
      application_name: 'carrefour-outbox-relay',
    });
    let lost = false;
    client.on('error', () => {
      lost = true;
      ready = false;
    });
    const assertOwnership = () => {
      if (lost) throw new Error('relay_lock_session_lost');
    };
    let producer: Producer | undefined;
    let delay = env.RELAY_POLL_MS;
    try {
      await client.connect();
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(18496, 3) AS acquired',
      );
      active = lock.rows[0].acquired;
      ready = !active;
      if (active) {
        await updateLag(client);
        // Use the same transactional ID on every replica so a replacement fences its predecessor.
        producer = createProducer();
        await producer.connect();
        let idle = env.RELAY_POLL_MS;
        let nextGauge = 0;
        while (!stop.signal.aborted) {
          assertOwnership();
          const now = Date.now();
          if (now >= nextGauge) {
            await updateLag(client);
            nextGauge = now + 1000;
          }
          if (now >= nextRetention) {
            const started = Date.now();
            const deleted = await client.query(RETAIN, [env.RELAY_RETENTION_DAYS]);
            log('outbox_retention', { rows: deleted.rowCount, duration_ms: Date.now() - started });
            nextRetention = now + (deleted.rowCount === 5000 ? 1000 : 3_600_000);
          }
          const published = await relayBatch(client, producer, assertOwnership);
          ready = true;
          failures = 0;
          metrics.outbox_batch_size = Math.max(0, published);
          if (published <= 0) {
            await wait(idle);
            idle = Math.min(1000, idle * 2);
          } else {
            idle = env.RELAY_POLL_MS;
          }
        }
      }
    } catch (error) {
      ready = false;
      metrics.outbox_publish_errors_total++;
      delay = failureDelay(env.RELAY_POLL_MS, ++failures);
      log('outbox_relay_retry', { reason: kafkaError(error), delay_ms: delay });
    } finally {
      if (producer) {
        if (stop.signal.aborted && !lost) {
          await producer.flush({ timeout: env.RELAY_PUBLISH_TIMEOUT_MS }).catch(() => undefined);
        }
        await producer.disconnect().catch(() => undefined);
      }
      await client.end().catch(() => undefined);
      active = false;
    }
    await wait(delay);
  }
}

if (require.main === module) {
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  server.listen(env.RELAY_METRICS_PORT, '0.0.0.0');
  void run().finally(() => server.close());
}
