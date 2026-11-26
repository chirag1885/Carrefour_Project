import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../common/errors';
import { money } from '../common/money';
import { PRODUCT_COLS_JOINED, productRowFromJoin, toProduct } from '../catalogue/product.mapper';
import { DbService, Queryable } from '../db/db.service';
import type { AddCartItemDto, UpdateCartItemDto } from './cart.schemas';

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
    /** Sets the quantity of a line already in the cart. Lowering is always allowed; raising is checked against stock. */
  async setQuantity(userId: string, productId: string, dto: UpdateCartItemDto) {
    if (!BIGID_RE.test(productId)) throw notFound('CART_ITEM_NOT_FOUND', 'Item not in cart');
    return this.db.tx(async (c) => {
      const cartId = await this.ensureCart(c, userId);
      const line = await c.query('SELECT qty FROM cart_items WHERE cart_id = $1 AND product_id = $2 FOR UPDATE', [cartId, productId]);
      if (!line.rows[0]) throw notFound('CART_ITEM_NOT_FOUND', 'Item not in cart');

      if (dto.quantity > line.rows[0].qty) {
        const p = await c.query('SELECT total_stock, is_active FROM products WHERE id = $1', [productId]);
        const product = p.rows[0];
        if (!product || !product.is_active || product.total_stock <= 0) throw new AppError(409, 'OUT_OF_STOCK', 'This product is out of stock');
        if (dto.quantity > product.total_stock) {
          throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${product.total_stock} available`, { available: product.total_stock });
        }
      }
      await c.query('UPDATE cart_items SET qty = $3 WHERE cart_id = $1 AND product_id = $2', [cartId, productId, dto.quantity]);
      await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
      return this.getCart(c, userId);
    });
  }
    /** Demo checkout: converts the active cart and records PURCHASE_MOCK events (with alert attribution). No payment, stock untouched. */
  async checkout(userId: string) {
    return this.db.tx(async (c) => {
      const cart = await c.query(`SELECT id FROM carts WHERE user_id = $1 AND status = 'active' FOR UPDATE`, [userId]);
      if (!cart.rows[0]) throw new AppError(409, 'EMPTY_CART', 'Your cart is empty');
      const cartId = cart.rows[0].id as string;

      const lines = await c.query(
        `SELECT ci.product_id, ci.qty, ci.source_notification_id, p.current_price, p.total_stock, p.is_active, p.name_en
           FROM cart_items ci JOIN products p ON p.id = ci.product_id
          WHERE ci.cart_id = $1
          FOR UPDATE OF ci`,
        [cartId],
      );
      if (lines.rows.length === 0) throw new AppError(409, 'EMPTY_CART', 'Your cart is empty');

      const unavailable = lines.rows.filter((l) => !l.is_active || l.total_stock < l.qty);
      if (unavailable.length > 0) {
        throw new AppError(409, 'ITEMS_UNAVAILABLE', 'Some items are no longer available in the quantity you chose', {
          items: unavailable.map((l) => l.name_en),
        });
      }

      let totalCents = 0;
      for (const l of lines.rows) {
        const lineCents = Math.round(Number(l.current_price) * 100) * l.qty;
        totalCents += lineCents;
        await c.query(
          `INSERT INTO analytics_events (event_type, user_id, product_id, notification_id, amount)
           VALUES ('PURCHASE_MOCK', $1, $2, $3, $4)`,
          [userId, l.product_id, l.source_notification_id, lineCents / 100],
        );
      }
      await c.query(`UPDATE carts SET status = 'converted', updated_at = now() WHERE id = $1`, [cartId]);

      return {
        orderId: cartId,
        total: totalCents / 100,
        currency: 'AED',
        items: lines.rows.map((l) => ({
          productId: String(l.product_id),
          name: l.name_en as string,
          quantity: l.qty as number,
          unitPrice: Number(l.current_price),
        })),
      };
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