# Smart Wishlist & Price Drop Alerts

A personalised wishlist platform for a Carrefour / MAF Retail style e-commerce experience.
Customers save products, and the system tells them, in real time, when prices drop, when items come
back in stock, when stock is running low, and what to buy instead when something is unavailable.

- **Status:** Design document v1 (frozen foundation for team review)
- **Currency:** AED · **Languages:** English + Arabic (RTL)
- **Backend reference:** TypeScript (NestJS); the design is language-agnostic (Python/FastAPI is fine).

This file replaces the original `README.md.pdf`. It is the source of truth for the schema
(section 5), the API surface (section 10) and the local setup (section 21). Related documents:

- [`docs/erd.md`](docs/erd.md) — Mermaid ERD matching the migrations
- [`docs/openapi.yaml`](docs/openapi.yaml) — OpenAPI 3 specification (frozen after merge)
- [`docs/adr/`](docs/adr/) — Architecture Decision Records
- [`DATA_SOURCES.md`](DATA_SOURCES.md) — datasets, licences and FX rates

## Table of contents

1. Problem & Goals
2. Feature List
3. Architecture
4. Tech Stack & Why
5. Database Schema (in detail)
6. Kafka / Redpanda (in detail)
7. Redis (in detail)
8. Alert Engine (the heart of the system)
9. Feature Deep Dives
10. API Specification
11. Real-Time Delivery (WebSocket)
12. Mock Data & Simulators
13. Frontend
14. System Design Concepts Applied
15. Observability
16. Load Testing Plan
17. Security
18. Live Demo Script
19. How This Scales to Carrefour Production
20. Design Trade-offs & Decisions
21. Repository Structure & Running Locally
22. Timeline & Work Split
23. FAQ for Reviews

## 1. Problem & Goals

Shoppers often browse a product, don't buy immediately, and forget it. Retailers lose conversions
because the shopper never learns that the price dropped or that an out-of-stock item is back.

**Example use case:** a customer adds a laptop to their wishlist at AED 3,000. Later the price drops
to AED 2,500. The customer instantly gets an in-app notification (plus email/push), sees a
"Lowest in 90 days" badge, and can move the item to the cart in one click.

| Goal | Measure |
|---|---|
| Real-time awareness of price/stock changes | Event-to-notification latency, p95 target < 2 s |
| Handle large scale | Millions of wishlist items, thousands of price updates/min |
| Never spam or double-send | Zero duplicate notifications, enforced daily caps |
| Drive conversion | Alert click-through rate and wishlist-to-cart rate in the admin dashboard |
| Production-like engineering | Event-driven design, caching, observability, load tests, resilience |

**Non-goals:** real payments, real checkout, real Carrefour APIs. Cart is a simplified add-to-cart.
All data is mock/simulated.

## 2. Feature List

### 2.1 Core features

1. Add / remove products to a wishlist
2. Track product price history
3. Notify on price drop
4. Notify when out-of-stock items return
5. Recommend similar products when an item is unavailable
6. Display wishlist price trends
7. Move wishlist items directly to cart

### 2.2 Extra features

| # | Feature | One-line description |
|---|---|---|
| E1 | Target-price alerts | "Notify me when below AED 2,500" per item |
| E2 | Lowest-price-in-X-days badge | "Lowest in 90 days" shown on cards and in notifications |
| E3 | Price prediction ("Buy now or wait") | Simple statistical forecast with a clear recommendation |
| E4 | Low-stock urgency alerts | "Only 3 left" when quantity crosses a threshold |
| E5 | Multiple wishlists | e.g. Ramadan, Back-to-school |
| E6 | Shared wishlists | Share a read-only/collaborative link for gifting |
| E7 | Store-level availability | Notify when back at your nearest store; click-and-collect flag |
| E8 | Notification preferences & quiet hours | Per-channel toggles, quiet hours, instant vs daily digest |
| E9 | Multi-channel delivery | In-app, email, push (web push), WhatsApp (mocked) |
| E10 | Loyalty / bank-offer effective price | Show price after points or card offer (mocked offers) |
| E11 | Conversion analytics (admin) | Alerts sent, CTR, wishlist→cart, revenue influenced |
| E12 | Arabic / English with RTL | Full i18n, mirrored layout, localised numbers/currency |

### 2.3 Deliverables that impress reviewers

| # | Deliverable | Where |
|---|---|---|
| R1 | README with architecture diagram + trade-off notes | Sections 3, 20 |
| R2 | Load-test numbers with p95 latency | Section 16 |
| R3 | Live demo: change price in admin panel, notification pops up instantly | Section 18 |
| R4 | "How this scales to Carrefour production" | Section 19 |

## 3. Architecture

### 3.1 Big picture

The single most important idea: **price changes and stock changes are events**. Everything else
(alerts, trends, badges, recommendations, cache invalidation) reacts to those events independently.

```text
Admin / simulator → Core API → {products, price_history, outbox_events} (one DB transaction)
                                      │
                               outbox relay
                                      ▼
                                   Redpanda (price.changed, key = product_id)
                        ┌─────────────┼──────────────┬───────────────┐
                 cache invalidator  alert engine  recommendation  analytics
                        │             │
                   Redis DEL    notification.requested (key = user_id)
                                      ▼
                           notification worker → in-app row + email + push + Redis pub/sub
                                      ▼
                              Push Gateway → browser (toast + bell + chart)
```

### 3.2 Flow for the example use case

1. Simulator (or admin) sets laptop price 3,000 → 2,500.
2. Core API, in **one DB transaction**: inserts a `price_history` row, updates
   `products.current_price`, inserts an `outbox_events` row (`type=price.changed`).
3. Outbox relay reads `outbox_events` and publishes to `price.changed` (key = `product_id`).
4. Price-cache invalidator consumer deletes Redis key `product:{id}`.
5. Alert Engine consumes the event: computes drop % and "is lowest in 90 days?", finds all
   `wishlist_items` (batched, keyset pagination), checks target price, preferences, quiet hours,
   cooldown, daily cap and dedupe, then publishes `notification.requested` per eligible user.
6. Notification Worker writes the `notifications` row idempotently, sends email/push/WhatsApp-mock
   per preferences, and publishes to Redis channel `user:{id}` for live push.
7. Push Gateway receives the Redis message and pushes it to the user's open browser tab.
8. Dashboard shows toast + bell badge + updated chart.
9. User clicks "Move to cart" in the notification.

### 3.3 Why a modular monolith (not full microservices)

One deployable "Core API" with strict module boundaries (Auth, Wishlist, Catalogue, Cart, Price,
Inventory, Preferences). Each module owns its tables and exposes a service interface; modules never
read each other's tables directly. Split out only the parts with a different scaling profile:
Alert Engine (bursty fan-out), Notification Workers (slow external I/O), Push Gateway (long-lived
connections). Benefits: simple local setup, easy debugging, no distributed-transaction headaches,
and clear service seams that can be separated later.

