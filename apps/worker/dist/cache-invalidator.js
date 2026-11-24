"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = require("node:http");
const node_path_1 = require("node:path");
const promises_1 = require("node:timers/promises");
const kafka_javascript_1 = require("@confluentinc/kafka-javascript");
const dotenv_1 = require("dotenv");
const ioredis_1 = __importDefault(require("ioredis"));
const zod_1 = require("zod");
const outbox_1 = require("./outbox");
const invalidation_1 = require("./invalidation");
(0, dotenv_1.config)({ path: (0, node_path_1.resolve)(__dirname, '../../../.env'), quiet: true });
const port = (fallback) => zod_1.z.coerce.number().int().min(1).max(65535).default(fallback);
const env = zod_1.z.object({
    KAFKA_BROKERS: zod_1.z.string().min(1).default('localhost:19092'),
    REDIS_URL: zod_1.z.string().min(1).optional(),
    REDIS_HOST: zod_1.z.string().min(1).default('127.0.0.1'),
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
    ? new ioredis_1.default(env.REDIS_URL, redisOptions)
    : new ioredis_1.default({ host: env.REDIS_HOST, port: env.REDIS_PORT, ...redisOptions });
redis.on('error', () => undefined);
const shutdown = new AbortController();
process.once('SIGTERM', () => shutdown.abort());
process.once('SIGINT', () => shutdown.abort());
const stopOnSignal = (signal) => (0, promises_1.setTimeout)(2 ** 31 - 1, undefined, { signal }).catch(() => undefined);
const kafka = new kafka_javascript_1.KafkaJS.Kafka({ 'bootstrap.servers': env.KAFKA_BROKERS });
const counters = new Map();
let invalidations = 0;
let consumerStarted = false;
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
function count(topic, result) {
    const labels = `group="${invalidation_1.INVALIDATOR_GROUP}",topic="${topic}",result="${result}"`;
    counters.set(labels, (counters.get(labels) ?? 0) + 1);
}
const server = (0, node_http_1.createServer)((req, res) => {
    if (req.url === '/healthz') {
        const ready = consumerStarted && redis.status === 'ready';
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready }));
    }
    else if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end([
            `cache_invalidations_total ${invalidations}`,
            ...Array.from(counters, ([labels, value]) => `consumer_messages_total{${labels}} ${value}`),
            '',
        ].join('\n'));
    }
    else {
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
            'group.id': invalidation_1.INVALIDATOR_GROUP,
            'enable.auto.commit': false,
            'auto.offset.reset': 'earliest',
            'isolation.level': 'read_committed',
            'allow.auto.create.topics': false,
            'socket.timeout.ms': 10_000,
        });
        try {
            await consumer.connect();
            if (session.signal.aborted)
                continue;
            await consumer.subscribe({ topics: invalidation_1.INVALIDATION_TOPICS });
            await consumer.run({
                partitionsConsumedConcurrently: 4,
                eachMessage: async ({ topic, partition, message, pause }) => {
                    const offset = message.offset;
                    const key = message.key?.toString('utf8');
                    const keys = (0, invalidation_1.invalidationKeys)(topic, key, message.value?.toString('utf8'));
                    const deadline = Date.now() + 30_000;
                    try {
                        if (!keys)
                            log('invalid_cache_event', { topic, partition, offset });
                        const result = await (0, invalidation_1.processInvalidation)({
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
                                if (attempt === 1)
                                    log('cache_invalidation_retry', { topic, partition, offset, product_id: key });
                                if (Date.now() >= deadline)
                                    throw new Error('redis_retry_window_elapsed');
                                await (0, promises_1.setTimeout)((0, outbox_1.failureDelay)(250, attempt), undefined, { signal: session.signal }).catch(() => undefined);
                            },
                        });
                        if (result !== 'stopped') {
                            count(topic, result);
                            failures = 0;
                        }
                    }
                    catch {
                        count(topic, 'error');
                        log('cache_invalidator_session_restart', { topic, partition, offset });
                        session.abort();
                    }
                },
            });
            consumerStarted = true;
            await stopOnSignal(session.signal);
        }
        catch {
            log('cache_invalidator_connection_retry');
        }
        finally {
            session.abort();
            consumerStarted = false;
            await consumer.disconnect().catch(() => undefined);
            shutdown.signal.removeEventListener('abort', abortSession);
        }
        await (0, promises_1.setTimeout)((0, outbox_1.failureDelay)(250, ++failures), undefined, { signal: shutdown.signal }).catch(() => undefined);
    }
}
server.listen(env.INVALIDATOR_METRICS_PORT, '0.0.0.0');
void run().finally(() => {
    redis.disconnect();
    server.close();
});
