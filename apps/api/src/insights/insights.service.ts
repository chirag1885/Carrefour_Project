import { Injectable } from '@nestjs/common';
import { PRODUCT_COLS, ProductRow, toProduct } from '../catalogue/product.mapper';
import { notFound } from '../common/errors';
import { DbService } from '../db/db.service';

const ID_RE = /^[1-9][0-9]{0,17}$/;
export const RANGE_DAYS = { '7d': 7, '15d': 15, '30d': 30, '90d': 90 } as const;
export type PriceRange = keyof typeof RANGE_DAYS;

@Injectable()
export class InsightsService {
  constructor(private readonly db: DbService) {}

  private async requireProduct(id: string): Promise<ProductRow> {
    if (!ID_RE.test(id)) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
    const r = await this.db.query<ProductRow>(`SELECT ${PRODUCT_COLS} FROM products WHERE id = $1 AND is_active`, [id]);
    if (!r.rows[0]) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
    return r.rows[0];
  }

  /** In-stock products in the same category and a similar price band, ranked by name similarity (pg_trgm). */
  async similar(id: string) {
    const p = await this.requireProduct(id);
    const price = Number(p.current_price);
    const r = await this.db.query<ProductRow>(
      `SELECT ${PRODUCT_COLS}
         FROM products
        WHERE is_active AND id <> $1 AND total_stock > 0 AND category = $2
          AND current_price BETWEEN $3 AND $4
        ORDER BY (subcategory IS NOT DISTINCT FROM $5::text) DESC,
                 similarity(name_en, $6::text) DESC,
                 abs(current_price - $7::numeric) ASC
        LIMIT 8`,
      [p.id, p.category, price * 0.7, price * 1.3, p.subcategory, p.name_en, price],
    );
    return r.rows.map(toProduct);
  }

  /** One price per day for the last N days (max 90 = the retention window). Days without a change carry the last price forward. */
  async priceHistory(id: string, range: PriceRange) {
    const p = await this.requireProduct(id);
    const days = RANGE_DAYS[range];
    const r = await this.db.query<{ day: Date; close: string | null }>(
      `SELECT d AS day,
              (SELECT h.price FROM price_history h
                WHERE h.product_id = $1 AND h.recorded_at < d + interval '1 day'
                ORDER BY h.recorded_at DESC LIMIT 1) AS close
         FROM generate_series(date_trunc('day', now()) - make_interval(days => $2::int - 1),
                              date_trunc('day', now()), interval '1 day') AS d
        ORDER BY d`,
      [p.id, days],
    );
    const points = r.rows.filter((x) => x.close !== null).map((x) => ({ at: x.day.toISOString(), price: Number(x.close) }));
    // the chart must end on the price the shopper sees on the page
    const cur = Number(p.current_price);
    if (points.length > 0 && points[points.length - 1].price !== cur) points[points.length - 1].price = cur;
    return { currency: 'AED', points };
  }
}