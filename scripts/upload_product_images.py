#!/usr/bin/env python3
"""Upload catalogue images to Cloudinary, then update existing product rows only."""
import argparse
import csv
import os
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
AMAZON_SOURCE = "amazon_electronics_2023"


def falconbook_candidates():
    folder = ROOT / "product_images"
    with (folder / "falconbook-mapping.csv").open(newline="") as stream:
        rows = list(csv.DictReader(stream))
    return [(r["sku"], str(folder / r["file"]), r["public_id"]) for r in rows]


def amazon_candidates(dataset, rate):
    # Reuse the original importer's ASIN extraction, validation and deduplication.
    from import_amazon_electronics import prepare
    rows, stats = prepare(dataset, rate, True)
    result = []
    for row in rows:
        sku, image, asin = row[0], row[4], row[10]
        if image:
            url = urlsplit(image)
            if url.scheme == "https" and url.hostname == "m.media-amazon.com" and not url.username and not url.password:
                result.append((sku, image, f"carrefour/amazon/{asin}"))
    print(f"Dataset rows: {stats['rows']}; valid unique products: {stats['ready']}; eligible image links: {len(result)}")
    return result


def connect_db():
    import psycopg
    url = os.getenv("DATABASE_URL")
    if url:
        return psycopg.connect(url, autocommit=True, connect_timeout=10)
    return psycopg.connect(host=os.getenv("POSTGRES_HOST", "127.0.0.1"),
                           port=os.getenv("POSTGRES_PORT", "5432"),
                           dbname=os.getenv("POSTGRES_DB", "wishlist"),
                           user=os.getenv("POSTGRES_USER", "wishlist"),
                           password=os.getenv("POSTGRES_PASSWORD"),
                           autocommit=True, connect_timeout=10)


def eligible(current, original):
    return not current or current.startswith("https://placehold.co/") or current == original


def run(args, candidates):
    from dotenv import load_dotenv
    import cloudinary
    import cloudinary.uploader

    load_dotenv(ROOT / ".env")
    if not os.getenv("CLOUDINARY_URL"):
        cloudinary.config(cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
                          api_key=os.environ["CLOUDINARY_API_KEY"],
                          api_secret=os.environ["CLOUDINARY_API_SECRET"], secure=True)
    else:
        cloudinary.config(secure=True)

    # If Redis is unavailable the existing TTL will eventually expire old details.
    cache = None
    try:
        import redis
        cache = (redis.Redis.from_url(os.environ["REDIS_URL"], socket_timeout=1, socket_connect_timeout=1)
                 if os.getenv("REDIS_URL") else
                 redis.Redis(host=os.getenv("REDIS_HOST", "127.0.0.1"),
                             port=int(os.getenv("REDIS_PORT", "6379")), socket_timeout=1, socket_connect_timeout=1))
        cache.ping()
    except Exception:
        cache = None
        print("Redis unavailable; existing detail cache will expire by TTL.")

    uploaded = {}
    updated = failures = skipped = processed = invalidation_failures = 0
    with connect_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, sku, image_url FROM products WHERE source = %s", (AMAZON_SOURCE if args.command == "amazon" else "synthetic",))
            products = {sku: (pid, image) for pid, sku, image in cur.fetchall()}
            for sku, source, public_id in candidates:
                product = products.get(sku)
                if not product or not eligible(product[1], source):
                    skipped += 1
                    continue
                if args.limit is not None and processed >= args.limit:
                    break
                processed += 1
                pid, previous = product
                try:
                    if public_id not in uploaded:
                        result = cloudinary.uploader.upload(source, public_id=public_id,
                                                             resource_type="image", overwrite=False,
                                                             unique_filename=False, timeout=60)
                        secure_url = result["secure_url"]
                        if not secure_url.startswith("https://"):
                            raise ValueError("Cloudinary did not return an HTTPS URL")
                        uploaded[public_id] = secure_url.replace("/image/upload/", "/image/upload/c_limit,w_1000,h_1000/f_auto,q_auto/", 1)
                    # Compare the previous value so a concurrent image change is never overwritten.
                    cur.execute("UPDATE products SET image_url = %s WHERE id = %s AND image_url IS NOT DISTINCT FROM %s", (uploaded[public_id], pid, previous))
                    if not cur.rowcount:
                        skipped += 1
                        continue
                    updated += 1
                    if cache is not None:
                        try:
                            cache.delete(f"product:{pid}", f"lock:product:{pid}")
                        except Exception:
                            invalidation_failures += 1
                    print(f"OK {sku}")
                except Exception as exc:
                    failures += 1
                    # Avoid logging credentials or full external-service error bodies.
                    print(f"FAILED {sku}: {type(exc).__name__}")
    print(f"Updated {updated}; reused/uploaded {len(uploaded)} distinct assets; skipped {skipped}; failed {failures}; cache invalidation failures {invalidation_failures}")
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    f = sub.add_parser("falconbook", help="Assign generated laptop photos to 40 synthetic SKUs")
    f.add_argument("--apply", action="store_true")
    f.add_argument("--limit", type=int, default=None)
    a = sub.add_parser("amazon", help="Upload authorized dataset photos and update imported SKUs")
    a.add_argument("dataset", type=Path)
    a.add_argument("--inr-to-aed", type=Decimal, default=Decimal("0.04"))
    a.add_argument("--apply", action="store_true")
    a.add_argument("--limit", type=int, default=20, help="Maximum eligible products attempted (default 20)")
    a.add_argument("--all", action="store_true", help="Process all eligible products instead of a limited batch")
    args = parser.parse_args()
    if args.command == "amazon":
        if not args.inr_to_aed.is_finite() or args.inr_to_aed <= 0:
            parser.error("Exchange rate must be positive and finite")
        if args.all:
            args.limit = None
        candidates = amazon_candidates(args.dataset, args.inr_to_aed)
    else:
        candidates = falconbook_candidates()
        if not all(Path(source).is_file() for _, source, _ in candidates):
            parser.error("One or more mapped laptop assets are missing")
    if args.limit is not None and args.limit < 1:
        parser.error("Limit must be positive")
    print(f"Candidate catalogue SKUs: {len(candidates)}; limit: {args.limit if args.limit is not None else 'all'}")
    if not args.apply:
        print("Dry run: no uploads or database changes. Actual matched rows depend on the target database.")
        return 0
    return run(args, candidates)


if __name__ == "__main__":
    raise SystemExit(main())
