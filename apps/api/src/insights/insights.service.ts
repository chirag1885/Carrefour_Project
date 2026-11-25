import { Injectable } from '@nestjs/common';
import { PRODUCT_COLS, ProductRow, toProduct } from '../catalogue/product.mapper';
import { notFound } from '../common/errors';
import { DbService } from '../db/db.service';

const ID_RE = /^[1-9][0-9]{0,17}$/;
const aed = (n: number) => `AED ${n.toFixed(2)}`;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Least-squares slope (price change per day) of a series. */
function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = avg(ys);
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

export interface PredictionResult {
  verdict: 'BUY_NOW' | 'WAIT' | 'INSUFFICIENT_DATA';
  reasons: string[];
  predictedSaleAt: string | null;
}

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

  /** Explainable rules over the last 90 daily closing prices. Not a black box, not financial advice. */
  async prediction(id: string): Promise<PredictionResult> {
    const p = await this.requireProduct(id);
    const cur = Number(p.current_price);

    const h = await this.db.query<{ close: string }>(
      `SELECT (array_agg(price ORDER BY recorded_at DESC))[1] AS close
         FROM price_history
        WHERE product_id = $1 AND recorded_at >= now() - interval '90 days'
        GROUP BY date_trunc('day', recorded_at)
        ORDER BY date_trunc('day', recorded_at)`,
      [p.id],
    );
    const closes = h.rows.map((r) => Number(r.close));
    if (closes.length < 7) {
      return { verdict: 'INSUFFICIENT_DATA', reasons: ['There is not enough price history yet to give advice.'], predictedSaleAt: null };
    }

    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const percentile = (closes.filter((c) => c < cur).length / closes.length) * 100; // 0 = cheapest it has been
    const last30 = closes.slice(-30);
    const sma7 = avg(closes.slice(-7));
    const sma30 = avg(last30);
    const trend = slope(last30);
    const range = `Over the last ${closes.length} days it ranged from ${aed(min)} to ${aed(max)}.`;

    const sale = await this.db.query<{ name: string; starts_on: string; days: number }>(
      `SELECT name, starts_on::text AS starts_on, GREATEST(starts_on - current_date, 0)::int AS days
         FROM sale_events
        WHERE ends_on >= current_date AND starts_on <= current_date + 21
        ORDER BY starts_on LIMIT 1`,
    );
    const ev = sale.rows[0];

    if (percentile <= 15) {
      return { verdict: 'BUY_NOW', reasons: [`${aed(cur)} is close to the lowest price for this product.`, range], predictedSaleAt: null };
    }
    if (ev && (trend < 0 || percentile >= 50)) {
      const when = ev.days === 0 ? 'is on now' : `starts in ${ev.days} day${ev.days === 1 ? '' : 's'}`;
      return {
        verdict: 'WAIT',
        reasons: [`${ev.name} ${when}, when prices usually drop.`, range],
        predictedSaleAt: new Date(`${ev.starts_on}T00:00:00Z`).toISOString(),
      };
    }
    if (percentile >= 75) {
      return { verdict: 'WAIT', reasons: [`${aed(cur)} is near the top of its recent price range.`, range], predictedSaleAt: null };
    }
    if (trend < 0 && sma7 < sma30 * 0.98) {
      return {
        verdict: 'WAIT',
        reasons: ['The price has been trending down recently.', `7-day average ${aed(sma7)} vs 30-day average ${aed(sma30)}.`],
        predictedSaleAt: null,
      };
    }
    return { verdict: 'BUY_NOW', reasons: ['The price is stable and in the middle of its usual range.', range], predictedSaleAt: null };
  }
}