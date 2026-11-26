import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PRODUCT_COLS_JOINED, productRowFromJoin, toProduct } from '../catalogue/product.mapper';
import { AppError, badRequest, notFound } from '../common/errors';
import { DbService } from '../db/db.service';
import type { CopyWishlistDto, ShareOptionsDto } from './sharing.schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_WISHLISTS = 20;

interface WishlistRow {
  id: string;
  name: string;
  is_default: boolean;
  visibility: string;
  created_at: Date;
}

@Injectable()
export class SharingService {
  constructor(private readonly db: DbService) {}

  async createShare(userId: string, wishlistId: string, dto: ShareOptionsDto) {
    if (!UUID_RE.test(wishlistId)) throw notFound('WISHLIST_NOT_FOUND', 'Wishlist not found');
    const w = await this.db.query('SELECT id FROM wishlists WHERE id = $1 AND user_id = $2', [wishlistId, userId]);
    if (!w.rows[0]) throw notFound('WISHLIST_NOT_FOUND', 'Wishlist not found');
    if (dto.expiresAt && new Date(dto.expiresAt).getTime() <= Date.now()) {
      throw badRequest('INVALID_EXPIRY', 'The expiry time must be in the future');
    }

    const token = randomBytes(16).toString('base64url'); // 128 bits: unguessable
    const row = await this.db.tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO wishlist_shares (wishlist_id, token, permission, expires_at)
         VALUES ($1, $2, $3, $4) RETURNING token, permission, expires_at`,
        [wishlistId, token, dto.permission, dto.expiresAt ?? null],
      );
      await c.query(`UPDATE wishlists SET visibility = 'shared' WHERE id = $1`, [wishlistId]);
      return ins.rows[0];
    });
    return { token: row.token as string, permission: row.permission as string, expiresAt: row.expires_at ? (row.expires_at as Date).toISOString() : null };
  }

  /** An unknown, malformed or expired token is always the same "not found". */
  private async resolve(token: string): Promise<{ wishlist_id: string; name: string; user_id: string }> {
    if (!TOKEN_RE.test(token)) throw notFound('SHARE_NOT_FOUND', 'This link is invalid or has expired');
    const r = await this.db.query<{ wishlist_id: string; name: string; user_id: string }>(
      `SELECT s.wishlist_id, w.name, w.user_id
         FROM wishlist_shares s JOIN wishlists w ON w.id = s.wishlist_id
        WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > now())`,
      [token],
    );
    if (!r.rows[0]) throw notFound('SHARE_NOT_FOUND', 'This link is invalid or has expired');
    return r.rows[0];
  }

  /** Public, read-only view: product info only. No owner details, no target prices. */
  async view(token: string) {
    const s = await this.resolve(token);
    const r = await this.db.query(
      `SELECT wi.id, ${PRODUCT_COLS_JOINED}
         FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
        WHERE wi.wishlist_id = $1 AND p.is_active
        ORDER BY wi.id DESC LIMIT 200`,
      [s.wishlist_id],
    );
    return {
      name: s.name,
      items: r.rows.map((row) => ({ id: String(row.id), product: toProduct(productRowFromJoin(row)) })),
    };
  }

  /** Copies the whole shared wishlist into a NEW wishlist of the caller (optionally renamed). */
  async copy(userId: string, token: string, dto: CopyWishlistDto) {
    const s = await this.resolve(token);
    const n = await this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM wishlists WHERE user_id = $1', [userId]);
    if (n.rows[0].n >= MAX_WISHLISTS) throw new AppError(409, 'WISHLIST_LIMIT', `You can have at most ${MAX_WISHLISTS} wishlists`);

    try {
      return await this.db.tx(async (c) => {
        let name = dto.name ?? s.name;
        if (!dto.name) {
          // no name chosen: pick "<name> (2)", "<name> (3)"... until it is free
          let i = 2;
          while (i < 50 && (await c.query('SELECT 1 FROM wishlists WHERE user_id = $1 AND name = $2', [userId, name])).rows[0]) {
            name = `${s.name} (${i})`;
            i++;
          }
        }
        const w = await c.query<WishlistRow>(
          'INSERT INTO wishlists (user_id, name) VALUES ($1, $2) RETURNING id, name, is_default, visibility, created_at',
          [userId, name],
        );
        const copied = await c.query(
          `INSERT INTO wishlist_items (wishlist_id, user_id, product_id, added_price)
           SELECT $1, $2, wi.product_id, p.current_price
             FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
            WHERE wi.wishlist_id = $3 AND p.is_active
            ORDER BY wi.id LIMIT 500`,
          [w.rows[0].id, userId, s.wishlist_id],
        );
        const row = w.rows[0];
        return {
          id: row.id,
          name: row.name,
          isDefault: row.is_default,
          visibility: row.visibility,
          createdAt: row.created_at.toISOString(),
          itemCount: copied.rowCount ?? 0,
        };
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'WISHLIST_NAME_TAKEN', 'You already have a wishlist with this name');
      throw e;
    }
  }
}