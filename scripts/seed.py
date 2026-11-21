"""Reload development seeds in one transaction and validate the Phase 1 contract."""

import argparse
from collections import Counter
from itertools import accumulate
import os
from pathlib import Path
from random import Random
from uuid import NAMESPACE_URL, uuid5

import bcrypt
from dotenv import load_dotenv
from faker import Faker
import psycopg

from seed_products import CATEGORIES, DEMO_LAPTOP_SKU, build_catalogue

PROFILES = {"small": (2000, 200), "full": (50000, 9998)}
DEMO_EMAIL = "demo@carrefour.test"
ADMIN_EMAIL = "admin@carrefour.test"
STORES = (
    ("DXB-MOE", "Mall of the Emirates", "Dubai", 25.1182, 55.2007),
    ("DXB-CC", "City Centre Deira", "Dubai", 25.2522, 55.3324),
    ("DXB-MIR", "City Centre Mirdif", "Dubai", 25.2164, 55.4070),
    ("DXB-IAM", "Ibn Battuta Mall", "Dubai", 25.0435, 55.1194),
    ("DXB-FC", "Festival City", "Dubai", 25.2210, 55.3520),
    ("AUH-YAS", "Yas Mall", "Abu Dhabi", 24.4880, 54.6079),
    ("AUH-MAR", "Marina Mall", "Abu Dhabi", 24.4760, 54.3214),
    ("AUH-WAH", "Al Wahda Mall", "Abu Dhabi", 24.4706, 54.3734),
    ("AUH-DAL", "Dalma Mall", "Abu Dhabi", 24.3363, 54.5238),
    ("SHJ-CC", "City Centre Sharjah", "Sharjah", 25.3292, 55.3998),
    ("SHJ-ZAH", "City Centre Al Zahia", "Sharjah", 25.3209, 55.4550),
    ("SHJ-SAH", "Sahara Centre", "Sharjah", 25.2987, 55.3707),
)
TABLES = ("products", "stores", "inventory", "users", "user_preferences",
          "wishlists", "wishlist_items", "carts")


def copy_rows(db, target: str, rows) -> None:
    with db.cursor() as cursor, cursor.copy(f"COPY {target} FROM STDIN") as copy:
        for row in rows:
            copy.write_row(row)


def fixtures_id(key: str):
    return uuid5(NAMESPACE_URL, f"https://carrefour.test/phase1/{key}")


def load_catalogue(db, catalogue, rng: Random):
    copy_rows(db, "stores (code, name, city, latitude, longitude)", STORES)
    stores = db.execute("SELECT id, code FROM stores ORDER BY id").fetchall()
    store_ids = [store_id for store_id, _ in stores]
    demo_store_id = next(store_id for store_id, code in stores if code == "DXB-MOE")
    copy_rows(
        db,
        "products (sku, name_en, category, subcategory, image_url, current_price, list_price, source, external_id)",
        (
            (p.sku, p.name, p.category, p.subcategory, p.image_url, p.price, p.list_price, p.source, p.external_id)
            for p in catalogue
        ),
    )
    products = db.execute("SELECT id, current_price, sku FROM products ORDER BY id").fetchall()

    def inventory_rows():
        for product_id, _, sku in products:
            stock_stores = rng.sample(store_ids, rng.randint(2, 5))
            if sku == DEMO_LAPTOP_SKU and demo_store_id not in stock_stores:
                stock_stores[0] = demo_store_id
            for store_id in stock_stores:
                qty = 12 if sku == DEMO_LAPTOP_SKU and store_id == demo_store_id else rng.randint(0, 28)
                yield product_id, store_id, qty

    copy_rows(db, "inventory (product_id, store_id, qty)", inventory_rows())
    db.execute("""
        UPDATE products AS p SET total_stock = totals.qty
        FROM (SELECT product_id, sum(qty) AS qty FROM inventory GROUP BY product_id) AS totals
        WHERE totals.product_id = p.id
    """)
    return products, store_ids, demo_store_id


def load_accounts(db, fake_count: int, store_ids, demo_store_id, rng: Random):
    faker = Faker(["en_US", "en_GB"])
    faker.seed_instance(5012)
    password = bcrypt.hashpw(b"Demo@1234", bcrypt.gensalt(rounds=10)).decode("ascii")
    users = [
        (fixtures_id(email), email, password, name, role, demo_store_id)
        for email, name, role in (
            (DEMO_EMAIL, "Demo Customer", "customer"),
            (ADMIN_EMAIL, "Demo Admin", "admin"),
        )
    ]
    for number in range(1, fake_count + 1):
        email = f"customer-{number:05d}@carrefour.test"
        users.append((fixtures_id(email), email, password, faker.name(), "customer", rng.choice(store_ids)))

    copy_rows(db, "users (id, email, password_hash, full_name, role, home_store_id)", users)
    copy_rows(db, "user_preferences (user_id)", ((row[0],) for row in users))
    copy_rows(db, "carts (id, user_id, status)", (
        (fixtures_id(f"cart/{email}"), user_id, "active") for user_id, email, *_ in users
    ))
    return users