## 4. Tech Stack & Why

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (React), Tailwind CSS, Recharts, next-intl | SSR, rich charts, built-in i18n and RTL |
| Backend | NestJS (TypeScript) | Modules map naturally to the modular monolith; DI makes testing easy |
| Primary DB | PostgreSQL 16 | Relational integrity, JSONB flexibility |
| Time series | TimescaleDB extension | Hypertables + continuous aggregates without a separate DB |
| Vector search | pgvector | Similar-product search inside the same DB |
| Cache / coordination | Redis 7 | Cache-aside, rate limiting, dedupe keys, pub/sub |
| Event streaming | Redpanda (Kafka API compatible) | Single binary, no ZooKeeper, same client code as Kafka |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` | Free, local, 384-dim vectors |
| Real-time | Socket.IO | Rooms, reconnection, Redis adapter |
| Email (dev) | MailHog | Free SMTP sink with web UI |
| Push | Web Push (VAPID) | Free, works in browsers |
| Reverse proxy | Nginx | Load balancing, TLS termination, edge rate limit |
| Containers | Docker + Docker Compose | One-command setup |
| CI | GitHub Actions | Lint, test, build, load-test smoke |
| Observability | Prometheus, Grafana, OpenTelemetry, Loki (optional) | Metrics, dashboards, traces, logs |
| Load testing | k6 | Scriptable in JS, great reports |
| Mock data | Kaggle product dataset + Faker + simulators | See section 12 |

## 5. Database Schema (in detail)

PostgreSQL with TimescaleDB and pgvector. All table and column names below are **frozen**;
changes must go through a new migration file (`db/migrations/YYYYMMDD_NNN_description.sql`) and a PR.

- Canonical product categories (exact strings):
  `Electronics`, `Grocery`, `Home & Kitchen`, `Fashion`, `Beauty & Personal Care`, `Baby & Kids`, `Toys & Games`, `Health & Wellness`.
- Prices are `NUMERIC(10,2)` AED; timestamps are `TIMESTAMPTZ` (UTC).
- The authoritative DDL is in `db/migrations/` (3 files) applied in filename order by `make migrate`.

### 5.1 Extensions

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy text search
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email
```

### 5.2 Identity & preferences

Preferences are a separate 1:1 table so the Alert Engine can load/cached them without touching
`users`. `min_drop_percent`, `max_alerts_per_day`, quiet hours and digest mode implement E8.

