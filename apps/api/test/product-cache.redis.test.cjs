const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');
const test = require('node:test');
const Redis = require('ioredis').default;
const url = process.env.WI4_REDIS_TEST_URL;
process.env.JWT_SECRET ??= 'local-wi4-cache-tests-only';

async function withCache(t, callback) {
  const { ProductCacheService } = require('../dist/catalogue/product-cache.service.js');
  const client = new Redis(url);
  const service = new ProductCacheService({ client });
  const id = String(randomInt(1_000_000_000, 9_000_000_000));
  const keys = [`product:${id}`, `pstats:${id}`, `lock:product:${id}`];
  t.after(async () => {
    service.onModuleDestroy();
    try { await client.del(...keys); } finally { client.disconnect(); }
  });
  await client.ping();
  await new Promise((resolve, reject) => {
    if (service.redis.status === 'ready') resolve();
    else {
      service.redis.once('ready', resolve);
      service.redis.once('error', reject);
    }
  });
  return callback(service, client, id, keys);
}

test('cache hit, TTL jitter, and stale fill cannot overwrite a post-invalidation fill',
  { skip: !url, timeout: 10000 }, async (t) => withCache(t, async (cache, redis, id, keys) => {
    let unblock;
    let acquired;
    const resume = new Promise((resolve) => { unblock = resolve; });
    const started = new Promise((resolve) => { acquired = resolve; });
    const old = cache.get(id, async () => { acquired(); await resume; return { current_price: '3000.00' }; });
    await started;

    await redis.set(keys[1], 'old stats');
    await redis.del(...keys);
    await cache.get(id, async () => ({ current_price: '2500.00' }));
    unblock();
    await old;

    assert.deepEqual(await cache.get(id, async () => assert.fail('expected a cache hit')), {
      current_price: '2500.00',
    });
    assert.equal(await redis.get(keys[1]), null);
    const ttl = await redis.ttl(keys[0]);
    assert.ok(ttl >= 299 && ttl <= 360);
  }));

test('missing products are negatively cached for 30 seconds',
  { skip: !url, timeout: 10000 }, async (t) => withCache(t, async (cache, redis, id, keys) => {
    assert.equal(await cache.get(id, async () => null), null);
    assert.equal(await cache.get(id, async () => assert.fail('expected negative-cache hit')), null);
    const ttl = await redis.ttl(keys[0]);
    assert.ok(ttl >= 29 && ttl <= 30);
  }));
