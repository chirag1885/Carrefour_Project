# Phase 4: Web app and email alerts

Base revision: `4d54619174635a0b3842879394a1d7710caefab6`.

## Run locally

Keep existing `.env` values. Append the Phase 4 variables from `.env.example`
if you need to override defaults. Do not overwrite JWT secrets or database
credentials. Start from the repository root:

```sh
make up
make migrate
make seed-small
docker compose -f docker-compose.yml -f docker-compose.relay.yml up -d relay
make alerts-up
npm --prefix apps/api ci
npm --prefix apps/api run dev
```

Skip seeding if you already have development data. The base Compose file does
not contain the API; run it locally. The alerts overlay deliberately does not
include the pre-existing simulator overlay, which references an API service.

For local, independent worker tests (a new package, so use install the first
time, then commit its generated package-lock.json):

```sh
npm --prefix apps/alerts install
make test-alert
npm --prefix apps/api run typecheck
```

Register/login, add a product to your wishlist, enable in-app and email in
preferences, and change the same product's price through the admin endpoint.
Check the notification feed and MailHog at http://localhost:8025. The default
SMTP server is for development, not production email delivery.

## APIs for the web app

All use your existing JWT access token in the Authorization header:

* GET /api/v1/notifications?limit=20
* GET /api/v1/notifications/unread-count
* POST /api/v1/notifications/{id}/read
* POST /api/v1/notifications/read-all
* POST /api/v1/notifications/{id}/click
* GET and PUT /api/v1/me/preferences

Use a 5-second poll for the first page and bell count while the app is visible,
refresh on focus, and stop polling on logout. Paginate older notifications
with nextCursor. Do not put the access token in a URL. The application can use
the notification payload's CTA path to navigate to the product, then record a
click using the notification UUID. Email recipients must still authenticate.
The API click endpoint returns 204, matching the existing contract.

The preference response retains channelPush and channelWhatsapp as false for
compatibility. PUT requires false for both. No browser push subscription
endpoint, VAPID keys, or WhatsApp sender is implemented.

## Design decision: durable delivery queue

The uploaded implementation set Redis dedupe before producing to Kafka. A
crash at this boundary could lose an alert. It also skipped an existing
notification without resuming incomplete delivery rows.

This replacement uses the existing Phase 3 transactional outbox and Redpanda
product topics unchanged. An independent alert-engine consumer reads them and
atomically writes the source-event receipt, notification, and channel jobs in
PostgreSQL. Kafka offsets are committed only after the SQL transaction.
The existing unique notification idempotency key prevents duplicate alerts.
User row locks serialize notification quota reservations. The delivery worker
claims eligible channel jobs with SELECT FOR UPDATE SKIP LOCKED; each retry
has a durable due time, attempts count and status. The web feed only displays
sent in-app jobs, and unread counts query the authoritative database.

Email is at-least-once: SMTP acceptance followed by a process/database failure
may produce a duplicate on retry. Stable Message-ID helps downstream dedupe
but does not guarantee exactly-once email. Permanent failures or exhausted
retries remain in notification_deliveries with status=dead for inspection.
No notification is marked sent merely because SMTP credentials are absent.

This is a deliberately smaller Phase 4 implementation than the supplied
plan: it replaces notification.requested/retry-topic hops with a PostgreSQL
queue and replaces the unverified Socket.IO gateway with authenticated feed
polling. Existing Phase 3 topics, services and migrations are not changed.
It does not delete pre-provisioned but unused topics.

Known limitations before a production rollout:

* The engine handles all wishlisters for a product in a single transaction;
  fan-out, keyset batches and load testing are still needed for large audiences.
* Daily-digest mode schedules individual notifications at the digest hour.
  It does not yet combine them into one summary. A quota reservation looks
  ahead up to seven days; alerts beyond that horizon are suppressed.
* Quotas are reservations for planned local calendar dates, not proof that
  delivery can never bunch up after downtime.
* Stock events carry per-store quantity only. An unscoped restock alert uses
  the existing plan's store-event semantics, not a global stock transition.
* Lowest-in-window and offer-label enrichment, admin diagnostics, DLQ replay,
  Socket.IO, worker metrics and full live integration tests remain future work.
* The new package must have its lockfile generated and committed before
  switching its Dockerfile from npm install to npm ci.

## Verification

The test suite covers pure decisions, event schema and money arithmetic plus
embedded PostgreSQL rollback, redelivery, per-channel retries and quota
reservation. The full Docker/Redpanda/MailHog system must be exercised on a
developer machine before merging to main.
