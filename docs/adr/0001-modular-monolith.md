# ADR 0001 — Modular monolith with three extracted workers

- **Status:** Accepted
- **Date:** 2026-11-21
- **Deciders:** Phase 1 platform team

## Context

The application spans wishlists, catalogue, cart, price/inventory, preferences, notifications,
analytics and admin. A full microservices split would give independent deploys but would also mean
many repositories, distributed transactions between modules that share data (a price change must
atomically write `price_history`, `products.current_price` and `outbox_events`), and a heavy local
setup for a two-person team demoing in six weeks. A single unstructured application, on the other
hand, would blur module boundaries and make future extraction painful.

## Decision

Build a **modular monolith** ("Core API") with strict module boundaries: Auth, Users, Catalogue,
Wishlist, Cart, Price, Inventory, Preferences, Notifications, Analytics, Admin and Outbox. Each
module owns its tables and exposes a service interface; no module reads another module's tables
directly. Extract only the components with a fundamentally different scaling or runtime profile:

1. **Alert Engine** — CPU/IO-heavy, bursty fan-out, scaled on Kafka consumer lag.
2. **Notification Workers** — slow external I/O (SMTP, web push, WhatsApp mock) with retry/DLQ.
3. **Push Gateway** — long-lived WebSocket connections, stateful, scaled by connection count.

These communicate with the monolith through the Kafka event log and Redis, not synchronous calls.

## Consequences

**Positive**

- One deployable for most features; simple local debugging and one database transaction for the
  price-write/outbox invariant.
- Clear seams: each extracted worker already has an event-based interface, so it can be promoted to
  its own deployable without rewriting business logic.
- No distributed-transaction headaches for the core write path.

**Negative / accepted risks**

- A bug in any module can take down the whole monolith; mitigated by module-level tests, validation
  and clear interfaces.
- Modules must be disciplined about not querying each other's tables; code review enforces this.
- Scaling is coarse: the monolith scales as a unit until a module is extracted.

## Alternatives rejected

- **Full microservices:** too much operational overhead for the team and demo timeline; makes the
  atomic price-history/outbox write awkward.
- **Single unstructured app:** would not demonstrate the service seams needed in section 19 of the
  design document.
