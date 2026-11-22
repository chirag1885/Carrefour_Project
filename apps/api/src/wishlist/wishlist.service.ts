import { Injectable } from '@nestjs/common';
import { lowestPriceBadges } from '../catalogue/badges';
import { PRODUCT_COLS_JOINED, ProductRow, productRowFromJoin, toProduct } from '../catalogue/product.mapper';
import { CartService } from '../cart/cart.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { AppError, notFound } from '../common/errors';
import { money } from '../common/money';
import { DbService, Queryable } from '../db/db.service';
import { AddItemDto, ItemCursor, ListItemsDto, MoveOptionsDto, UpdateItemDto } from './wishlist.schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIGID_RE = /^[1-9][0-9]{0,17}$/;
const MAX_WISHLISTS = 20;

const ITEM_COLS = `wi.id, wi.wishlist_id, wi.target_price, wi.notify_on_drop, wi.notify_on_restock, wi.notify_on_low_stock,
                   wi.low_stock_threshold, wi.store_id, wi.added_price, wi.added_at`;

// camelCase request field -> column
const UPDATABLE = {
  targetPrice: 'target_price',
  notifyOnDrop: 'notify_on_drop',
  notifyOnRestock: 'notify_on_restock',
  notifyOnLowStock: 'notify_on_low_stock',
  lowStockThreshold: 'low_stock_threshold',
  storeId: 'store_id',
} as const;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toWishlist = (w: Row) => ({
  id: w.id as string,
  name: w.name as string,
  isDefault: w.is_default as boolean,
  visibility: w.visibility as string,
  createdAt: (w.created_at as Date).toISOString(),
});

@Injectable()
export class WishlistService {
  constructor(
    private readonly db: DbService,
    private readonly cart: CartService,
  ) {}

  // ---------- ownership ----------
  /** Every wishlist query goes through this: a wishlist that is not yours is simply "not found". */
  private async requireOwned(q: Queryable, wishlistId: string, userId: string): Promise<{ id: string; is_default: boolean }> {
    if (!UUID_RE.test(wishlistId)) throw notFound('WISHLIST_NOT_FOUND', 'Wishlist not found');
    const r = await q.query('SELECT id, is_default FROM wishlists WHERE id = $1 AND user_id = $2', [wishlistId, userId]);
    if (!r.rows[0]) throw notFound('WISHLIST_NOT_FOUND', 'Wishlist not found');
    return r.rows[0];
  }

  private assertItemId(itemId: string): void {
    if (!BIGID_RE.test(itemId)) throw notFound('ITEM_NOT_FOUND', 'Wishlist item not found');
  }

  // ---------- wishlists ----------
  async list(userId: string) {
    const r = await this.db.query(
      'SELECT id, name, is_default, visibility, created_at FROM wishlists WHERE user_id = $1 ORDER BY is_default DESC, created_at, id',
      [userId],
    );
    return r.rows.map(toWishlist);
  }

  async create(userId: string, name: string) {
    const n = await this.db.query('SELECT count(*)::int AS n FROM wishlists WHERE user_id = $1', [userId]);
    if (n.rows[0].n >= MAX_WISHLISTS) throw new AppError(409, 'WISHLIST_LIMIT', `You can have at most ${MAX_WISHLISTS} wishlists`);
    try {
      const r = await this.db.query(
        'INSERT INTO wishlists (user_id, name) VALUES ($1, $2) RETURNING id, name, is_default, visibility, created_at',
        [userId, name],
      );
      return toWishlist(r.rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'WISHLIST_NAME_TAKEN', 'You already have a wishlist with this name');
      throw e;
    }
  }

  async rename(userId: string, wishlistId: string, name: string) {
    await this.requireOwned(this.db, wishlistId, userId);
    try {
      const r = await this.db.query(
        'UPDATE wishlists SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING id, name, is_default, visibility, created_at',
        [wishlistId, userId, name],
      );
      return toWishlist(r.rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'WISHLIST_NAME_TAKEN', 'You already have a wishlist with this name');
      throw e;
    }
  }

  async remove(userId: string, wishlistId: string): Promise<void> {
    const w = await this.requireOwned(this.db, wishlistId, userId);
    if (w.is_default) throw new AppError(409, 'CANNOT_DELETE_DEFAULT', 'The default wishlist cannot be deleted');
    await this.db.query('DELETE FROM wishlists WHERE id = $1 AND user_id = $2', [wishlistId, userId]); // items cascade
  }

