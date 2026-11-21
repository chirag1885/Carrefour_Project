# ADR 0002 — Redpanda as the event log

- **Status:** Accepted
- **Date:** 2026-11-21
- **Deciders:** Phase 1 platform team

## Context

A single price change can affect 100,000 wishlisters. Doing alert creation, email and push inline in
the API request would be slow and fragile. We need a durable, replayable log with per-entity
ordering, consumer groups for horizontal scaling, lag metrics for backpressure and a browser UI for
the live demo. The team wants Kafka-compatible client code that transfers to real Kafka.

## Decision

Use **Redpanda** (Kafka API compatible) for `price.changed`, `stock.changed`, `wishlist.events`,
`alert.fanout`, `notification.requested`, the three `notification.retry.*` tiers,
`notification.dlq` and `cart.events`. Topics are created deterministically by
`scripts/init-topics.sh` on `make up` (partitions: 12 for price/stock/fan-out/notification, 6 for
wishlist/cart events, 3 for retry/DLQ). Messages are keyed by `product_id` for price/stock and by
`user_id` for notifications, giving per-entity ordering.

Producers use `acks=all`, `enable.idempotence=true` and compression; consumers commit offsets only
after successful processing. Delivery is **at-least-once**; consumers are idempotent via
`notifications.idempotency_key` (UNIQUE), Redis `SET NX` and the `processed_events` table.

## Consequences

**Positive**

- Replayable history enables backfill, debugging and safe consumer redeploys.
- Key-based ordering keeps `3000 → 2800 → 2500` in sequence for a product.
- Consumer lag is the natural backpressure signal: if SMTP is slow, messages queue in Kafka while
  the API stays responsive.
- Redpanda Console at `http://localhost:8080` makes the demo and debugging tangible.

**Negative / accepted risks**

- At-least-once delivery means duplicates are possible; every consumer must be idempotent (this is
  a hard rule, enforced in code review and tests).
- A single development broker has no replication; production uses 3+ brokers, RF=3 and rack
  awareness (section 19 of the design document).
- Operational surface (lag monitoring, DLQ drills) is part of the demo checklist.

## Alternatives rejected

- **RabbitMQ:** messages are deleted on ack (no replay) and per-key ordering is weaker.
- **Redis Streams:** less durable and lacks the Kafka ecosystem/lag tooling.
- **Postgres LISTEN/NOTIFY:** fine for tiny apps but not durable or scalable for fan-out.
