import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PRODUCT_COLS_JOINED, productRowFromJoin, toProduct } from '../catalogue/product.mapper';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { DbService } from '../db/db.service';
import type { GiftClaimDto, ShareOptionsDto } from './sharing.schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIGID_RE = /^[1-9][0-9]{0,17}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

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

  /** Public view: only product info and whether it is already claimed. No owner details, no target prices. */
  async view(token: string) {
    const s = await this.resolve(token);
    const r = await this.db.query(
      `SELECT wi.id, (c.item_id IS NOT NULL) AS is_claimed, ${PRODUCT_COLS_JOINED}
         FROM wishlist_items wi
         JOIN products p ON p.id = wi.product_id
         LEFT JOIN wishlist_item_claims c ON c.item_id = wi.id
        WHERE wi.wishlist_id = $1
        ORDER BY wi.id DESC LIMIT 200`,
      [s.wishlist_id],
    );
    return {
      name: s.name,
      items: r.rows.map((row) => ({ id: String(row.id), product: toProduct(productRowFromJoin(row)), isClaimed: row.is_claimed as boolean })),
    };
  }

  async claim(userId: string, token: string, itemId: string, dto: GiftClaimDto): Promise<void> {
    const s = await this.resolve(token);
    if (!BIGID_RE.test(itemId)) throw notFound('ITEM_NOT_FOUND', 'Item not found');
    if (s.user_id === userId) throw forbidden('OWNER_CANNOT_CLAIM', 'You cannot claim items on your own wishlist');

    const item = await this.db.query('SELECT id FROM wishlist_items WHERE id = $1 AND wishlist_id = $2', [itemId, s.wishlist_id]);
    if (!item.rows[0]) throw notFound('ITEM_NOT_FOUND', 'Item not found');

    const ins = await this.db.query(
      'INSERT INTO wishlist_item_claims (item_id, claimed_by) VALUES ($1, $2) ON CONFLICT (item_id) DO NOTHING',
      [itemId, dto.claimedBy],
    );
    if (ins.rowCount === 0) throw conflict('ALREADY_CLAIMED', 'Someone has already claimed this gift');
  }
}