  // ---------- items ----------
  /** Maps joined rows (wishlist_items + p_* product columns) to the contract's WishlistItem, with badges. */
  private async toItems(q: Queryable, rows: Row[]) {
    const products = rows.map((r) => productRowFromJoin(r));
    const badges = await lowestPriceBadges(q, products);
    return rows.map((r, i) => {
      const p: ProductRow = products[i];
      return {
        id: r.id as string,
        wishlistId: r.wishlist_id as string,
        product: toProduct(p),
        addedPrice: money(r.added_price) as number,
        addedAt: (r.added_at as Date).toISOString(),
        badges: badges.get(p.id) ?? [],
        targetPrice: money(r.target_price),
        notifyOnDrop: r.notify_on_drop as boolean,
        notifyOnRestock: r.notify_on_restock as boolean,
        notifyOnLowStock: r.notify_on_low_stock as boolean,
        lowStockThreshold: r.low_stock_threshold as number,
        storeId: (r.store_id as number | null) ?? null,
      };
    });
  }

  private async fetchItem(q: Queryable, userId: string, wishlistId: string, itemId: string) {
    const r = await q.query(
      `SELECT ${ITEM_COLS}, ${PRODUCT_COLS_JOINED}
         FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
        WHERE wi.id = $1 AND wi.wishlist_id = $2 AND wi.user_id = $3`,
      [itemId, wishlistId, userId],
    );
    if (!r.rows[0]) throw notFound('ITEM_NOT_FOUND', 'Wishlist item not found');
    return (await this.toItems(q, r.rows))[0];
  }

  async listItems(userId: string, wishlistId: string, dto: ListItemsDto) {
    await this.requireOwned(this.db, wishlistId, userId);
    const cursor = decodeCursor(dto.cursor, ItemCursor);
    // newest first; ordering by the BIGSERIAL id keeps the keyset cursor exact (no timestamp precision issues)
    const r = await this.db.query(
      `SELECT ${ITEM_COLS}, ${PRODUCT_COLS_JOINED}
         FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
        WHERE wi.wishlist_id = $1 AND wi.user_id = $2 AND ($3::bigint IS NULL OR wi.id < $3)
        ORDER BY wi.id DESC
        LIMIT $4`,
      [wishlistId, userId, cursor?.id ?? null, dto.limit + 1],
    );
    const hasMore = r.rows.length > dto.limit;
    const page = hasMore ? r.rows.slice(0, dto.limit) : r.rows;
    return {
      items: await this.toItems(this.db, page),
      nextCursor: hasMore ? encodeCursor({ id: String(page[page.length - 1].id) }) : null,
    };
  }

  async addItem(userId: string, wishlistId: string, dto: AddItemDto) {
    await this.requireOwned(this.db, wishlistId, userId);
    const p = await this.db.query('SELECT id, current_price, is_active FROM products WHERE id = $1', [dto.productId]);
    if (!p.rows[0] || !p.rows[0].is_active) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');

    try {
      const ins = await this.db.query(
        `INSERT INTO wishlist_items
           (wishlist_id, user_id, product_id, target_price, notify_on_drop, notify_on_restock, notify_on_low_stock,
            low_stock_threshold, store_id, added_price)
         VALUES ($1, $2, $3, $4, COALESCE($5, true), COALESCE($6, true), COALESCE($7, false), COALESCE($8, 5), $9, $10)
         RETURNING id`,
        [
          wishlistId, userId, dto.productId, dto.targetPrice ?? null, dto.notifyOnDrop ?? null, dto.notifyOnRestock ?? null,
          dto.notifyOnLowStock ?? null, dto.lowStockThreshold ?? null, dto.storeId ?? null, p.rows[0].current_price,
        ],
      );
      return await this.fetchItem(this.db, userId, wishlistId, String(ins.rows[0].id));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23505') throw new AppError(409, 'ALREADY_IN_WISHLIST', 'This product is already in the wishlist');
      if (code === '23503') throw notFound('STORE_NOT_FOUND', 'Store not found');
      throw e;
    }
  }

