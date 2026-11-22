import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../common/errors';
import { money } from '../common/money';
import { PRODUCT_COLS_JOINED, productRowFromJoin, toProduct } from '../catalogue/product.mapper';
import { DbService, Queryable } from '../db/db.service';
import type { AddCartItemDto } from './cart.schemas';

const BIGID_RE = /^[1-9][0-9]{0,17}$/;

@Injectable()
export class CartService {
  constructor(private readonly db: DbService) {}

  /** Every user has at most one active cart (partial unique index). Created lazily. */
  async ensureCart(q: Queryable, userId: string): Promise<string> {
    await q.query(`INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) WHERE status = 'active' DO NOTHING`, [userId]);
    const r = await q.query(`SELECT id FROM carts WHERE user_id = $1 AND status = 'active'`, [userId]);
    return r.rows[0].id as string;
  }

  /** The contract's Cart. Subtotal uses today's product price (priceAtAdd is kept for "price changed since you added it"). */
  async getCart(q: Queryable, userId: string) {
    const cartId = await this.ensureCart(q, userId);
    const r = await q.query(
      `SELECT ci.qty, ci.price_at_add, ci.source, ci.source_notification_id, ${PRODUCT_COLS_JOINED}
         FROM cart_items ci JOIN products p ON p.id = ci.product_id
        WHERE ci.cart_id = $1
        ORDER BY ci.added_at, ci.product_id`,
      [cartId],
    );
    let subtotalCents = 0;
    const items = r.rows.map((row) => {
      const product = toProduct(productRowFromJoin(row));
      subtotalCents += Math.round(product.currentPrice * 100) * row.qty;
      return {
        product,
        quantity: row.qty as number,
        priceAtAdd: money(row.price_at_add) as number,
        source: row.source as string,
        sourceNotificationId: (row.source_notification_id as string | null) ?? null,
      };
    });
    return { id: cartId, status: 'active', items, currency: 'AED', subtotal: subtotalCents / 100 };
  }

  getMyCart(userId: string) {
    return this.getCart(this.db, userId);
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    return this.db.tx(async (c) => {
      const p = await c.query('SELECT id, total_stock, is_active FROM products WHERE id = $1', [dto.productId]);
      const product = p.rows[0];
      if (!product || !product.is_active) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
      if (product.total_stock <= 0) throw new AppError(409, 'OUT_OF_STOCK', 'This product is out of stock');

      const cartId = await this.ensureCart(c, userId);
      const existing = await c.query('SELECT qty FROM cart_items WHERE cart_id = $1 AND product_id = $2 FOR UPDATE', [cartId, dto.productId]);
      const newQty = (existing.rows[0]?.qty ?? 0) + dto.quantity;
      if (newQty > product.total_stock) {
        throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${product.total_stock} available`, { available: product.total_stock });
      }

      await c.query(
        `INSERT INTO cart_items (cart_id, product_id, qty, price_at_add, source)
         SELECT $1, id, $3, current_price, 'direct' FROM products WHERE id = $2
         ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = EXCLUDED.qty`,
        [cartId, dto.productId, newQty],
      );
      await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
      return this.getCart(c, userId);
    });
  }

  async removeItem(userId: string, productId: string) {
    if (!BIGID_RE.test(productId)) throw notFound('CART_ITEM_NOT_FOUND', 'Item not in cart');
    return this.db.tx(async (c) => {
      const cartId = await this.ensureCart(c, userId);
      const del = await c.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
      if (del.rowCount === 0) throw notFound('CART_ITEM_NOT_FOUND', 'Item not in cart');
      await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
      return this.getCart(c, userId);
    });
  }
}