def load_wishlists(db, users, products, rng: Random):
    wishlists = []
    for index, (user_id, email, *_) in enumerate(users):
        extra_count = 0 if index < 2 else (index - 2) % 3
        names = ("My Wishlist", "Back to School", "Weekend Picks")
        for number, name in enumerate(names[:extra_count + 1]):
            wishlists.append((fixtures_id(f"wishlist/{email}/{number}"), user_id, name, number == 0))

    copy_rows(db, "wishlists (id, user_id, name, is_default)", wishlists)

    prices = {product_id: price for product_id, price, _ in products}
    demo_laptop = next(product_id for product_id, _, sku in products if sku == DEMO_LAPTOP_SKU)
    ranked_ids = list(prices)
    rng.shuffle(ranked_ids)
    weights = list(accumulate(1 / rank**0.9 for rank in range(1, len(ranked_ids) + 1)))

    def items():
        demo_id = fixtures_id(DEMO_EMAIL)
        for wishlist_id, user_id, _, _ in wishlists:
            chosen = {demo_laptop: None} if user_id == demo_id else {}
            while len(chosen) < 10:
                for product_id in rng.choices(ranked_ids, cum_weights=weights, k=10 - len(chosen)):
                    chosen[product_id] = None
            for product_id in chosen:
                yield wishlist_id, user_id, product_id, prices[product_id]

    copy_rows(db, "wishlist_items (wishlist_id, user_id, product_id, added_price)", items())


def validate(db, size: int, user_count: int, expected_items: int):
    counts = {table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in TABLES}
    expected_counts = {
        "products": size, "stores": len(STORES), "users": user_count,
        "user_preferences": user_count, "carts": user_count, "wishlist_items": expected_items,
    }
    for table, expected in expected_counts.items():
        if counts[table] != expected:
            raise ValueError(f"Expected {expected} {table} rows, found {counts[table]}")
    category_counts = Counter(dict(db.execute("SELECT category, count(*) FROM products GROUP BY category")))
    if set(category_counts) != set(CATEGORIES):
        raise ValueError(f"Unexpected categories: {sorted(category_counts)}")

    valid_catalogue, laptops = db.execute("""
        SELECT count(*) FILTER (
            WHERE current_price > 0 AND list_price >= current_price
            AND image_url IS NOT NULL AND source IS NOT NULL AND external_id IS NOT NULL
            AND currency = 'AED'
        ), count(*) FILTER (
            WHERE category = 'Electronics' AND subcategory = 'Laptops'
            AND current_price BETWEEN 1500 AND 6000
        )
        FROM products
    """).fetchone()
    if valid_catalogue != size or laptops < 30:
        raise ValueError(f"Catalogue checks failed: {valid_catalogue} valid products, {laptops} laptops")

    mismatches = db.execute("""
        SELECT count(*) FROM products AS p LEFT JOIN (
            SELECT product_id, sum(qty) AS qty FROM inventory GROUP BY product_id
        ) AS totals ON p.id = totals.product_id
        WHERE p.total_stock IS DISTINCT FROM totals.qty
    """).fetchone()[0]
    if mismatches:
        raise ValueError(f"{mismatches} products have inconsistent inventory")

    defaults = db.execute(
        "SELECT count(*) FROM wishlists WHERE is_default AND name = 'My Wishlist'"
    ).fetchone()[0]
    if defaults != user_count:
        raise ValueError("Every user must have one default wishlist")
    demo_items, demo_laptops = db.execute("""
        SELECT count(*), count(*) FILTER (
            WHERE p.sku = %s AND p.current_price = 3000 AND wi.added_price = 3000
        )
        FROM wishlist_items AS wi
        JOIN wishlists AS w ON w.id = wi.wishlist_id
        JOIN users AS u ON u.id = w.user_id
        JOIN products AS p ON p.id = wi.product_id
        WHERE u.email = %s AND w.is_default
    """, (DEMO_LAPTOP_SKU, DEMO_EMAIL)).fetchone()
    if not 8 <= demo_items <= 12 or demo_laptops != 1:
        raise ValueError("Demo wishlist is missing its expected items")
    return counts


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=PROFILES, default=os.environ.get("SEED_PROFILE", "full"))
    parser.add_argument("--synthetic-only", action="store_true", help="Use generated products for offline development")
    args = parser.parse_args()
    if args.profile not in PROFILES:
        parser.error(f"invalid SEED_PROFILE {args.profile!r}, expected small or full")
    size, fake_count = PROFILES[args.profile]
    rng = Random(5012)
    catalogue = build_catalogue(size, rng, args.synthetic_only)
    expected_items = 10 * (2 + sum(1 + index % 3 for index in range(fake_count)))

    with psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "wishlist"),
        user=os.environ.get("POSTGRES_USER", "wishlist"),
        password=os.environ.get("POSTGRES_PASSWORD"),
    ) as db:
        db.execute("SELECT pg_advisory_xact_lock(984661562)")
        db.execute("""
            TRUNCATE TABLE
            refresh_tokens,
                wishlist_item_claims, wishlist_items, wishlist_shares, wishlists,
                cart_items, carts, notification_deliveries, notifications, user_preferences,
                users, product_similarity, offers, inventory, products, stores,
                outbox_events, processed_events, analytics_events, price_history
            RESTART IDENTITY
        """)
        products, store_ids, demo_store_id = load_catalogue(db, catalogue, rng)
        users = load_accounts(db, fake_count, store_ids, demo_store_id, rng)
        load_wishlists(db, users, products, rng)
        counts = validate(db, size, len(users), expected_items)

    source_counts = Counter(product.source for product in catalogue)
    print(f"Loaded {args.profile} profile (" + ", ".join(f"{count:,} {source}" for source, count in source_counts.items()) + ")")
    for table, count in counts.items():
        print(f"{table}: {count:,}")


if __name__ == "__main__":
    main()
