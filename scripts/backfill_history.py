"""
12-month price history backfill for the price_daily continuous aggregate.

WHY THIS WRITES DIRECTLY TO THE DATABASE (not via the admin API):
  2,000 products x 365 days = 730,000 rows. Calling the admin API would generate 730,000
  outbox events that nothing downstream needs, and would take hours at ~10 req/s. Direct
  bulk COPY is the right call for a one-shot historical seed. Source is always 'backfill'
  so the invariant checker can exclude these rows from event-chain checks.

PRICE MODEL:
  Random walk with mean reversion, walked backwards from today so the last value equals
  each product's current_price exactly. Sale windows simulate White Friday, Ramadan, and
  Dubai Shopping Festival with 10-30% drops for 3-10 days.

IDEMPOTENCY:
  Re-running deletes all existing 'backfill' rows per time chunk before inserting so the
  script can be run multiple times safely.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from random import Random
from uuid import uuid4

from dotenv import load_dotenv
import psycopg

# Load repo-root .env (works from scripts/ or repo root)
load_dotenv(Path(__file__).parent.parent / ".env")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DAYS = 365

@dataclass
class SaleWindow:
    name: str
    month: int
    day_start: int
    day_end: int
    drop_pct_min: float
    drop_pct_max: float
    duration_days_min: int
    duration_days_max: int

SALE_WINDOWS = [
    SaleWindow("White Friday",          11, 20, 30, 0.10, 0.30, 3, 7),
    SaleWindow("Ramadan",               3,  10, 31, 0.08, 0.20, 10, 21),
    SaleWindow("Dubai Shopping Fest",   1,  3,  25, 0.07, 0.18, 5, 10),
]

FILS_MAX = 9_999_999_99          # 99,999,999.99 AED in fils
FILS_MIN_PERCENT = 0.50          # never go below 50% of current price
FILS_MAX_PERCENT = 2.00          # never above 200%


# ---------------------------------------------------------------------------
# PRNG helpers
# ---------------------------------------------------------------------------
def walk_step(rng: Random, fils: int, base_fils: int) -> int:
    """One day's price movement. Going backwards, slight upward bias (prices were lower before)."""
    # -0.5% to +1.5% daily change (walking forward in time makes prices drift down toward today)
    pct = rng.uniform(-0.015, 0.005)
    new = round(fils * (1 + pct))
    low = round(base_fils * FILS_MIN_PERCENT)
    high = round(base_fils * FILS_MAX_PERCENT)
    return max(low, min(high, max(1, new)))


def apply_sale_windows(year: int, rng: Random) -> dict[date, float]:
    """Return {date: drop_multiplier} for every day in a sale window in `year`."""
    drops: dict[date, float] = {}
    for w in SALE_WINDOWS:
        # Find the start of the window
        try:
            window_start = date(year, w.month, w.day_start)
        except ValueError:
            continue
        # Pick a sale event somewhere inside the window
        offset = rng.randint(0, w.day_end - w.day_start)
        sale_start = window_start + timedelta(days=offset)
        duration = rng.randint(w.duration_days_min, w.duration_days_max)
        drop = rng.uniform(w.drop_pct_min, w.drop_pct_max)
        for d in range(duration):
            drops[sale_start + timedelta(days=d)] = 1.0 - drop
    return drops


def build_prices(product_id: int, current_price_str: str, rng: Random) -> list[tuple[date, float]]:
    """
    Build a list of (day, price_aed) for the past DAYS days.
    Walks backwards from today; the last entry in the returned list is today and equals current_price.
    """
    today = date.today()
    base_fils = round(float(current_price_str) * 100)
    current_fils = base_fils

    # Build sale-window calendars for the two years we span
    this_year_sales = apply_sale_windows(today.year, Random(rng.randint(0, 2**32)))
    last_year_sales = apply_sale_windows(today.year - 1, Random(rng.randint(0, 2**32)))
    sales = {**last_year_sales, **this_year_sales}

    # Walk backwards
    backwards: list[tuple[date, int]] = [(today, current_fils)]
    fils = current_fils
    for i in range(1, DAYS):
        day = today - timedelta(days=i)
        fils = walk_step(rng, fils, base_fils)
        if day in sales:
            fils = max(1, round(fils / sales[day]))   # reverse a sale -> higher price in the past
        backwards.append((day, fils))

    # Return in chronological order (oldest first)
    return [(d, f / 100) for d, f in reversed(backwards)]


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def db_connect(args: argparse.Namespace) -> psycopg.Connection:
    url = getattr(args, "database_url", None) or os.getenv("DATABASE_URL")
    if url:
        return psycopg.connect(url)
    return psycopg.connect(
        host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        dbname=os.getenv("POSTGRES_DB", "wishlist"),
        user=os.getenv("POSTGRES_USER", "wishlist"),
        password=os.getenv("POSTGRES_PASSWORD", "wishlist_local"),
    )


