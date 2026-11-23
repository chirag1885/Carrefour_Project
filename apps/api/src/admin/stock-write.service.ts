import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { badRequest, notFound } from '../common/errors';
import { MetricsService } from '../common/metrics';
import { DbService } from '../db/db.service';
import { PRODUCT_COLS, ProductRow, toProduct } from '../catalogue/product.mapper';
import { eventProductId, newEventId, OCCURRED_AT_SQL, StockChangedPayload } from './admin-events';
import { SetStockDto } from './admin-products.schemas';

interface StockChange { storeId: number; oldQty: number; newQty: number }

const WRITE_STOCK_SQL = `
WITH t AS (SELECT clock_timestamp() AS ts),
inv AS (
  INSERT INTO inventory (product_id, store_id, qty, updated_at)
  SELECT $1::bigint, $2::int, $3::int, t.ts FROM t WHERE true
  ON CONFLICT (product_id, store_id) DO UPDATE SET qty = EXCLUDED.qty, updated_at = EXCLUDED.updated_at
),
ob AS (
  INSERT INTO outbox_events (id, topic, key, payload, created_at)
  SELECT $4::uuid, 'stock.changed', $1::text, $5::jsonb || ${OCCURRED_AT_SQL}, t.ts FROM t
)
UPDATE products AS p
   SET total_stock = p.total_stock + $6::int, updated_at = t.ts
  FROM t
 WHERE p.id = $1::bigint
RETURNING ${PRODUCT_COLS.split(', ').map((c) => `p.${c}`).join(', ')}`;

export function distributeStock(rows: { storeId: number; qty: number }[], total: number): Map<number, number> {
  const out = new Map<number, number>();
  if (rows.length === 0) return out;
  const sum = rows.reduce((s, r) => s + r.qty, 0);
  if (sum === 0) {
    const base = Math.floor(total / rows.length);
    const leftover = total - base * rows.length;
    [...rows].sort((a, b) => a.storeId - b.storeId)
      .forEach((r, i) => out.set(r.storeId, base + (i < leftover ? 1 : 0)));
    return out;
  }
  let assigned = 0;
  for (const r of rows) {
    const share = Math.floor((total * r.qty) / sum);
    out.set(r.storeId, share);
    assigned += share;
  }
  const leftover = total - assigned;
  [...rows].sort((a, b) => b.qty - a.qty || a.storeId - b.storeId)
    .slice(0, leftover)
    .forEach((r) => out.set(r.storeId, (out.get(r.storeId) ?? 0) + 1));
  return out;
}

@Injectable()
export class StockWriteService {
  private readonly log = new Logger('StockWrite');

  constructor(
    private readonly db: DbService,
    private readonly metrics: MetricsService,
  ) {}

  async setStock(productId: string, dto: SetStockDto, adminId: string) {
    let writeResult = 'error';
    try {
      const done = await this.db.tx(async (c) => {
        const locked = await c.query<ProductRow>(
          `SELECT ${PRODUCT_COLS} FROM products WHERE id = $1 AND is_active FOR UPDATE`,
          [productId],
        );
        let product = locked.rows[0];
        if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

        const changes =
          dto.storeId === null || dto.storeId === undefined
            ? await this.planGlobal(c, product.id, dto.quantity)
            : await this.planStore(c, product.id, dto.storeId, dto.quantity);

        for (const ch of changes) product = await this.apply(c, product, ch);
        return { product, changes };
      });

      writeResult = done.changes.length > 0 ? 'changed' : 'noop';

      for (const ch of done.changes) {
        this.log.log(`stock product=${productId} store=${ch.storeId} ${ch.oldQty}->${ch.newQty} admin=${adminId}`);
      }
      return toProduct(done.product);
    } finally {
      this.metrics.stockWriteTotal.inc({ result: writeResult });
    }
  }

  private async planStore(c: PoolClient, productId: string, storeId: number, quantity: number): Promise<StockChange[]> {
    const store = await c.query('SELECT 1 FROM stores WHERE id = $1', [storeId]);
    if (store.rowCount === 0) throw notFound('STORE_NOT_FOUND', 'Store not found');
    const inv = await c.query<{ qty: number }>(
      'SELECT qty FROM inventory WHERE product_id = $1 AND store_id = $2 FOR UPDATE',
      [productId, storeId],
    );
    const oldQty = inv.rows[0]?.qty ?? 0;
    return oldQty === quantity ? [] : [{ storeId, oldQty, newQty: quantity }];
  }

  private async planGlobal(c: PoolClient, productId: string, total: number): Promise<StockChange[]> {
    const inv = await c.query<{ store_id: number; qty: number }>(
      'SELECT store_id, qty FROM inventory WHERE product_id = $1 ORDER BY store_id FOR UPDATE',
      [productId],
    );
    if (inv.rows.length === 0) {
      throw badRequest('NO_STORE_INVENTORY', 'This product has no store inventory rows; pass a storeId');
    }
    const rows = inv.rows.map((r) => ({ storeId: r.store_id, qty: r.qty }));
    const target = distributeStock(rows, total);
    return rows
      .filter((r) => target.get(r.storeId) !== r.qty)
      .map((r) => ({ storeId: r.storeId, oldQty: r.qty, newQty: target.get(r.storeId) as number }));
  }

  private async apply(c: PoolClient, product: ProductRow, ch: StockChange): Promise<ProductRow> {
    const eventId = newEventId();
    const event: StockChangedPayload = {
      event_id: eventId, event_type: 'stock.changed', schema_version: 1,
      product_id: eventProductId(product.id),
      store_id: ch.storeId, old_qty: ch.oldQty, new_qty: ch.newQty,
    };
    const r = await c.query<ProductRow>(WRITE_STOCK_SQL, [
      product.id, ch.storeId, ch.newQty, eventId, JSON.stringify(event), ch.newQty - ch.oldQty,
    ]);
    return r.rows[0];
  }
}
