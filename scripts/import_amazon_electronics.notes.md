# Amazon electronics importer — implementation notes

Place both files in Carrefour_Project/scripts/. The importer accepts the original ZIP directly or the extracted electronics_product.csv. It adds products to the existing wishlist database; no schema migration is required.

## Run on your Mac

From the repository root, with PostgreSQL running and stores seeded:

```bash
python3 -m pip install -r scripts/seed-requirements.txt
python3 scripts/import_amazon_electronics.py "$HOME/Downloads/archive (3)(2).zip" --inr-to-aed 0.04
```

0.04 is an illustrative demo multiplier, **not a verified exchange rate**. Choose a documented rate appropriate to your dataset. The default run does not connect to PostgreSQL.

After inspecting the counts and confirming the local database configuration:

```bash
python3 scripts/import_amazon_electronics.py "$HOME/Downloads/archive (3)(2).zip" --inr-to-aed 0.04 --apply
```

The script uses the existing root .env and respects explicitly exported environment variables, including DATABASE_URL if present. Use your development database, not production.

## What each function does

| Function | Explanation |
|---|---|
| open_csv | Reads the CSV directly from ZIP or disk. |
| positive_decimal | Removes Indian currency formatting and rejects invalid/non-positive values. |
| aed | Converts prices using Decimal and rounds to two places; checks NUMERIC(10,2) bounds. |
| extract_asin | Extracts Amazon product ID from the Amazon India product URL. |
| classify | Applies simple keyword rules to infer subcategories; fallback is Other electronics. |
| prepare | Validates rows, deduplicates by ASIN, prepares SQL tuples and records counts. |
| quantity | Computes reproducible fake stock of 0–20 per store from ASIN and store ID. |
| insert_products | COPY into a temporary staging table, bulk insert products, COPY inventory, update aggregate stock. |
| main | Parses arguments; requires explicit --apply for database changes. |

## Data mapping

| Dataset | PostgreSQL |
|---|---|
| name | name_en |
| ASIN extracted from link | external_id |
| AMZ23- + ASIN | sku |
| inferred classification | subcategory (category is Electronics) |
| discount price, or actual price fallback | current_price |
| actual price if at least current_price | list_price |
| valid rating | rating |
| image | image_url only with --include-images and appropriate usage rights |
| original prices, currency, source URL, rating count, conversion rate | attributes JSONB |
| amazon_electronics_2023 | source |
| sum of simulated store quantities | total_stock |

Brand, descriptions, Arabic names and embeddings stay NULL; the dataset does not reliably supply them. Images are not downloaded. No real stock or historical prices are claimed.

## Why the SQL design matters

The temporary staging table is isolated per SQL session. COPY sends rows in bulk. The UNIQUE(source, external_id) constraint plus ON CONFLICT DO NOTHING makes repeat imports safe. Existing rows, prices and inventory are not overwritten, including products whose price has changed through your admin API. A different unique-SKU collision aborts the transaction rather than silently replacing a product.

Only newly inserted products receive inventory. All database changes happen in one transaction; a failure rolls back products and stock together. No outbox events are created for this offline creation of new products. Do not use this importer to update existing products; use the real admin API for price/stock changes. The import does not backfill history or generate embeddings.

## Verify in DBeaver

```sql
SELECT COUNT(*) FROM products WHERE source = 'amazon_electronics_2023';

SELECT subcategory, COUNT(*) FROM products
WHERE source = 'amazon_electronics_2023'
GROUP BY subcategory ORDER BY COUNT(*) DESC;

SELECT id, sku, name_en, current_price, list_price, total_stock
FROM products WHERE source = 'amazon_electronics_2023' LIMIT 20;

SELECT p.id, p.total_stock, COALESCE(SUM(i.qty), 0) AS inventory_sum
FROM products p LEFT JOIN inventory i ON i.product_id = p.id
WHERE p.source = 'amazon_electronics_2023'
GROUP BY p.id, p.total_stock
HAVING p.total_stock <> COALESCE(SUM(i.qty), 0);
```

The last query should return no rows. Repeat the import with the same dataset and rate: it should insert zero new products.

## Verification performed

Dry run on uploaded ZIP at demo multiplier 0.04: 9,600 rows, 70 rejected, 88 additional duplicate rows, 9,442 unique ready-to-insert products. Classification is heuristic, not a trained model; manually assess the fallback and overlapping categories before using them for recommendations. No live database writes or live PostgreSQL COPY integration test were performed here.
