# ADR 0003 — TimescaleDB (and pgvector) inside PostgreSQL

- **Status:** Accepted
- **Date:** 2026-11-21
- **Deciders:** Phase 1 platform team

## Context

Price history is append-only and grows without bound (products × changes × 12 months of backfill,
plus a live event feed). Charts need "last 7/30/90 days" queries, which would be slow and expensive
if they scanned one giant table. Similar-product search needs vector similarity. We also need the
transactional outbox and all relational integrity in the same database as the catalogue. Operating a
separate time-series DB and a separate vector DB would triple the local stack and split transactions.

## Decision

Use PostgreSQL 16 with the **TimescaleDB** extension for `price_history` and `analytics_events`
hypertables, plus **pgvector** for `products.embedding VECTOR(384)`:

- `price_history` is a hypertable partitioned by `recorded_at` with 7-day chunks, a
  `(product_id, recorded_at DESC)` index, columnar compression after 30 days, and the `price_daily`
  continuous aggregate (refresh policy: 3-day start offset, 1-hour end offset, every 15 minutes).
- `analytics_events` is a hypertable partitioned by `occurred_at`.
- HNSW index on `products.embedding` for cosine-similarity searches.
- `pg_trgm` GIN index on `products.name_en` for fuzzy search; `citext` for case-insensitive emails.
- The development image supplies the extensions. Record schema changes in a new
  `YYYYMMDD_NNN_description.sql` migration after the baseline has been applied.

## Consequences

**Positive**

- One datastore to operate locally and in production; time-series queries can still JOIN products.
- Continuous aggregate gives a read/write separation (raw rows for writes, `price_daily` for charts)
  without a CQRS service.
- Compression reduces long-term storage; HNSW keeps vector search fast enough at ~50k products.

**Negative / accepted risks**

- The `timescale/timescaledb-ha:pg16` image is larger than plain Postgres; if it fails, the fallback
  is a custom image based on `timescale/timescaledb:latest-pg16` with pgvector installed.
- Continuous aggregates are eventually consistent up to the refresh window, so "last hour" charts
  read raw `price_history` instead.
- Price history is append-only in the application. Compression reduces storage for older chunks.

## Alternatives rejected

- **InfluxDB / ClickHouse:** another datastore to run, no transactional JOINs with the catalogue.
- **Dedicated vector DB:** unnecessary at prototype scale; revisit at millions of SKUs (section 19).
- **Plain Postgres partitioned tables:** would require hand-written rollups and retention jobs.
