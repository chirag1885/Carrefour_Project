#!/usr/bin/env python3
"""Add historical Amazon catalogue products without updating existing products."""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import zipfile
from collections import Counter
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlsplit

SOURCE = "amazon_electronics_2023"
REQUIRED = {"name", "main_category", "sub_category", "image", "link",
            "ratings", "no_of_ratings", "discount_price", "actual_price"}
RULES = [
    ("Chargers and cables", r"\b(charger|charging cable|usb cable|adapter|power bank)\b"),
    ("Phone accessories", r"\b(case|cover|screen protector|tempered glass)\b"),
    ("Headphones", r"\b(headphones?|earphones?|earbuds?|headset|neckband|tws)\b"),
    ("Computer accessories", r"\b(keyboard|mouse|ssd|hard drive|pendrive|flash drive|monitor|router|webcam|usb hub)\b"),
    ("Smartwatches", r"\b(smart\s?watch|fitness band)\b"),
    ("Cameras", r"\b(camera|dslr|camcorder|cctv)\b"),
    ("Televisions", r"\b(tv|television|smart tv)\b"),
    ("Laptops", r"\b(laptop|notebook|macbook|chromebook)\b"),
    ("Tablets", r"\b(tablet|ipad)\b"),
    ("Smartphones", r"\b(smartphone|mobile phone|iphone|redmi|oneplus nord|galaxy|realme|poco)\b"),
    ("Speakers", r"\b(speaker|soundbar|home theatre)\b"),
]

def positive_decimal(text):
    try:
        value = Decimal(text.strip().replace("₹", "").replace(",", ""))
        return value if value.is_finite() and value > 0 else None
    except (InvalidOperation, AttributeError):
        return None

def aed(value, rate):
    if value is None:
        return None
    result = (value * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return result if Decimal("0.01") <= result <= Decimal("99999999.99") else None

def classify(name):
    return next((label for label, pattern in RULES if re.search(pattern, name, re.I)),
                "Other electronics")

def extract_asin(link):
    url = urlsplit(link)
    if url.scheme != "https" or url.hostname not in {"www.amazon.in", "amazon.in"}:
        return None
    match = re.search(r"/dp/([A-Z0-9]{10})(?:/|$)", url.path)
    return match.group(1) if match else None

@contextmanager
def open_csv(path):
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            with archive.open("electronics_product.csv") as raw:
                with io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as stream:
                    yield stream
    else:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            yield stream

def prepare(path, rate, include_images):
    products = {}
    stats = Counter()
    with open_csv(path) as stream:
        reader = csv.DictReader(stream)
        if not REQUIRED.issubset(reader.fieldnames or []):
            raise ValueError("Missing required CSV columns")
        for row in reader:
            stats["rows"] += 1
            name = row["name"].strip()
            asin = extract_asin(row["link"])
            discount = positive_decimal(row["discount_price"])
            actual = positive_decimal(row["actual_price"])
            price = aed(discount or actual, rate)
            if not name or not asin or price is None:
                stats["invalid_rows"] += 1
                continue
            if asin in products:
                stats["duplicate_valid_rows"] += 1
                continue
            rating = positive_decimal(row["ratings"])
            if rating is not None and rating <= 5:
                rating = rating.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
            else:
                rating = None
            reviews = row["no_of_ratings"].replace(",", "").strip()
            list_price = aed(actual, rate)
            if list_price is not None and list_price < price:
                list_price = None
            image = row["image"].strip()
            attrs = {
                "amazon_url": row["link"], "original_currency": "INR",
                "original_discount_price": str(discount) if discount else None,
                "original_actual_price": str(actual) if actual else None,
                "inr_to_aed_rate": str(rate), "rating_count": int(reviews) if reviews.isdecimal() else None,
                "dataset_category": row["main_category"], "dataset_subcategory": row["sub_category"],
                "category_inferred": True, "inventory_simulated": True,
            }
            products[asin] = ("AMZ23-" + asin, name, "Electronics", classify(name),
                              image if include_images and image.startswith("https://") else None,
                              json.dumps(attrs), price, list_price, rating, SOURCE, asin)
    stats["ready"] = len(products)
    return list(products.values()), stats

def quantity(asin, store_id):
    """Deterministic demo quantities, not real Amazon or Carrefour inventory."""
    digest = hashlib.sha256(f"{asin}:{store_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 21

def insert_products(rows):
    import psycopg
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    url = os.getenv("DATABASE_URL")
    kwargs = dict(host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
                  port=os.getenv("POSTGRES_PORT", "5432"),
                  dbname=os.getenv("POSTGRES_DB", "wishlist"),
                  user=os.getenv("POSTGRES_USER", "wishlist"),
                  password=os.getenv("POSTGRES_PASSWORD"), connect_timeout=10)
    with (psycopg.connect(url, connect_timeout=10) if url else psycopg.connect(**kwargs)) as conn:
        with conn.cursor() as c:
            c.execute("SELECT id FROM stores ORDER BY id")
            stores = [r[0] for r in c.fetchall()]
            if not stores:
                raise RuntimeError("No stores found. Seed stores before importing.")
            c.execute("""CREATE TEMP TABLE amazon_stage (
                sku text, name_en text, category text, subcategory text, image_url text,
                attributes jsonb, current_price numeric, list_price numeric, rating numeric,
                source text, external_id text
            ) ON COMMIT DROP""")
            with c.copy("COPY amazon_stage FROM STDIN") as copy:
                for row in rows:
                    copy.write_row(row)
            c.execute("""INSERT INTO products
                (sku,name_en,category,subcategory,image_url,attributes,current_price,
                 list_price,rating,source,external_id,currency)
                SELECT sku,name_en,category,subcategory,image_url,attributes,current_price,
                       list_price,rating,source,external_id,'AED' FROM amazon_stage
                ON CONFLICT (source,external_id) DO NOTHING RETURNING id,external_id""")
            inserted = c.fetchall()
            inventory = [(pid, sid, quantity(asin, sid))
                         for pid, asin in inserted for sid in stores]
            with c.copy("COPY inventory (product_id,store_id,qty) FROM STDIN") as copy:
                for row in inventory:
                    copy.write_row(row)
            c.execute("""UPDATE products p SET total_stock = totals.qty
                FROM (SELECT product_id,SUM(qty)::int AS qty FROM inventory
                      WHERE product_id=ANY(%s::bigint[]) GROUP BY product_id) totals
                WHERE p.id=totals.product_id""", ([pid for pid, _ in inserted],))
        # Connection context commits only if all product and inventory writes succeed.
    return len(inserted), len(inventory)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="CSV or original ZIP")
    parser.add_argument("--inr-to-aed", type=Decimal, required=True, help="Explicit INR-to-AED multiplier")
    parser.add_argument("--include-images", action="store_true", help="Store external URLs only if authorized")
    parser.add_argument("--apply", action="store_true", help="Actually insert rows; default is dry run")
    args = parser.parse_args()
    if not args.inr_to_aed.is_finite() or args.inr_to_aed <= 0:
        parser.error("Exchange rate must be positive and finite")
    rows, stats = prepare(args.dataset, args.inr_to_aed, args.include_images)
    print(json.dumps(dict(stats), indent=2))
    print("Categories:", dict(Counter(r[3] for r in rows)))
    if not args.apply:
        print("Dry run: no database connection or writes.")
        return
    inserted, inventory = insert_products(rows)
    print(f"Committed: {inserted} new products, {inventory} inventory rows; "
          f"{len(rows)-inserted} existing products left untouched.")

if __name__ == "__main__":
    main()
