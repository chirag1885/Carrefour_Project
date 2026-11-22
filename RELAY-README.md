# WI-3 PostgreSQL outbox relay

Copy these files into the root of Carrefour_Project. The bundle is based on main commit 98f809a. Apply the migration before starting the relay. If 20261122_002 is already assigned on your branch, rename the new file to the next available migration number before applying it.

```bash
make up
make migrate
docker compose -f docker-compose.yml -f docker-compose.relay.yml up -d --build relay
curl -fsS http://localhost:9464/healthz
curl -fsS http://localhost:9464/metrics
```

Run the isolated worker tests from the repository root.

```bash
npm --prefix apps/worker ci
npm --prefix apps/worker test
```

For local execution with Node and the existing Compose infrastructure, run the build and then `npm --prefix apps/worker run start:relay`. The worker reads the repository-root `.env`. It defaults to the broker on `localhost:19092`. The Compose overlay uses `redpanda:9092`. Both expose health and metrics on port 9464 by default.

| Setting | Default |
|---|---|
| RELAY_BATCH_SIZE | 500 |
| RELAY_POLL_MS | 200 |
| RELAY_PUBLISH_TIMEOUT_MS | 10000 |
| RELAY_RETENTION_DAYS | 7 |
| RELAY_METRICS_PORT | 9464 |
| RELAY_TRANSACTIONAL_ID | wishlist-outbox-relay |

Use the same transactional ID on every relay replica for the same database. Use a distinct transactional ID for a different database if it shares the broker. Future consumers need committed-only reads.

## Verification

- Strict TypeScript build and nine unit tests passed. The tests cover message headers, message identity, timeout backoff, acknowledge-before-mark, broker failure, lost SQL session, replay, and poison records.
- An embedded PostgreSQL SQL smoke check applied the migration twice and checked legacy and new row ordering, fifth-attempt quarantine, per-topic/key isolation, and retention.
- Live Compose, two-relay failover, kill-and-restart, and Redpanda throughput remain unverified. The unit tests use doubles for the PostgreSQL client and Kafka producer.
- On the dev stack, perform a real admin price write and confirm the same UUID appears in outbox and in Redpanda, then repeat while Redpanda is stopped. After recovery, compare unique event IDs and verify published_at. Use a second one-off relay with the same transactional ID to exercise the standby path. The one-off command should omit service ports so it can run next to the primary.

The release gate for failover is a two-relay test that terminates the lock holder's PostgreSQL session while it has an active Kafka transaction. Inspect committed messages, deduplicate by event_id, and verify continuity for each topic and product.

## Recovery from quarantine

A fifth permanent failure sets failed_at. Later events for that topic and product remain pending. Other product and topic streams can still publish. Inspect last_error, repair the row and reset attempts, last_error and failed_at through an authorized maintenance procedure. Retention deletes only published rows.
