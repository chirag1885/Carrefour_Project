# ADR 0005 — Outbox relay ordering and recovery

Status proposed for WI-3.

## Ordering and failover

The relay uses one PostgreSQL session for both the advisory lock and batch transactions. Outbox inserts receive a durable sequence value. The existing admin writers insert their events while holding the product row lock, so sequence order follows their write order for that product. The migration sorts legacy rows by created_at and id once. It cannot reconstruct a different historical order if legacy timestamps already tied or ran backwards.

The Confluent client uses an idempotent, transactional Kafka producer. Replacement owners reuse the transactional ID to fence stale producer sessions. A PostgreSQL round trip precedes broker commit. Consumers read committed records. Ordering is scoped to one product in one topic with a stable partition mapping. Product ID is the Kafka key. A later sharded relay could assign products by a normalized hashtext(key) modulo N, with a separate lock and transactional ID for each shard.

The broker transaction commits first. PostgreSQL records published_at afterward. A broker commit followed by a database failure can replay the same event ID. Consumers deduplicate by event_id. Validate order on the first appearance of each unique ID.

## Failure and retention

Malformed rows and explicit broker message-too-large errors count toward a five-attempt quarantine. A temporarily unavailable or missing broker topic is retried because provisioning can recover. A quarantined row blocks later rows for that same topic and key until repair. Published rows expire after seven days by default, up to 5,000 per deletion. Backlog and retry metrics remain separate from the retention logic.

## Scope

The worker is a standalone npm package to fit the existing repository. Event validation lives with the relay until WI-0 introduces shared packages. The Kafka client is confined to the worker. The Compose overlay adds only the relay. Cache invalidation, notification consumers, and the remaining Phase 3 work are separate deliverables.