  async updateItem(userId: string, wishlistId: string, itemId: string, dto: UpdateItemDto) {
    await this.requireOwned(this.db, wishlistId, userId);
    this.assertItemId(itemId);

    const params: unknown[] = [itemId, wishlistId, userId];
    const sets: string[] = [];
    for (const [field, column] of Object.entries(UPDATABLE)) {
      const v = dto[field as keyof UpdateItemDto];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${column} = $${params.length}`);
      }
    }
    try {
      const r = await this.db.query(
        `UPDATE wishlist_items SET ${sets.join(', ')} WHERE id = $1 AND wishlist_id = $2 AND user_id = $3 RETURNING id`,
        params,
      );
      if (r.rowCount === 0) throw notFound('ITEM_NOT_FOUND', 'Wishlist item not found');
    } catch (e) {
      if ((e as { code?: string }).code === '23503') throw notFound('STORE_NOT_FOUND', 'Store not found');
      throw e;
    }
    return this.fetchItem(this.db, userId, wishlistId, itemId);
  }

  async removeItem(userId: string, wishlistId: string, itemId: string): Promise<void> {
    await this.requireOwned(this.db, wishlistId, userId);
    this.assertItemId(itemId);
    const r = await this.db.query('DELETE FROM wishlist_items WHERE id = $1 AND wishlist_id = $2 AND user_id = $3', [itemId, wishlistId, userId]);
    if (r.rowCount === 0) throw notFound('ITEM_NOT_FOUND', 'Wishlist item not found');
  }

  // ---------- move to cart ----------
  async moveItemToCart(userId: string, wishlistId: string, itemId: string, opts: MoveOptionsDto) {
    this.assertItemId(itemId);
    return this.db.tx(async (c) => {
      await this.requireOwned(c, wishlistId, userId);
      // lock the item row so a double-click can't move it twice
      const r = await c.query(
        `SELECT wi.id, wi.product_id, p.current_price, p.total_stock, p.is_active
           FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
          WHERE wi.id = $1 AND wi.wishlist_id = $2 AND wi.user_id = $3
          FOR UPDATE OF wi`,
        [itemId, wishlistId, userId],
      );
      const it = r.rows[0];
      if (!it) throw notFound('ITEM_NOT_FOUND', 'Wishlist item not found');
      if (!it.is_active || it.total_stock <= 0) throw new AppError(409, 'OUT_OF_STOCK', 'This product is out of stock');

      let notificationId: string | null = null;
      if (opts.notificationId) {
        const n = await c.query('SELECT id FROM notifications WHERE id = $1 AND user_id = $2', [opts.notificationId, userId]);
        if (!n.rows[0]) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
        notificationId = n.rows[0].id;
      }

      const cartId = await this.cart.ensureCart(c, userId);
      await c.query(
        `INSERT INTO cart_items (cart_id, product_id, qty, price_at_add, source, source_notification_id)
         VALUES ($1, $2, 1, $3, $4, $5)
         ON CONFLICT (cart_id, product_id) DO NOTHING`, // already in the cart: keep its quantity
        [cartId, it.product_id, it.current_price, notificationId ? 'notification' : 'wishlist', notificationId],
      );
      if (opts.removeFromWishlist) await c.query('DELETE FROM wishlist_items WHERE id = $1', [itemId]);

      return { cart: await this.cart.getCart(c, userId), movedItemIds: [itemId], skippedItemIds: [] as string[] };
    });
  }

  async moveAllToCart(userId: string, wishlistId: string) {
    return this.db.tx(async (c) => {
      await this.requireOwned(c, wishlistId, userId);
      const cartId = await this.cart.ensureCart(c, userId);

      const moved = await c.query(
        `WITH eligible AS (
           SELECT wi.id, wi.product_id, p.current_price
             FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
            WHERE wi.wishlist_id = $1 AND wi.user_id = $2 AND p.is_active AND p.total_stock > 0
              FOR UPDATE OF wi
         ), added AS (
           INSERT INTO cart_items (cart_id, product_id, qty, price_at_add, source)
           SELECT $3, product_id, 1, current_price, 'wishlist' FROM eligible
           ON CONFLICT (cart_id, product_id) DO NOTHING
         )
         DELETE FROM wishlist_items WHERE id IN (SELECT id FROM eligible) RETURNING id`,
        [wishlistId, userId, cartId],
      );
      const skipped = await c.query('SELECT id FROM wishlist_items WHERE wishlist_id = $1 AND user_id = $2 ORDER BY id', [wishlistId, userId]);
      return {
        cart: await this.cart.getCart(c, userId),
        movedItemIds: moved.rows.map((x) => String(x.id)),
        skippedItemIds: skipped.rows.map((x) => String(x.id)), // what is left = out of stock / inactive
      };
    });
  }

  // ---------- trends ----------
  /**
   * Phase 2: current vs added totals. `points` has just today's value; Phase 3 fills in history from price_daily.
   */
  async trends(userId: string, wishlistId: string) {
    await this.requireOwned(this.db, wishlistId, userId);
    const r = await this.db.query(
      `SELECT COALESCE(sum(p.current_price), 0) AS cur, COALESCE(sum(wi.added_price), 0) AS added
         FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
        WHERE wi.wishlist_id = $1 AND wi.user_id = $2`,
      [wishlistId, userId],
    );
    const cur = Math.round(Number(r.rows[0].cur) * 100) / 100;
    const added = Math.round(Number(r.rows[0].added) * 100) / 100;
    return {
      currency: 'AED',
      currentTotal: cur,
      addedTotal: added,
      savings: Math.round((added - cur) * 100) / 100,
      points: [{ at: new Date().toISOString(), total: cur }],
    };
  }
}