import type { Queryable } from '../db/db.service';

/**
 * "Lowest in 90 days" for many products in ONE query (avoids N+1 on wishlist pages).
 * Needs >= 7 days of daily data so brand-new products don't get the badge.
 * Returns a map productId -> badges.
 */
export async function lowestPriceBadges(
  q: Queryable,
  products: { id: string; current_price: string }[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (products.length === 0) return out;

  const r = await q.query(
    `SELECT product_id::text AS product_id, min(min_price) AS low, count(*) AS n
       FROM price_daily
      WHERE product_id = ANY($1::bigint[]) AND day >= now() - interval '90 days'
      GROUP BY product_id`,
    [products.map((p) => p.id)],
  );
  const stats = new Map<string, { low: string; n: string }>(r.rows.map((x) => [x.product_id, x]));
  for (const p of products) {
    const s = stats.get(p.id);
    out.set(p.id, s && Number(s.n) >= 7 && Number(p.current_price) <= Number(s.low) ? ['Lowest in 90 days'] : []);
  }
  return out;
}