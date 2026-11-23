import { Injectable } from '@nestjs/common';
import { notFound } from '../common/errors';
import { money } from '../common/money';
import { DbService } from '../db/db.service';
import type { PriceHistoryDto, PriceHistoryResponse, PricePoint } from './price-history.schemas';

const ID_RE = /^[1-9][0-9]{0,17}$/;

/**
 * 7d  -> raw price_history bucketed by hour (TimescaleDB time_bucket).
 *        Returns `price` only; minPrice/maxPrice are absent for this range.
 * 30d / 90d / 1y -> price_daily continuous aggregate, one row per day.
 *        Returns price (close), minPrice and maxPrice.
 *
 * Because real-time aggregation is on (migration 20261122_003), the current partial day
 * is always included in the aggregate query without waiting for the 15-min refresh.
 *
 * We never return more than 500 points from one call. With 1 point/hour over 7d that is
 * 168 points max, and 1 point/day over 1y is 365 points max, so the cap is not reachable
 * in practice but guards against schema changes.
 */
@Injectable()
export class PriceHistoryService {
  constructor(private readonly db: DbService) {}

  async get(productId: string, dto: PriceHistoryDto): Promise<PriceHistoryResponse> {
    // Guard: a malformed id can never match a row; return 404 immediately.
    if (!ID_RE.test(productId)) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

    // Check the product exists and is active. We do this separately so we can return 404
    // for missing products vs. 200 with an empty array for products with no history yet.
    const exists = await this.db.query<{ id: string }>(
      'SELECT id FROM products WHERE id = $1 AND is_active',
      [productId],
    );
    if (!exists.rows[0]) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

    const points = dto.range === '7d'
      ? await this.raw7d(productId)
      : await this.daily(productId, dto.range);

    return { currency: 'AED', points };
  }

  /**
   * Raw price_history bucketed hourly over 7 days.
   * Uses time_bucket (TimescaleDB). The last() aggregate gives the closing price in each bucket.
   * We order ASC so the chart draws left-to-right without client sorting.
   */
  private async raw7d(productId: string): Promise<PricePoint[]> {
    const r = await this.db.query<{ at: Date; price: string }>(
      `SELECT
         time_bucket('1 hour', recorded_at) AS at,
         last(price, recorded_at)           AS price
       FROM price_history
       WHERE product_id = $1
         AND recorded_at >= now() - INTERVAL '7 days'
       GROUP BY 1
       ORDER BY 1
       LIMIT 500`,
      [productId],
    );
    return r.rows.map((row) => ({
      at: row.at.toISOString(),
      price: money(row.price) as number,
    }));
  }

  /** price_daily continuous aggregate. One row per day, plus today's partial bucket (real-time agg). */
  private async daily(productId: string, range: '30d' | '90d' | '1y'): Promise<PricePoint[]> {
    const interval = range === '1y' ? '1 year' : range === '90d' ? '90 days' : '30 days';
    const r = await this.db.query<{ at: Date; price: string; min_price: string; max_price: string }>(
      `SELECT
         day        AS at,
         close_price AS price,
         min_price,
         max_price
       FROM price_daily
       WHERE product_id = $1
         AND day >= now() - INTERVAL '${interval}'
       ORDER BY day
       LIMIT 500`,
      [productId],
    );
    return r.rows.map((row) => ({
      at: row.at.toISOString(),
      price: money(row.price) as number,
      minPrice: money(row.min_price) as number,
      maxPrice: money(row.max_price) as number,
    }));
  }
}
