# WI-4 — Product cache and invalidation

Apply this overlay to Carrefour_Project after WI-3. It adds a catalogue cache service and changes the existing catalogue service and module. If you have since edited either catalogue file, merge its changes instead of replacing it. The included worker package and lockfile add ioredis and a start script to the WI-3 worker. Keep the WI-3 worker source, Dockerfile, migration, and Compose overlay.

```bash
make up
make migrate
docker compose -f docker-compose.yml -f docker-compose.relay.yml -f docker-compose.wi4.yml up -d --build relay cache-invalidator
curl -fsS http://localhost:9465/healthz
curl -fsS http://localhost:9465/metrics
```

Restart the NestJS API with the updated catalogue files. The new worker reads committed price.changed and stock.changed records under group cache-invalidator. It commits the next offset after deleting the keys. Invalid or unsupported events are logged and skipped. When Redis fails, it pauses and retries without committing that offset. After a bounded retry window it reconnects and resumes from the committed offset.

## Cache behavior

- The PDP caches its base product row at product:{id}. Positive entries use 300–360 seconds. Missing products use 30 seconds.
- Offers and lowest-price badges are still computed on each PDP request. The existing list and wishlist reads are unaffected. WI-4 invalidates pstats:{id} when present so the later price-stat cache can use the same event flow.
- The five-second lock is a unique token. The consumer's atomic Redis DEL removes the product, stats, and lock keys together. Lua fills the product cache only if the same token still owns the lock. A reader whose lock was revoked or expired may finish its own HTTP response, but it cannot restore stale state for later requests.
- Concurrent misses wait briefly for the lock holder. They fall back to PostgreSQL without filling the cache if the wait or Redis operation fails. Redis outages preserve API availability.
- The cache is eventually consistent between the PostgreSQL commit and event consumption. The key layout and multi-key operations assume the Redis deployment in your Compose file (one Redis server). Redis Cluster would require coordinated hash-slot keys.

## Verification commands

```bash
npm --prefix apps/api run typecheck
npm --prefix apps/api run build
npm --prefix apps/worker ci
npm --prefix apps/worker test
WI4_REDIS_TEST_URL=redis://127.0.0.1:6379 node --test apps/api/test/product-cache.redis.test.cjs
```

For the end-to-end check on your Compose stack, GET a PDP to populate product:{id}, then change that product's price through the admin API. After the relay and invalidator process the event, check that the key was deleted and GET the PDP again. It should return the changed price. Repeat with Redis stopped, then restart Redis and confirm the invalidator catches up.
