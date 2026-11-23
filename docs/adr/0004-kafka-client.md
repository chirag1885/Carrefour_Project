# ADR 0004 — Kafka client choice for the outbox relay and consumers

**Status:** Accepted  
**Date:** 2026-11-22  
**Deciders:** chirag1885  

## Context

WI-3 needed a Kafka/Redpanda client for the outbox relay and cache-invalidation consumer.
The two most prominent Node.js clients were evaluated:

| | `kafkajs` | `@confluentinc/kafka-javascript` |
|---|---|---|
| Last meaningful release | 2022 | Active (Confluent-maintained) |
| Transactional producer | Yes (limited) | Yes (full librdkafka semantics) |
| `isolation.level: read_committed` | Partial | Full |
| Binary size | Pure JS (~500 KB) | Native + librdkafka (~40 MB) |
| Browser support | Yes | No |

## Decision

Use `@confluentinc/kafka-javascript` (librdkafka bindings, Confluent-maintained).

## Rationale

The outbox relay uses a Kafka transactional producer (`acks=all`, idempotent, fenced
transactional id). The cache-invalidation consumer uses `isolation.level: read_committed`
so it only sees events after the relay's Kafka transaction commits. Both features require
correct librdkafka semantics. `kafkajs` has open issues with these features and its
last substantive maintenance commit was in 2022.

The 40 MB binary is acceptable for a backend worker image and irrelevant to the API.

## Consequences

- The worker Dockerfile must include the librdkafka build dependencies (already handled).
- No browser-side Kafka usage (not needed in this project).
- If Confluent deprecates the client, the most likely migration target is `node-rdkafka`
  (also librdkafka-based), which shares the same API shape.
