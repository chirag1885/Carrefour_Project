"""
Phase 3 invariant checker — run after any load test or failure drill.

Exits 0 on no violations, 1 on violations, 2 on connection failure.

Checks:
  1. Every price_history row (non-backfill) has exactly one outbox_events row (same event_id).
  2. No outbox row is unpublished and older than 60 s (quarantined rows are flagged, not failed).
  3. The event chain is continuous per product: old_price[n] == new_price[n-1] in publish_order.
  4. products.current_price == last event's new_price for every product.
  5. products.total_stock == SUM(inventory.qty) for every product.
  6. After quiescence (no new writes for 30 s), cached product:{id} agrees with the DB.
  7. No duplicate event_id values in outbox_events.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import NamedTuple

from dotenv import load_dotenv
import psycopg

load_dotenv(Path(__file__).parent.parent / ".env")

QUIESCENCE_SECS = 30     # wait this long before checking Redis
UNPUBLISHED_MAX_SECS = 60


class Violation(NamedTuple):
    check: str
    detail: str


def db_connect() -> psycopg.Connection:
    url = os.getenv("DATABASE_URL")
    if url:
        return psycopg.connect(url)
    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "wishlist"),
        user=os.getenv("POSTGRES_USER", "wishlist"),
        password=os.getenv("POSTGRES_PASSWORD", "wishlist_local"),
    )


def check_1_orphan_history(conn: psycopg.Connection) -> list[Violation]:
    """Every non-backfill price_history row has exactly one outbox_events row."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT h.event_id, count(o.id)
            FROM price_history h
            LEFT JOIN outbox_events o ON o.id = h.event_id
            WHERE h.source != 'backfill'
            GROUP BY h.event_id
            HAVING count(o.id) != 1
            LIMIT 20
        """)
        rows = cur.fetchall()
    return [Violation("1_orphan_history", f"event_id={r[0]} has {r[1]} outbox rows (expected 1)") for r in rows]


def check_2_stale_unpublished(conn: psycopg.Connection) -> list[Violation]:
    """No unpublished outbox row older than UNPUBLISHED_MAX_SECS (quarantined rows are flagged separately)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, topic, key,
                   extract(epoch from (now() - created_at))::int AS age_secs,
                   failed_at IS NOT NULL AS quarantined
            FROM outbox_events
            WHERE published_at IS NULL
              AND created_at < now() - interval '%(secs)s seconds'
            ORDER BY created_at
            LIMIT 20
        """ % {"secs": UNPUBLISHED_MAX_SECS})
        rows = cur.fetchall()
    result = []
    for r in rows:
        level = "QUARANTINED" if r[4] else "UNPUBLISHED"
        result.append(Violation(f"2_stale_{level.lower()}", f"event_id={r[0]} topic={r[1]} key={r[2]} age={r[3]}s"))
    return result


def check_3_event_chain(conn: psycopg.Connection) -> list[Violation]:
    """For each product, old_price[n] must equal new_price[n-1] in publish_order."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH ordered AS (
                SELECT
                    key AS product_id,
                    (payload->>'old_price')::numeric AS old_price,
                    (payload->>'new_price')::numeric AS new_price,
                    publish_order,
                    lag((payload->>'new_price')::numeric) OVER (
                        PARTITION BY key ORDER BY publish_order
                    ) AS prev_new_price
                FROM outbox_events
                WHERE topic = 'price.changed'
                  AND published_at IS NOT NULL
            )
            SELECT product_id, publish_order, old_price, prev_new_price
            FROM ordered
            WHERE prev_new_price IS NOT NULL
              AND old_price != prev_new_price
            LIMIT 20
        """)
        rows = cur.fetchall()
    return [
        Violation("3_broken_chain", f"product={r[0]} at publish_order={r[1]}: old_price={r[2]} but prev new_price={r[3]}")
        for r in rows
    ]


def check_4_current_price(conn: psycopg.Connection) -> list[Violation]:
    """products.current_price must equal the new_price of its latest published event."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (
                SELECT DISTINCT ON (key)
                    key::bigint AS product_id,
                    (payload->>'new_price')::numeric AS event_price
                FROM outbox_events
                WHERE topic = 'price.changed' AND published_at IS NOT NULL
                ORDER BY key, publish_order DESC
            )
            SELECT p.id, p.current_price, l.event_price
            FROM products p
            JOIN latest l ON l.product_id = p.id
            WHERE p.current_price != l.event_price
            LIMIT 20
        """)
        rows = cur.fetchall()
    return [
        Violation("4_price_mismatch", f"product={r[0]} db_price={r[1]} last_event_price={r[2]}")
        for r in rows
    ]


def check_5_total_stock(conn: psycopg.Connection) -> list[Violation]:
    """products.total_stock must equal SUM(inventory.qty) for every product."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT p.id, p.total_stock, coalesce(sum(i.qty), 0) AS inv_sum
            FROM products p
            LEFT JOIN inventory i ON i.product_id = p.id
            GROUP BY p.id, p.total_stock
            HAVING p.total_stock != coalesce(sum(i.qty), 0)
            LIMIT 20
        """)
        rows = cur.fetchall()
    return [
        Violation("5_stock_mismatch", f"product={r[0]} total_stock={r[1]} sum_inventory={r[2]}")
        for r in rows
    ]


def check_6_cache_staleness(conn: psycopg.Connection) -> list[Violation]:
    """After quiescence, cached product:{id} must agree with DB current_price."""
    try:
        import redis as redis_lib   # type: ignore
    except ImportError:
        return [Violation("6_cache_staleness", "SKIP: redis-py not installed (pip install redis)")]

    redis_url = os.getenv("REDIS_URL", f"redis://{os.getenv('REDIS_HOST','127.0.0.1')}:{os.getenv('REDIS_PORT','6379')}")
    try:
        r = redis_lib.from_url(redis_url, socket_connect_timeout=2)
        r.ping()
    except Exception as e:
        return [Violation("6_cache_staleness", f"SKIP: Redis not reachable ({e})")]

    print(f"  Waiting {QUIESCENCE_SECS}s for quiescence ...", flush=True)
    time.sleep(QUIESCENCE_SECS)

    violations = []
    with conn.cursor() as cur:
        cur.execute("SELECT id, current_price FROM products WHERE is_active LIMIT 500")
        products = cur.fetchall()

    for product_id, db_price in products:
        raw = r.get(f"product:{product_id}")
        if raw is None:
            continue    # cache miss is fine — not stale
        try:
            cached = json.loads(raw)
            cached_price = cached.get("currentPrice")
        except Exception:
            violations.append(Violation("6_cache_staleness", f"product={product_id} unparseable cache value"))
            continue
        if cached_price is not None and abs(float(cached_price) - float(db_price)) > 0.001:
            violations.append(Violation("6_cache_staleness",
                f"product={product_id} cache={cached_price} db={db_price}"))
    return violations


def check_7_duplicate_event_ids(conn: psycopg.Connection) -> list[Violation]:
    """outbox_events.id must be unique (the PK enforces it, but verify no silent truncation)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, count(*) FROM outbox_events
            GROUP BY id HAVING count(*) > 1 LIMIT 10
        """)
        rows = cur.fetchall()
    return [Violation("7_duplicate_event_id", f"event_id={r[0]} appears {r[1]} times") for r in rows]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
def main() -> None:
    print("Phase 3 invariant checker", flush=True)
    print("=" * 60)

    try:
        conn = db_connect()
    except Exception as e:
        print(f"ERROR: cannot connect to database: {e}", file=sys.stderr)
        sys.exit(2)

    checks = [
        ("1  Orphan history rows",        check_1_orphan_history),
        ("2  Stale unpublished events",    check_2_stale_unpublished),
        ("3  Event chain continuity",      check_3_event_chain),
        ("4  Current price matches event", check_4_current_price),
        ("5  Total stock == inventory",    check_5_total_stock),
        ("6  Cache staleness",             check_6_cache_staleness),
        ("7  Duplicate event ids",         check_7_duplicate_event_ids),
    ]

    all_violations: list[Violation] = []
    for name, fn in checks:
        print(f"\nChecking {name} ...", flush=True)
        try:
            violations = fn(conn)
        except Exception as e:
            violations = [Violation(name, f"ERROR: {e}")]
        for v in violations:
            print(f"  FAIL [{v.check}] {v.detail}")
        if not violations:
            print("  OK")
        all_violations.extend(violations)

    conn.close()

    print("\n" + "=" * 60)
    if all_violations:
        print(f"FAILED: {len(all_violations)} violation(s)")
        sys.exit(1)
    else:
        print("ALL CHECKS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