```sql
CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          CITEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    full_name      TEXT NOT NULL,
    locale         TEXT NOT NULL DEFAULT 'en',          -- 'en' | 'ar'
    timezone       TEXT NOT NULL DEFAULT 'Asia/Dubai',
    home_store_id  INT REFERENCES stores (id),
    role           TEXT NOT NULL DEFAULT 'customer',    -- 'customer' | 'admin'
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
    user_id            UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    channel_in_app     BOOLEAN NOT NULL DEFAULT true,
    channel_email      BOOLEAN NOT NULL DEFAULT true,
    channel_push       BOOLEAN NOT NULL DEFAULT false,
    channel_whatsapp   BOOLEAN NOT NULL DEFAULT false,
    delivery_mode      TEXT NOT NULL DEFAULT 'instant',  -- 'instant' | 'daily_digest'
    digest_hour_local  SMALLINT NOT NULL DEFAULT 9,
    quiet_start        TIME,
    quiet_end          TIME,
    min_drop_percent   NUMERIC(5,2) NOT NULL DEFAULT 2.0,
    max_alerts_per_day SMALLINT NOT NULL DEFAULT 5,
    push_subscription  JSONB,
    whatsapp_number    TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.3 Catalogue & stores

`current_price` and `total_stock` are denormalised (copied from `price_history` / `inventory`) so
list pages need no joins or aggregation. They are updated in the same transaction that writes the
history row, so they never drift.

```sql
CREATE TABLE stores (
    id                SERIAL PRIMARY KEY,
    code              TEXT UNIQUE NOT NULL,       -- e.g. 'DXB-MOE'
    name              TEXT NOT NULL,
    city              TEXT NOT NULL,
    latitude          DOUBLE PRECISION,
    longitude         DOUBLE PRECISION,
    click_and_collect BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE products (
    id             BIGSERIAL PRIMARY KEY,
    sku            TEXT UNIQUE NOT NULL,
    name_en        TEXT NOT NULL,
    name_ar        TEXT,
    description_en TEXT,
    category       TEXT NOT NULL,
    subcategory    TEXT,
    brand          TEXT,
    image_url      TEXT,
    attributes     JSONB NOT NULL DEFAULT '{}',
    current_price  NUMERIC(10,2) NOT NULL,
    currency       CHAR(3) NOT NULL DEFAULT 'AED',
    list_price     NUMERIC(10,2),
    total_stock    INT NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    embedding      VECTOR(384),
    rating         NUMERIC(2,1),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    source         TEXT,                            -- importer provenance
    external_id    TEXT,
    UNIQUE (source, external_id)
);
CREATE INDEX idx_products_category_price ON products (category, current_price);
CREATE INDEX idx_products_name_trgm ON products USING gin (name_en gin_trgm_ops);
CREATE INDEX idx_products_embedding ON products USING hnsw (embedding vector_cosine_ops);
```

`attributes` JSONB handles varied specs without dozens of nullable columns. HNSW gives fast
approximate nearest-neighbour search. The `(category, price)` index serves similar-product queries.

### 5.4 Inventory

Composite primary key = one row per product per store. `products.total_stock` is the sum across
fulfilment stores. A stock transition triggers alerts: `0 → >0` is "back in stock",
`>threshold → <=threshold` is "low stock".

```sql
CREATE TABLE inventory (
    product_id BIGINT NOT NULL REFERENCES products (id),
    store_id   INT    NOT NULL REFERENCES stores (id),
    qty        INT    NOT NULL CHECK (qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, store_id)
);
CREATE INDEX idx_inventory_store ON inventory (store_id, product_id);
```

### 5.5 Price history (time series)

Append-only, unbounded, partitioned by time; old chunks compress 10–20x. Raw table for writes,
daily continuous aggregate for charts.

```sql
CREATE TABLE price_history (
    product_id  BIGINT NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    currency    CHAR(3) NOT NULL DEFAULT 'AED',
    source      TEXT NOT NULL DEFAULT 'simulator', -- 'simulator' | 'admin' | 'promo'
    event_id    UUID NOT NULL,                     -- links to the Kafka event
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('price_history', 'recorded_at', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_price_hist_product_time ON price_history (product_id, recorded_at DESC);

ALTER TABLE price_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'product_id'
);
SELECT add_compression_policy('price_history', INTERVAL '30 days');

CREATE MATERIALIZED VIEW price_daily
WITH (timescaledb.continuous) AS
SELECT product_id,
       time_bucket('1 day', recorded_at) AS day,
       min(price) AS min_price,
       max(price) AS max_price,
       avg(price) AS avg_price,
       last(price, recorded_at) AS close_price
FROM price_history
GROUP BY product_id, day
WITH NO DATA;
SELECT add_continuous_aggregate_policy('price_daily',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '15 minutes');
```

### 5.6 Wishlists

```sql
CREATE TABLE wishlists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,                    -- 'Ramadan', 'Back to school'
    is_default BOOLEAN NOT NULL DEFAULT false,
    visibility TEXT NOT NULL DEFAULT 'private', -- 'private' | 'shared'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);
CREATE UNIQUE INDEX one_default_wishlist ON wishlists (user_id) WHERE is_default;

CREATE TABLE wishlist_items (
    id                  BIGSERIAL PRIMARY KEY,
    wishlist_id         UUID   NOT NULL REFERENCES wishlists (id) ON DELETE CASCADE,
    user_id             UUID   NOT NULL,          -- denormalised owner (fast alert lookup)
    product_id          BIGINT NOT NULL REFERENCES products (id),
    target_price        NUMERIC(10,2),           -- NULL = any qualifying drop
    notify_on_drop      BOOLEAN NOT NULL DEFAULT true,
    notify_on_restock   BOOLEAN NOT NULL DEFAULT true,
    notify_on_low_stock BOOLEAN NOT NULL DEFAULT false,
    low_stock_threshold INT NOT NULL DEFAULT 5,
    store_id            INT REFERENCES stores (id),
    added_price         NUMERIC(10,2) NOT NULL,   -- price when added (savings display)
    last_notified_price NUMERIC(10,2),           -- hysteresis
    last_notified_at    TIMESTAMPTZ,             -- cooldown
    added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (wishlist_id, product_id)
);
CREATE INDEX idx_wi_product ON wishlist_items (product_id, id);
CREATE INDEX idx_wi_user ON wishlist_items (user_id, added_at DESC);
```

`idx_wi_product (product_id, id)` is the **hot-path index**: on each price event the Alert Engine
runs `WHERE product_id = $1 AND id > $cursor ORDER BY id LIMIT 1000` (keyset pagination).
`user_id` is copied onto `wishlist_items` so the alert query never joins `wishlists` for 100k rows.

```sql
CREATE TABLE wishlist_shares (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wishlist_id UUID NOT NULL REFERENCES wishlists (id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,             -- unguessable 128-bit share-link token
    permission TEXT NOT NULL DEFAULT 'view',     -- 'view' | 'contribute'
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wishlist_item_claims (
    item_id   BIGINT PRIMARY KEY REFERENCES wishlist_items (id) ON DELETE CASCADE,
    claimed_by TEXT NOT NULL,                    -- name/email of the gifter
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.7 Notifications

```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type            TEXT NOT NULL,  -- PRICE_DROP | TARGET_REACHED | BACK_IN_STOCK | LOW_STOCK
                                    -- | STORE_BACK_IN_STOCK | SIMILAR_SUGGESTION | DIGEST
    product_id      BIGINT REFERENCES products (id),
    payload         JSONB NOT NULL, -- old_price, new_price, drop_pct, badge, cta_url, ...
    idempotency_key TEXT UNIQUE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'created', -- created | deferred | sent | failed
    deliver_after   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at         TIMESTAMPTZ,
    clicked_at      TIMESTAMPTZ
);
CREATE INDEX idx_notif_user_time ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX idx_notif_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notif_deferred ON notifications (deliver_after) WHERE status = 'deferred';

CREATE TABLE notification_deliveries (
    id              BIGSERIAL PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
    channel         TEXT NOT NULL, -- in_app | email | push | whatsapp
    status          TEXT NOT NULL, -- pending | sent | failed | dead
    attempts        SMALLINT NOT NULL DEFAULT 0,
    last_error      TEXT,
    sent_at         TIMESTAMPTZ,
    UNIQUE (notification_id, channel)
);
```

`idempotency_key UNIQUE` is the DB-level guarantee against duplicates: Kafka redelivery results in
`INSERT ... ON CONFLICT DO NOTHING`. Per-channel delivery rows let email fail and retry without
affecting the in-app notification. Partial indexes keep unread counts and digest scans tiny.

### 5.8 Cart, offers, recommendations

`source` on `cart_items` measures wishlist→cart conversion ("direct" | "wishlist" | "notification");
`source_notification_id` attributes revenue influenced by alerts.

```sql
CREATE TABLE carts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'active', -- active | converted | abandoned
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_cart ON carts (user_id) WHERE status = 'active';

CREATE TABLE cart_items (
    cart_id                UUID   NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
    product_id             BIGINT NOT NULL REFERENCES products (id),
    qty                    INT    NOT NULL DEFAULT 1 CHECK (qty > 0),
    price_at_add           NUMERIC(10,2) NOT NULL,
    source                 TEXT NOT NULL DEFAULT 'direct',
    source_notification_id UUID,
    added_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE offers (
    id         SERIAL PRIMARY KEY,
    product_id BIGINT REFERENCES products (id),  -- NULL = applies to category
    category   TEXT,
    kind       TEXT NOT NULL, -- POINTS_MULTIPLIER | BANK_DISCOUNT_PCT
    label      TEXT NOT NULL,
    value      NUMERIC(6,2) NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to   TIMESTAMPTZ NOT NULL
);

CREATE TABLE product_similarity (
    product_id         BIGINT NOT NULL REFERENCES products (id),
    similar_product_id BIGINT NOT NULL REFERENCES products (id),
    score              REAL NOT NULL,            -- cosine similarity
    rank               SMALLINT NOT NULL,
    computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, rank)
);
```

### 5.9 Reliability tables (outbox + idempotent consumers)

The classic bug is: write to the DB, then publish to Kafka, and crash between the two — price
changed but no alert fires. The outbox row is inserted in the **same transaction** as the price
change; a relay publishes unpublished rows and marks them done. Worst case is a duplicate publish
(handled by idempotency), never a lost event.

```sql
CREATE TABLE outbox_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic        TEXT NOT NULL,
    key          TEXT NOT NULL,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE processed_events (
    consumer    TEXT NOT NULL,
    event_id    UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, event_id)
);

CREATE TABLE analytics_events (
    id              BIGSERIAL,
    event_type      TEXT NOT NULL, -- ALERT_SENT | ALERT_OPENED | ALERT_CLICKED | WISHLIST_ADD | CART_ADD | PURCHASE_MOCK
    user_id         UUID,
    product_id      BIGINT,
    notification_id UUID,
    amount          NUMERIC(10,2),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('analytics_events', 'occurred_at');
```

### 5.10 Key queries

```sql
-- 1) Hot path: wishlisters of a product, batched by keyset pagination
SELECT id, user_id, target_price, notify_on_drop, last_notified_price, last_notified_at
FROM wishlist_items
WHERE product_id = $1 AND id > $2 AND notify_on_drop = true
ORDER BY id LIMIT 1000;

-- 2) "Lowest in 90 days?"
SELECT min(min_price) FROM price_daily
WHERE product_id = $1 AND day >= now() - interval '90 days';

-- 3) Wishlist dashboard page (cursor pagination)
SELECT wi.*, p.name_en, p.current_price, p.total_stock, p.image_url
FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
WHERE wi.user_id = $1 AND (wi.added_at, wi.id) < ($2, $3)
ORDER BY wi.added_at DESC, wi.id DESC LIMIT 20;

-- 4) Similar products when unavailable
SELECT id, name_en, current_price FROM products
WHERE category = $1 AND is_active AND total_stock > 0
  AND current_price BETWEEN $2 * 0.7 AND $2 * 1.3
ORDER BY embedding <=> $3 LIMIT 6;
```

## 6. Kafka / Redpanda (in detail)

Kafka is a durable, append-only, replayable log. Producers write events to topics; consumers track
their own offsets. Redpanda is a Kafka-compatible implementation that is simple to run in Docker.

Without a broker, a price update would have to synchronously find 100k users and create 100k
notifications and emails. With Kafka, the price service records the change and returns; alerting
happens asynchronously, in parallel, with independent retries.

### 6.1 Concepts

| Concept | Meaning | In our project |
|---|---|---|
| Topic | Named stream of events | `price.changed`, `stock.changed`, ... |
| Partition | Ordered shard; ordering guaranteed only within a partition | 12 for price/stock topics |
| Message key | Determines the partition | `product_id` for price/stock, `user_id` for notifications |
| Offset | Position in a partition | Committed after successful processing |
| Consumer group | Consumers sharing the work | `alert-engine`, `notification-worker`, `cache-invalidator`, `analytics` |
| Replication | Copies per partition | 1 in dev, 3 in production |
| Retention | How long messages are kept | 7 days (replay for debugging/backfill) |

Keying gives per-entity ordering: all events for a product land on one partition, so the Alert
Engine sees `3000 → 2800 → 2500` in order, while different products process in parallel.

### 6.2 Topic catalogue

| Topic | Key | Partitions | Producer | Consumers | Purpose |
|---|---|---|---|---|---|
| `price.changed` | product_id | 12 | outbox relay | alert-engine, cache-invalidator, recommendation, analytics | A product price changed |
| `stock.changed` | product_id | 12 | outbox relay | alert-engine, cache-invalidator, recommendation | Inventory changed |
| `wishlist.events` | user_id | 6 | API | analytics, recommendation | Item added/removed |
| `alert.fanout` | product_id | 12 | alert-engine | alert-engine (workers) | Sub-jobs for huge fan-outs |
| `notification.requested` | user_id | 12 | alert-engine | notification-worker | One message per user alert |
| `notification.retry.1m` / `.5m` / `.30m` | user_id | 3 each | notification-worker | notification-worker | Delayed retry tiers |
| `notification.dlq` | user_id | 3 | notification-worker | humans / admin tool | Dead-letter queue |
| `cart.events` | user_id | 6 | API | analytics | Cart add/move, conversion tracking |

All topics are auto-created by `scripts/init-topics.sh` on `make up`.

### 6.3 Event schemas (JSON, versioned)

`event_id` is generated once at the source and flows into every downstream message and idempotency
key, making one price change traceable end to end.

```jsonc
// price.changed
{
  "event_id": "7d1c...-uuid",
  "event_type": "price.changed",
  "schema_version": 1,
  "occurred_at": "2026-11-20T10:15:30Z",
  "product_id": 48213,
  "sku": "LAP-HP-15-ABC",
  "old_price": 3000.00,
  "new_price": 2500.00,
  "currency": "AED",
  "source": "simulator"
}

// stock.changed
{ "event_id": "...", "event_type": "stock.changed", "schema_version": 1,
  "product_id": 48213, "store_id": 7, "old_qty": 0, "new_qty": 14, "occurred_at": "..." }

// notification.requested
{ "event_id": "...", "idempotency_key": "PRICE_DROP:u-123:48213:7d1c...",
  "user_id": "u-123", "type": "PRICE_DROP", "product_id": 48213,
  "channels": ["in_app", "email", "push"], "deliver_after": null,
  "payload": { "old_price": 3000, "new_price": 2500, "drop_pct": 16.67,
               "lowest_in_days": 90, "target_hit": true, "added_price": 3000 } }
```

### 6.4 Delivery semantics

We use at-least-once delivery: process, then commit the offset. If the consumer crashes in between,
the message is reprocessed. "Exactly-once" end-to-end is expensive and usually impossible across
external systems (email!). Therefore: **at-least-once + idempotent consumers = effectively-once**.

Three layers of protection:

1. `notifications.idempotency_key` UNIQUE (`type:user:product:event_id`)
2. Redis `SET NX` dedupe key (fast check before touching the DB)
3. `processed_events` table for non-notification consumers

Producer: `acks=all`, `enable.idempotence=true`, `compression=zstd`, `linger.ms=5–20`.
Consumer: manual offset commit after processing, `max.poll.records` tuned, batch processing.

### 6.5 Retry / dead-letter pipeline

Exponential backoff (1 min → 5 min → 30 min) with jitter. Permanent errors (invalid email, expired
push subscription) skip retries and go straight to DLQ / disable the channel. Retries are
per-channel: a failed email never re-sends the in-app notification.

```text
notification.requested → notification-worker ──success──► done
                                  │ failure (SMTP down, push 5xx)
                                  ▼
notification.retry.1m → worker → retry.5m → retry.30m → notification.dlq
```

### 6.6 Handling fan-out

A popular product may have 100k wishlisters. One consumer looping through all of them would block
other products on the partition. Solution:

1. Alert Engine consumes `price.changed`, counts wishlisters (cached).
2. `count ≤ 5,000`: process inline in batches of 1,000.
3. `count > 5,000`: split the user-id range and publish `alert.fanout` messages
   `{event_id, product_id, cursor_from, cursor_to}` for parallel processing.
4. Each chunk publishes `notification.requested` in batches.

### 6.7 Backpressure & monitoring

Consumer lag per group is the key health metric; alert if it grows for > 1 minute. If notification
workers fall behind (slow SMTP), messages wait in Kafka — nothing is lost and the API is unaffected.
Redpanda Console (`http://localhost:8080`) browses topics and messages for the live demo.

## 7. Redis (in detail)

Redis is an in-memory accelerator, **not** the source of truth: everything in it can be rebuilt
from PostgreSQL.

### 7.1 Use cases, keys and TTLs

| # | Job | Data structure | Key pattern | TTL |
|---|---|---|---|---|
| 1 | Cache-aside for product details | String (JSON) / Hash | `product:{id}` | 5 min + jitter |
| 2 | Cached wishlist page | String (JSON) | `wishlist:{userId}:{page}` | 60 s |
| 3 | Price stats cache | Hash | `pstats:{productId}` | 10 min |
| 4 | Rate limiting (API) | String counter / Lua token bucket | `rl:{userId or ip}:{route}` | window length |
| 5 | Alert dedupe & cooldown | String with `SET NX` | `dedupe:{idempotencyKey}` | 7 days |
| 6 | Daily alert cap per user | String counter | `alertcap:{userId}:{yyyymmdd}` | 24 h |
| 7 | Preferences cache | Hash | `prefs:{userId}` | 15 min |
| 8 | Real-time fan-out to WebSockets | Pub/Sub | `user:{userId}` | n/a |
| 9 | Most wishlisted / trending | Sorted set | `trending:wishlisted` | rolling |
| 10 | Wishlister count | String | `wlcount:{productId}` | 5 min |
| 11 | Unread notification count | String counter | `unread:{userId}` | none (rebuild on miss) |

### 7.2 Cache-aside and stampede protection

```text
GET /products/48213
  hit  → return from Redis
  miss → SELECT from Postgres → SET product:48213 <json> EX 300+random(0..60) → return
On price.changed / stock.changed: DEL product:48213, DEL pstats:48213
```

Random TTL jitter prevents a cache stampede. Single-flight lock (`SET lock:product:48213 NX EX 5`)
ensures only one request hits the DB for a hot product on a miss. Negative caching ("not found"
for 30 s) avoids hammering the DB with bad IDs.

### 7.3 Rate limiting (atomic token bucket)

A Lua script runs atomically inside Redis; responses are `429` with `Retry-After`. Example limits:
100 req/min per user for reads, 20/min for writes, stricter for login.

### 7.4 Alert dedupe and daily cap

```text
ok = SET dedupe:PRICE_DROP:u123:48213:evt7d1c 1 NX EX 604800
if ok == nil -> already handled, skip
n = INCR alertcap:u123:20261120 ; EXPIRE ... 86400   (on first increment)
if n > user.max_alerts_per_day -> defer to digest
```

`SET NX` is atomic: exactly one concurrent worker wins. The DB UNIQUE constraint is the final
guarantee if Redis loses data. Redis pub/sub is fire-and-forget; if a user is offline the
notification is already in PostgreSQL and shows up on next load.

### 7.5 Operational settings

`maxmemory-policy allkeys-lru` for the cache instance. AOF persistence for the instance holding
dedupe/counters (rebuildable from the DB). In production: Sentinel/Cluster and separate logical
instances for cache vs state.

## 8. Alert Engine (the heart of the system)

### 8.1 Decision pipeline (per price event × per wishlister)

```text
price.changed (old, new)
  [0] Is it a drop? (new < old) else record only
  [1] Load wishlist_item + user prefs (cached in Redis)
  [2] notify_on_drop = true?
  [3] target_price set ? new <= target → TARGET_REACHED
      else drop% >= user.min_drop_percent → PRICE_DROP
  [4] Hysteresis: new < last_notified_price (or none)
  [5] Cooldown: now - last_notified_at > 24h (unless new all-time low)
  [6] Daily cap: INCR alertcap:{user}:{day} <= max_alerts_per_day, else defer to digest
  [7] Quiet hours / digest? → notification with status=deferred, deliver_after=...
  [8] Dedupe: Redis SET NX on idempotency key
  [9] Enrich: "Lowest in N days", effective price with offers, savings vs added_price
  [10] Publish notification.requested; UPDATE wishlist_items last_notified_*
```

### 8.2 Stock events

| Transition | Alert type | Rule |
|---|---|---|
| `0 → >0` (online) | `BACK_IN_STOCK` | items with `notify_on_restock` |
| `0 → >0` at user's store | `STORE_BACK_IN_STOCK` | item's `store_id` or user's `home_store_id`; includes click-and-collect |
| `>threshold → <=threshold` | `LOW_STOCK` | item's `low_stock_threshold` (default 5), once per crossing |
| `>0 → 0` | no owner alert | triggers similar-product suggestions |

### 8.3 Anti-spam summary

Minimum drop % (default 2), hysteresis on last notified price, 24 h per-item cooldown, daily cap
per user (default 5, overflow → digest), quiet hours (deferred, not dropped), daily digest mode,
dedupe by idempotency key.

### 8.4 Daily digest job

A worker (every 15 minutes) selects `notifications WHERE status='deferred' AND deliver_after <= now()`,
groups by user and sends one email ("5 items on your wishlist dropped today") respecting each
user's timezone and `digest_hour_local`.

## 9. Feature Deep Dives

### 9.1 Add / remove wishlist items

`POST /wishlists/{id}/items` inserts a row with `added_price = products.current_price`.
`UNIQUE (wishlist_id, product_id)` makes it idempotent. On add/remove, publish `wishlist.events`
and update `trending:wishlisted`. Removal is a hard delete (history lives in analytics).

### 9.2 Price history & trends

Chart data comes from `price_daily` for ranges ≥ 14 days and raw `price_history` for intraday
(last 24–48 h). UI shows price line, min/max band, sale markers, target-price line and "added at"
marker. Wishlist summary: total value now vs added, total savings and a sparkline per item.

### 9.3 Lowest price in X days

`min(min_price)` over 30/60/90 days from `price_daily`, cached in `pstats:{id}`. If
`current_price <= min over 90 days` → "Lowest in 90 days" (else try 60, then 30). Badge appears on
cards, notifications and emails; it also overrides the cooldown for new all-time lows.

### 9.4 Price prediction ("Buy now or wait")

Transparent and explainable: (1) percentile rank in the 90-day range, (2) 7-day vs 30-day SMA,
(3) linear regression slope over 30 days, (4) upcoming sale calendar (White Friday, Ramadan,
Back-to-School, DSF), (5) rule-based verdict: percentile ≤ 15% → `BUY NOW`; downward slope + sale
within 21 days → `WAIT`; otherwise `NEUTRAL`. Always show confidence, reasons and a disclaimer.
Optional upgrade: nightly Prophet forecasts in `price_forecast`.

### 9.5 Similar-product recommendations when unavailable

Offline/event-driven: embeddings from `name + category + brand + description` (all-MiniLM-L6-v2)
stored in `products.embedding`, top-10 neighbours in `product_similarity`. Candidate filter: same
category, in stock, price within ±30%. Ranking:
`0.6*cosine + 0.2*price_closeness + 0.1*rating_norm + 0.1*in_home_store`.
Trigger: `stock.changed` to 0 for a wishlisted item. Graceful degradation: circuit breaker +
300 ms timeout returns an empty list; the wishlist still renders.

### 9.6 Move to cart

`POST /wishlists/{id}/items/{itemId}/move-to-cart` runs in one transaction: add to `cart_items`
with `price_at_add` and `source='wishlist'` (or `'notification'`), optionally remove from the
wishlist. Rejected with a helpful message if out of stock (similar items offered instead).
Bulk "Move all in-stock to cart" is also available.

### 9.7 Low-stock urgency

Alert fires when quantity crosses the item's threshold downward; UI shows an "Only 3 left" red
pill. A Redis key prevents repeat alerts until stock rises above the threshold again.

### 9.8 Multiple & shared wishlists

Users can create many named wishlists; everyone has a default one. Share link: 128-bit random token
in `wishlist_shares`, optional expiry, `view` or `contribute` permission. Shared viewers can claim
an item ("I'll buy this") hidden from the owner. Anonymous viewers get read-only access via token
only, with email/targets/preferences stripped.

### 9.9 Store-level availability + click-and-collect

Inventory is per store. The user picks a home store (or one per item). A restock at that store
triggers `STORE_BACK_IN_STOCK` with "Available for click-and-collect at Mall of the Emirates".
The dashboard shows store availability sorted by haversine distance from stored lat/long.

### 9.10 Notification preferences & quiet hours

Settings page: channel toggles, instant vs digest, timezone-aware quiet hours, min drop %, daily
cap, per-item overrides. Cached in Redis, invalidated on save.

### 9.11 Multi-channel

Channel adapters share `send(notification, user) -> Result`. In-app = DB row + WebSocket + badge;
email = SMTP via MailHog (EN/AR templates); web push = VAPID (410 → disable subscription);
WhatsApp = mock adapter logging a preview (real API needs business approval).

### 9.12 Loyalty / bank-offer effective price

Mock offers: "AED 2,500 → effective AED 2,375 with 5% bank card offer, earn 2,500 bonus points".
Notifications include the best applicable offer; offers are cached with the product.

### 9.13 Conversion analytics dashboard (admin)

From `analytics_events`: alerts sent/delivered/opened/clicked funnel, CTR by alert type and
channel, wishlist→cart rate, alert→cart attribution via `source_notification_id`, revenue
influenced, top wishlisted products, most price-sensitive categories, average alert→cart time,
and system health (lag, DLQ size, delivery success rate).

### 9.14 Arabic / English & RTL

`next-intl` with `en.json` / `ar.json`; products have `name_ar`; `<html dir="rtl">` for Arabic;
Tailwind logical utilities; AED/number/date formatting via `Intl.NumberFormat`; email templates in
both languages selected by `users.locale`.

## 10. API Specification

REST + JSON, versioned under `/api/v1`. Full OpenAPI 3 spec is generated by NestJS Swagger at
`/api/docs` (and mirrored in [`docs/openapi.yaml`](docs/openapi.yaml)). All routes except auth and
shared-link views require `Authorization: Bearer <JWT>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register`, `/auth/login`, `/auth/refresh` | Auth (JWT access + refresh) |
| `GET` | `/products?query=&category=&cursor=` | Search/browse catalogue |
| `GET` | `/products/{id}` | Product details (cached) + badges + offers |
| `GET` | `/products/{id}/price-history?range=7d\|30d\|90d\|1y` | Chart data |
| `GET` | `/products/{id}/prediction` | Buy-now-or-wait verdict + reasons |
| `GET` | `/products/{id}/similar` | Similar in-stock products |
| `GET` | `/wishlists` | My wishlists |
| `POST` | `/wishlists` | Create wishlist |
| `PATCH` / `DELETE` | `/wishlists/{id}` | Rename / delete |
| `GET` | `/wishlists/{id}/items?cursor=` | Items with live price/stock (paginated) |
| `POST` | `/wishlists/{id}/items` | Add product `{productId, targetPrice?, ...}` |
| `PATCH` | `/wishlists/{id}/items/{itemId}` | Update target price / alert toggles |
| `DELETE` | `/wishlists/{id}/items/{itemId}` | Remove |
| `POST` | `/wishlists/{id}/items/{itemId}/move-to-cart` | Move to cart |
| `POST` | `/wishlists/{id}/move-all-to-cart` | Bulk move in-stock |
| `GET` | `/wishlists/{id}/trends` | Wishlist value trend + savings summary |
| `POST` | `/wishlists/{id}/share` | Create share link |
| `GET` | `/shared/{token}` | Public read-only view (no auth) |
| `POST` | `/shared/{token}/items/{itemId}/claim` | Gifting claim |
| `GET` | `/cart` · `POST /cart/items` · `DELETE /cart/items/{productId}` | Cart |
| `GET` | `/notifications?cursor=&unread=true` | Notification feed |
| `POST` | `/notifications/{id}/read` · `/notifications/read-all` | Mark read |
| `POST` | `/notifications/{id}/click` | Record click (analytics) |
| `GET` / `PUT` | `/me/preferences` | Notification preferences |
| `POST` | `/me/push-subscription` | Register web-push subscription |
| `GET` | `/stores` · `PUT /me/home-store` | Store list / set home store |
| `PUT` | `/admin/products/{id}/price` | Set price (the demo button) |
| `PUT` | `/admin/products/{id}/stock` | Set stock (global or per store) |
| `POST` | `/admin/simulator/start\|stop\|config` | Control the live feed |
| `GET` | `/admin/analytics/overview` | Conversion KPIs |
| `GET` | `/admin/dlq` · `POST /admin/dlq/{id}/replay` | Dead-letter queue tools |

**Conventions:** cursor-based pagination (`?cursor=...&limit=20` returns `{items, nextCursor}`),
consistent error shape `{code, message, details}`, `Idempotency-Key` header on POSTs that create
resources, `X-Request-Id` for tracing, `ETag`/`If-None-Match` on product GETs.

## 11. Real-Time Delivery (WebSocket)

Browser connects to `/ws` with the JWT; server joins the socket to room `user:{id}`. Events pushed:
`notification.new`, `price.update`, `stock.update`, `unread.count`. Multi-instance: Socket.IO Redis
adapter — any worker publishes to `user:{id}`; whichever gateway holds the socket delivers it.

Reliability: heartbeats, auto-reconnect with exponential backoff; on reconnect the client calls
`GET /notifications?since=` to fetch anything missed (PostgreSQL is the source of truth, WebSocket
is only the fast path). Scaling: stateful gateways sit behind Nginx with sticky sessions and scale
by connection count (~20–50k per instance). Fallback: SSE or 30 s polling. Live prices use a
`product:{id}` room only for users currently viewing that product.

## 12. Mock Data & Simulators

### 12.1 Product catalogue

Source: a free e-commerce dataset (Kaggle "shopping dataset" style, ~1k products) plus
Faker-generated catalogues to reach 2k (small profile) / 50k (full profile). The importer
(`scripts/seed_products.py`) cleans names, maps categories to the canonical eight, converts prices
to AED with a fixed documented rate, assigns images and placeholder embeddings, and inserts with
`source` / `external_id` so re-runs are idempotent. See [`DATA_SOURCES.md`](DATA_SOURCES.md).

### 12.2 Users, wishlists, stores, inventory

Faker: 10,000 users (200 in the small profile), up to 3 wishlists each, ~200,000 wishlist items
with a Zipf (power-law) distribution so a few products are extremely popular. ~25 UAE stores with
lat/long; inventory for each product × subset of stores. Offers seeded with mock bank/loyalty
offers. All seeded passwords are `Demo@1234` (bcrypt cost 10, hashed once and reused). Fixed demo
accounts: `demo@carrefour.test` (customer) and `admin@carrefour.test` (admin).

### 12.3 Price simulator

Backfill: 12 months of daily history per product using a random walk with mean reversion plus sale
events (White Friday, Ramadan, DSF) that drop prices 10–30% for 3–10 days then recover. Live mode:
a worker every N seconds picks random products and emits small ±1–3% changes, occasional promo
drops, restocks and sell-outs, writing through the same Price/Inventory service API as the admin
panel. Admin controls: events/second slider, Flash Sale, Sell out, Restock and demo presets.
Reproducible: seeded RNG.

## 13. Frontend

| Page | Contents |
|---|---|
| Home / Browse | Search, categories, "Most wishlisted", "Dropped in price" strip |
| Product detail | Price, badges, chart, prediction, offers, store availability, add to wishlist with target price |
| Wishlist dashboard | Tabs per wishlist, cards with image/price change/sparkline/badges, move to cart, edit target, remove, summary banner |
| Price trends | Wishlist value over time, per-item charts with target line, buy-now/wait verdicts |
| Notification center | Bell with live unread count, filters, mark read, deep link to product |
| Preferences | Channels, quiet hours, digest, thresholds, home store, language |
| Shared wishlist (public) | Read-only view with gifting claims |
| Cart | Simplified cart showing items sourced from wishlist |
| Admin panel | Price/stock editor, simulator controls, analytics, DLQ viewer, system health |

Performance: SSR for product pages, SWR/React Query for wishlist, optimistic add/remove/move,
infinite scroll with cursor pagination, lazy images, skeletons, charts downsampled to ≤ 200 points,
accessible toasts, mobile-first.

## 14. System Design Concepts Applied

1. Event-driven architecture — price/stock events drive independent consumers
2. Transactional outbox — DB write and event publish cannot diverge
3. Fan-out handling — batching, keyset pagination, `alert.fanout` chunking
4. Partitioning by key — `product_id` / `user_id`
5. Idempotency & dedupe — idempotency keys, Redis `SET NX`, DB UNIQUE, `processed_events`
6. At-least-once + idempotent consumers — offset commit after processing
7. Debouncing / thresholds / hysteresis — min drop %, cooldown, last notified price
8. Caching — cache-aside, TTL jitter, stampede protection, negative cache
9. CQRS-lite — raw hypertable for writes, `price_daily` for reads
10. Denormalisation — `current_price`, `total_stock`, `wishlist_items.user_id`
11. Rate limiting — Redis token bucket + Nginx
12. Backpressure — Kafka buffering, lag monitoring
13. Retry with exponential backoff + DLQ
14. Horizontal scaling — stateless API replicas, consumer groups, Redis pub/sub
15. Cursor-based pagination — wishlists, notifications, products
16. Graceful degradation & circuit breaker — recommendation outage doesn't break wishlist
17. Observability — metrics, traces, logs
18. Security & authorisation — JWT, per-resource ownership checks
19. Data lifecycle — Timescale compression + retention policies
20. Eventual consistency — notifications lag by seconds; DB is truth on refresh

## 15. Observability

Prometheus metrics + Grafana dashboards: API request rate/error rate/latency per route, Kafka
consumer lag and DLQ depth, alert-engine events/s and suppression reasons, notifications
sent/failed per channel, **end-to-end latency** (`notifications.created_at - price_history.recorded_at`,
the headline p95 < 2 s metric), Redis hit ratio/evictions, Postgres connections/slow queries/chunks,
WebSocket clients. OpenTelemetry propagates `trace_id` through HTTP → outbox → Kafka headers →
consumers. Structured JSON logs include `event_id`, `user_id`, `product_id`. Ops alerts: lag > 10k
for 2 min, growing DLQ, p95 end-to-end > 5 s, API 5xx > 1%, Redis hit ratio < 80%.

## 16. Load Testing Plan

Tool: k6 (HTTP + WebSocket). Targets to **measure and record** in `docs/load-test-results.md` with
hardware specs (not claims):

| Scenario | Load | Target |
|---|---|---|
| L1 Read wishlist dashboard | 2,000 virtual users | p95 < 200 ms, error < 0.1% |
| L2 Add / remove items | 500 writes/s | p95 < 150 ms |
| L3 Price-update firehose | 5,000 events/min | consumer lag near 0 |
| L4 Hot-product fan-out | 1 product, 100k wishlisters | 100k alert records < 30 s |
| L5 Flash sale | 50k price changes in 1 min | lag recovers < 5 min, API p95 < 300 ms |
| L6 WebSocket | 10,000 connections | delivery p95 < 500 ms |
| L7 Failure drills | kill consumer / SMTP / Redis | no lost or duplicate notifications |

Report throughput, p50/p95/p99, errors, consumer lag graph, CPU/memory per container and a
bottleneck analysis with before/after for key optimisations. Likely levers: PgBouncer, batch inserts
via `COPY`, Kafka producer batching/compression, more partitions/consumers, Redis pipelining,
partial indexes, response compression.

## 17. Security

JWT access tokens (15 min) + rotating refresh tokens (httpOnly cookie); bcrypt/argon2 passwords.
Every wishlist/notification/cart query scoped by `user_id` from the token (IDOR tests); admin routes
require `role='admin'`. DTO validation, parameterised SQL only, output encoding. Rate limiting per IP
and user. Share links: 128-bit tokens, expiry, revocation, stripped public view. Helmet, strict
CORS, CSP. Secrets via environment variables, never committed. PII minimised in logs, unsubscribe
link in every email, GDPR-style "delete my data" endpoint. `npm audit` / Dependabot in CI.

## 18. Live Demo Script

Setup: `docker compose up` seeds data and starts everything. Open customer app (:3000), Arabic
window, admin panel (:3000/admin), MailHog (:8025), Redpanda Console (:8080).

**Demo 1 — headline use case (~3 min):** log in as `demo@carrefour.test`; show the laptop at AED
3,000 with chart and prediction; set target 2,500; admin sets price to 2,500; within ~1 s toast
appears, bell shows (1), card shows ↓16.7% and "Lowest in 90 days", chart gets a point; MailHog has
the email; click "Move to cart" from the notification (source = notification).

**Demo 2 — back in stock + similar (~2 min):** admin sets a wishlisted TV stock to 0 →
"Unavailable" + Similar products; restock 12 at home store → "Back in stock at Mall of the Emirates";
set stock to 3 → "Only 3 left".

**Demo 3 — anti-spam (~2 min):** 2,500 → 2,495 (0.2%): no alert; 2,500 → 2,600 → 2,500: no
second alert; enable quiet hours and drop again → deferred notification in digest.

**Demo 4 — scale/resilience (~3 min):** Flash Sale (50 products, −20%); Grafana shows lag spike and
recovery; k6 hot-product scenario; kill notification worker while alerts flow, then restart;
stop MailHog to exercise retry topics/DLQ replay.

**Demo 5 — extras (~2 min):** switch to Arabic (RTL); open a shared wishlist link and claim a gift;
show conversion analytics. Rehearse with seeded RNG and keep a recorded video as backup.

## 19. How This Scales to Carrefour Production

| Concern | Prototype | Production at MAF scale |
|---|---|---|
| Traffic entry | Nginx | CDN, global LB, WAF, DDoS protection |
| Compute | Docker Compose | Kubernetes + HPA/KEDA on CPU, RPS, Kafka lag |
| Regions | 1 | Multi-region active-active, regional Kafka with MirrorMaker |
| Database | 1 Postgres | Primary + read replicas; shard `wishlist_items` / `notifications` by `user_id` |
| Hot-product lookup | `product_id` index | Precomputed reverse index / bitmaps per shard |
| Kafka | single Redpanda | 3+ brokers, RF=3, rack-aware, schema registry |
| Redis | single | Cluster / managed, separate cache vs state |
| Search / similarity | pgvector | Dedicated vector search at millions of SKUs |
| Real-time | Socket.IO | Dedicated connection tier / managed push + FCM/APNs |
| Notifications | SMTP / mock | SES/SendGrid, WhatsApp Business API, provider failover |
| Integration | Simulator | CDC (Debezium) from ERP, real loyalty/payment APIs |
| Data/ML | Rule-based prediction | Feature store, ML forecasting, A/B tests |
| Reliability | Single node | SLOs, multi-AZ, PITR, chaos testing, runbooks |
| Security/compliance | Basic | SSO, secrets manager, audit logs, PII encryption, UAE data residency |
| Delivery | GitHub Actions | Canary/blue-green deploys, feature flags |

Back-of-envelope: 20M wishlist items, 500k price changes/day (~6/s avg, ~500/s flash peak),
~20 wishlisters/product → ~10M evaluations/day → 1–2M notifications/day after suppression.
Peak viral product: 200k evaluations chunked into 20 batches of 10k across 12+ consumers.
Storage: ~25 MB/day raw price rows (~9 GB/year before compression). Illustrative, not real figures.

## 20. Design Trade-offs & Decisions

| Decision | Alternative | Why |
|---|---|---|
| Modular monolith + 3 extracted workers | Full microservices | Faster to build/debug, clear seams to split later |
| Redpanda / Kafka | RabbitMQ | Replay, key ordering, lag metrics, industry relevance |
| TimescaleDB inside Postgres | InfluxDB / ClickHouse | One datastore, SQL joins, adequate scale |
| pgvector | Separate vector DB | Same DB, transactional with catalogue |
| Transactional outbox | Dual write | Eliminates lost-event failure mode |
| At-least-once + idempotency | Exactly-once transactions | Robust across external systems like email |
| Denormalised `current_price`, `user_id` | Pure 3NF | Hot-path speed, guarded by same-transaction updates |
| Keyset pagination | OFFSET | Constant-time deep pages, no skipped/duplicated rows |
| Redis as accelerator | Redis-only state | Failures degrade speed, not correctness |
| Rule-based prediction | ML-only | Explainable, no training-data issues |
| WhatsApp mocked | Real integration | Requires business approval; adapter makes swap trivial |
| Eventual consistency for alerts | Synchronous alerts | Keeps price updates fast and resilient |

See [`docs/adr/`](docs/adr/) for the one-page ADRs.

## 21. Repository Structure & Running Locally

```text
smart-wishlist/
├── README.md                  # this design document
├── docker-compose.yml         # postgres (+timescale, pgvector), redis, redpanda, console, mailhog
├── .env.example               # agreed env var names, ports, defaults
├── Makefile                   # up, down, migrate, psql, reset, seed-small, seed
├── DATA_SOURCES.md            # dataset URLs, licences, FX rate
├── db/migrations/             # versioned SQL, applied in filename order
├── scripts/                   # download_datasets.py, seed_products.py, seed.py, migrate.sh
├── docs/
│   ├── erd.md                 # Mermaid ERD
│   ├── openapi.yaml           # frozen API contract
│   └── adr/                   # architecture decision records
└── .github/workflows/ci.yml   # lint + migrate on every PR
```

### Quick start

```bash
cp .env.example .env
make up               # all containers healthy (Postgres, Redis, Redpanda, Console, MailHog)
make migrate          # applies 3 migrations; 2 hypertables
make psql             # interactive psql (\dt, SELECT * FROM timescaledb_information.hypertables;)
make download-datasets
make seed-small       # ~2,000 products, 202 users, fast demo data
# or: make seed       # ~50,000 products, 10,000 users, ~200,000 wishlist items
```

Ports: Postgres `5432`, Redis `6379`, Redpanda Kafka API `19092` (inside Docker `redpanda:9092`),
Redpanda Console `8080`, MailHog SMTP/UI `1025`/`8025`, API `8000` (`/api/v1`), Web `3000`.

`SEED_PROFILE` in `.env` selects the default profile for `make seed`; `make seed-small` always
overrides it with `small`. Seeding is re-runnable (wipes and reloads) and prints row counts.

Fixed demo accounts (password `Demo@1234`): `demo@carrefour.test` (customer, default wishlist with
8–12 items including the AED ~3,000 laptop) and `admin@carrefour.test` (admin).

### Testing strategy

Unit tests (alert rules as pure functions), integration tests with Testcontainers (Postgres/Redis/
Redpanda), contract tests for event schemas, Playwright end-to-end for the headline scenario, k6
for load, and chaos drills (section 16, L7).

## 22. Timeline & Work Split

| Week | Deliverables |
|---|---|
| 1 | Requirements sign-off, ERD, OpenAPI draft, Docker Compose skeleton, seed data pipeline |
| 2 | Auth, catalogue, wishlist CRUD (multi-wishlist), cart + move-to-cart, basic dashboard |
| 3 | Price history (hypertable + aggregate), simulator, charts, outbox + price.changed, Redis caching |
| 4 | Alert Engine, notifications (in-app, email), WebSocket push, restock/low-stock/store alerts |
| 5 | Recommendations, prediction, preferences/quiet hours/digest, push + WhatsApp mock, offers, sharing/gifting, i18n/RTL, rate limiting |
| 6 | Admin analytics, observability, load tests + tuning, failure drills, documentation, demo rehearsal |

If time is tight, cut in this order: WhatsApp mock → gifting claims → Prophet → offers.
Never cut: outbox, idempotency, caching, load test, live demo.

**Phase split:** Person A (platform/back-end) owns schema/migrations, outbox, Kafka, alert engine,
workers, Redis, WebSockets, observability, load tests. Person B (data/front-end) owns the Next.js
dashboard, notification center, preferences, i18n, admin panel, seed data, simulator and
recommendation/prediction.

## 23. FAQ for Reviews

**Why not send the email directly when the admin updates the price?** A product can have 100k
wishlisters; doing it inline would be slow and fragile. Events let alerting scale, retry and fail
independently.

**What if Kafka delivers the same event twice?** Idempotency key + Redis `SET NX` + DB UNIQUE make
the second processing a no-op.

**What if the service crashes after updating the price but before publishing?** Outbox: the event
was saved in the same transaction; the relay publishes it on restart.

**Won't users get spammed by price flapping?** Min drop %, hysteresis, cooldown, daily cap, quiet
hours, digest mode.

**How do you stop user A reading user B's wishlist?** Every query is scoped by `user_id` from the
JWT; share links use random tokens and expose a stripped view; covered by automated tests.

**What if Redis dies?** Cache misses hit Postgres (slower, still correct); dedupe falls back to the
DB UNIQUE constraint; pushes pause but notifications are in Postgres and load on reconnect.

**What if the recommendation service is down?** Circuit breaker returns an empty list; wishlist
still renders.

**How do you scale to 100x?** Shard by `user_id`, more partitions/consumers, read replicas,
regional deployment, dedicated vector search, CDN (section 19).

**Why denormalise `user_id` into `wishlist_items`?** The hot path is "all wishlisters of a
product"; without it we'd join `wishlists` for 100k rows per event. The value never changes after
creation, so the duplication is safe.

**How do you measure business value?** Admin analytics: alert CTR, wishlist→cart rate,
alert→cart attribution via `cart_items.source_notification_id`, revenue influenced.

---

**Glossary.** *Fan-out*: one event causing many downstream actions. *Idempotent*: doing it twice has
the same effect as doing it once. *Hysteresis*: needing a larger change to re-trigger, to avoid
flip-flopping. *Consumer lag*: how many messages a consumer is behind. *DLQ*: dead-letter queue for
permanently failed messages. *Keyset pagination*: paging by "after this key" instead of OFFSET.

*Prices, data and integrations in this project are mock/simulated. No real Carrefour or MAF systems
are used.*
