import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import { config as loadEnv } from 'dotenv';
import Redis from 'ioredis';
import { z } from 'zod';
import { failureDelay } from './outbox';
import { INVALIDATION_TOPICS, INVALIDATOR_GROUP, invalidationKeys, processInvalidation } from './invalidation';

loadEnv({ path: resolve(__dirname, '../../../.env'), quiet: true });

const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);
const env = z.object({
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),
  REDIS_URL: z.string().min(1).optional(),
  REDIS_HOST: z.string().min(1).default('127.0.0.1'),
  REDIS_PORT: port(6379),
  INVALIDATOR_METRICS_PORT: port(9465),
}).parse(process.env);

const redisOptions = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  commandTimeout: 1000,
  connectTimeout: 2000,
};
const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, redisOptions)
  : new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT, ...redisOptions });
redis.on('error', () => undefined);

const shutdown = new AbortController();
process.once('SIGTERM', () => shutdown.abort());
process.once('SIGINT', () => shutdown.abort());
const stopOnSignal = (signal: AbortSignal) =>
  sleep(2 ** 31 - 1, undefined, { signal }).catch(() => undefined);
const kafka = new KafkaJS.Kafka({ 'bootstrap.servers': env.KAFKA_BROKERS });
const counters = new Map<string, number>();
let invalidations = 0;
let consumerStarted = false;
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...fields }));

function count(topic: string, result: string) {
  const labels = `group="${INVALIDATOR_GROUP}",topic="${topic}",result="${result}"`;
  counters.set(labels, (counters.get(labels) ?? 0) + 1);
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    const ready = consumerStarted && redis.status === 'ready';
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end([
      `cache_invalidations_total ${invalidations}`,
      ...Array.from(counters, ([labels, value]) => `consumer_messages_total{${labels}} ${value}`),
      '',
    ].join('\n'));
  } else {
    res.writeHead(404).end();
  }
});

async function run() {
  let failures = 0;
  while (!shutdown.signal.aborted) {
    const session = new AbortController();
    const abortSession = () => session.abort();
    shutdown.signal.addEventListener('abort', abortSession, { once: true });

    const consumer = kafka.consumer({
      'group.id': INVALIDATOR_GROUP,
      'enable.auto.commit': false,
      'auto.offset.reset': 'earliest',
      'isolation.level': 'read_committed',
      'allow.auto.create.topics': false,
      'socket.timeout.ms': 10_000,
    });

    try {
      await consumer.connect();
      if (session.signal.aborted) continue;
      await consumer.subscribe({ topics: INVALIDATION_TOPICS });
      await consumer.run({
        partitionsConsumedConcurrently: 4,
        eachMessage: async ({ topic, partition, message, pause }) => {
          const offset = message.offset;
          const key = message.key?.toString('utf8');
          const keys = invalidationKeys(topic, key, message.value?.toString('utf8'));
          const deadline = Date.now() + 30_000;

          try {
            if (!keys) log('invalid_cache_event', { topic, partition, offset });
            const result = await processInvalidation({
              keys,
              signal: session.signal,
              invalidate: async (names) => {
                // One atomic DEL revokes in-flight cache writers and clears both cached values.
                await redis.del(...names);
                invalidations++;
              },
              commit: () => consumer.commitOffsets([{ topic, partition, offset: (BigInt(offset) + 1n).toString() }]),
              pause,
              wait: async (attempt) => {
                count(topic, 'redis_retry');
                if (attempt === 1) log('cache_invalidation_retry', { topic, partition, offset, product_id: key });
                if (Date.now() >= deadline) throw new Error('redis_retry_window_elapsed');
                await sleep(failureDelay(250, attempt), undefined, { signal: session.signal }).catch(() => undefined);
              },
            });
            if (result !== 'stopped') {
              count(topic, result);
              failures = 0;
            }
          } catch {
            count(topic, 'error');
            log('cache_invalidator_session_restart', { topic, partition, offset });
            session.abort();
          }
        },
      });
      consumerStarted = true;
      await stopOnSignal(session.signal);
    } catch {
      log('cache_invalidator_connection_retry');
    } finally {
      session.abort();
      consumerStarted = false;
      await consumer.disconnect().catch(() => undefined);
      shutdown.signal.removeEventListener('abort', abortSession);
    }
    await sleep(failureDelay(250, ++failures), undefined, { signal: shutdown.signal }).catch(() => undefined);
  }
}

server.listen(env.INVALIDATOR_METRICS_PORT, '0.0.0.0');
void run().finally(() => {
  redis.disconnect();
  server.close();
});