def clear_backfill_rows(conn: psycopg.Connection, start_date: date, end_date: date) -> int:
    """
    Delete existing backfill rows in chunks (1-week slices) to avoid locking the entire
    price_history hypertable. TimescaleDB compresses chunks older than 30 days, so we
    decompress each chunk before deleting from it.
    """
    deleted = 0
    cursor = start_date
    while cursor <= end_date:
        chunk_end = min(cursor + timedelta(days=7), end_date + timedelta(days=1))
        # Decompress the chunk first if it exists and is compressed (noop if not compressed)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT decompress_chunk(c.oid, true)
                FROM timescaledb_information.chunks c
                WHERE c.hypertable_name = 'price_history'
                  AND c.range_start <= %s AND c.range_end > %s
                  AND c.is_compressed
                """,
                (chunk_end, cursor),
            )
            cur.execute(
                "DELETE FROM price_history WHERE source = 'backfill' AND recorded_at >= %s AND recorded_at < %s",
                (
                    datetime(cursor.year, cursor.month, cursor.day, tzinfo=timezone.utc),
                    datetime(chunk_end.year, chunk_end.month, chunk_end.day, tzinfo=timezone.utc),
                ),
            )
            deleted += cur.rowcount
        conn.commit()
        cursor = chunk_end
    return deleted


def bulk_insert(conn: psycopg.Connection, rows: list[tuple]) -> int:
    """COPY rows into price_history. Each row: (product_id, price, currency, source, event_id, recorded_at)."""
    with conn.cursor() as cur:
        with cur.copy(
            "COPY price_history (product_id, price, currency, source, event_id, recorded_at) FROM STDIN"
        ) as copy:
            for row in rows:
                copy.write_row(row)
    conn.commit()
    return len(rows)


def refresh_aggregate(conn: psycopg.Connection) -> None:
    """
    Force a full refresh of price_daily so backfilled data older than 3 days is included.
    CALL cannot run inside a transaction block, so we use autocommit.
    """
    old_autocommit = conn.autocommit
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("CALL refresh_continuous_aggregate('price_daily', NULL, now())")
    conn.autocommit = old_autocommit


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill 12 months of price history")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed (default: 42)")
    parser.add_argument("--database-url", default=None, help="Postgres connection URL")
    parser.add_argument("--dry-run", action="store_true", help="Build rows but do not write them")
    args = parser.parse_args()

    rng = Random(args.seed)

    conn = db_connect(args)
    start_time = time.time()

    with conn.cursor() as cur:
        cur.execute("SELECT id, current_price FROM products WHERE is_active ORDER BY id")
        products = cur.fetchall()

    print(f"Building history for {len(products)} active products (seed={args.seed}) ...")

    today = date.today()
    start_date = today - timedelta(days=DAYS - 1)

    if not args.dry_run:
        print("Clearing existing backfill rows ...")
        deleted = clear_backfill_rows(conn, start_date, today)
        print(f"  Deleted {deleted} existing backfill rows")

    total_rows = 0
    batch: list[tuple] = []
    BATCH_SIZE = 50_000

    for product_id, current_price_str in products:
        prices = build_prices(product_id, current_price_str, Random(rng.randint(0, 2**32)))
        for day, price_aed in prices:
            recorded_at = datetime(day.year, day.month, day.day, 12, 0, 0, tzinfo=timezone.utc)
            batch.append((
                product_id,
                f"{price_aed:.2f}",
                "AED",
                "backfill",
                str(uuid4()),
                recorded_at,
            ))
            if len(batch) >= BATCH_SIZE and not args.dry_run:
                bulk_insert(conn, batch)
                total_rows += len(batch)
                batch = []
                print(f"  {total_rows:,} rows written ...")

    if batch and not args.dry_run:
        bulk_insert(conn, batch)
        total_rows += len(batch)

    if args.dry_run:
        total_rows = len(batch) + (total_rows - len(batch))
        print(f"Dry run: would have written {len(products) * DAYS:,} rows")
    else:
        print(f"Inserted {total_rows:,} rows total")
        print("Refreshing price_daily aggregate (this may take a moment) ...")
        refresh_aggregate(conn)
        print("Aggregate refresh complete")

    elapsed = time.time() - start_time
    print(f"Done in {elapsed:.1f}s")
    conn.close()


if __name__ == "__main__":
    main()
