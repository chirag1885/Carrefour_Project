import { Injectable, Logger } from '@nestjs/common';
import { notFound } from '../common/errors';
import { filsFromNumber, filsFromNumeric, filsToNumber, filsToNumeric } from '../common/money';
import { DbService } from '../db/db.service';
import { PRODUCT_COLS, ProductRow, toProduct } from '../catalogue/product.mapper';
import { eventProductId, newEventId, OCCURRED_AT_SQL, PriceChangedPayload } from './admin-events';
import { SetPriceDto } from './admin-products.schemas';

/**
 * ONE statement writes the price history row, the outbox row and the product update, all stamped with the
 * same clock_timestamp().
 *
 * Why clock_timestamp() and not now(): now() is the time the transaction STARTED. Two admins changing the
 * same product can commit in the opposite order to their start times, and the relay publishes in
 * created_at order, so now() could publish 2500 -> 2400 before 3000 -> 2500. The product row lock
 * (SELECT ... FOR UPDATE below) serialises writers, and a timestamp taken after the lock is therefore
 * increasing per product.
 */
const WRITE_PRICE_SQL = `
WITH t AS (SELECT clock_timestamp() AS ts),
hist AS (
  INSERT INTO price_history (product_id, price, currency, source, event_id, recorded_at)
  SELECT $1::bigint, $2::numeric, $3::char(3), $4::text, $5::uuid, t.ts FROM t
),
ob AS (
  INSERT INTO outbox_events (id, topic, key, payload, created_at)
  SELECT $5::uuid, 'price.changed', $1::text, $6::jsonb || ${OCCURRED_AT_SQL}, t.ts FROM t
)
UPDATE products AS p
   SET current_price = $2::numeric, updated_at = t.ts
  FROM t
 WHERE p.id = $1::bigint
RETURNING ${PRODUCT_COLS.split(', ').map((c) => `p.${c}`).join(', ')}`;

@Injectable()
export class PriceWriteService {
  private readonly log = new Logger('PriceWrite');

  constructor(private readonly db: DbService) {}

  /**
   * Sets a product price. Same price -> no write, no event, current Product returned (PUT is naturally
   * idempotent, so a retry never creates a second event). Returns the contract's Product.
   */
  async setPrice(productId: string, dto: SetPriceDto, adminId: string) {
    const newFils = filsFromNumber(dto.price);

    const done = await this.db.tx(async (c) => {
      const locked = await c.query<ProductRow>(
        `SELECT ${PRODUCT_COLS} FROM products WHERE id = $1 AND is_active FOR UPDATE`,
        [productId],
      );
      const row = locked.rows[0];
      if (!row) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

      const oldFils = filsFromNumeric(row.current_price);
      if (oldFils === newFils) return { row, change: null };

      const currency = row.currency.trim();
      const eventId = newEventId();
      const event: PriceChangedPayload = {
        event_id: eventId,
        event_type: 'price.changed',
        schema_version: 1,
        product_id: eventProductId(row.id),
        sku: row.sku,
        old_price: filsToNumber(oldFils),
        new_price: filsToNumber(newFils),
        currency,
        source: dto.source,
      };

      const updated = await c.query<ProductRow>(WRITE_PRICE_SQL, [
        row.id,
        filsToNumeric(newFils),
        currency,
        dto.source,
        eventId,
        JSON.stringify(event),
      ]);
      return { row: updated.rows[0], change: { eventId, oldFils } };
    });

    if (done.change) {
      this.log.log(
        `price product=${productId} ${filsToNumeric(done.change.oldFils)}->${filsToNumeric(newFils)} ` +
          `source=${dto.source} admin=${adminId} event=${done.change.eventId}`,
      );
    }
    return toProduct(done.row);
  }
}
