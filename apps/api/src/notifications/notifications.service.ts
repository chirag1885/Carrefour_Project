import { Injectable } from '@nestjs/common';
import { PRODUCT_COLS_JOINED, productRowFromJoin, toProduct } from '../catalogue/product.mapper';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { notFound } from '../common/errors';
import { DbService } from '../db/db.service';
import { ListNotificationsDto, NotificationCursor } from './notifications.schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The user-facing notification FEED (read side). Creating notifications is the Alert Engine's job (Phase 4).
 * Notifications that are still "deferred" (quiet hours / digest) are not shown until they are delivered.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  async list(userId: string, dto: ListNotificationsDto) {
    const cursor = decodeCursor(dto.cursor, NotificationCursor);
    const r = await this.db.query(
      `SELECT n.id, n.type, n.product_id, n.payload, n.status, n.created_at, n.read_at, n.clicked_at,
              to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
              ${PRODUCT_COLS_JOINED}
         FROM notifications n
         LEFT JOIN products p ON p.id = n.product_id
        WHERE n.user_id = $1
          AND n.status <> 'deferred'
          AND ($2::boolean IS NOT TRUE OR n.read_at IS NULL)
          AND ($3::timestamptz IS NULL OR n.created_at > $3::timestamptz)
          AND ($4::timestamptz IS NULL OR (n.created_at, n.id) < ($4::timestamptz, $5::uuid))
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $6`,
      [userId, dto.unread === 'true', dto.since ?? null, cursor?.t ?? null, cursor?.id ?? null, dto.limit + 1],
    );

    const hasMore = r.rows.length > dto.limit;
    const page = hasMore ? r.rows.slice(0, dto.limit) : r.rows;
    const last = page[page.length - 1];
    return {
      items: page.map((n) => ({
        id: n.id as string,
        type: n.type as string,
        productId: n.product_id === null ? null : String(n.product_id),
        // joined product summary so the UI can show a name and picture without N extra requests
        product: n.p_id === null ? null : toProduct(productRowFromJoin(n)),
        payload: n.payload as Record<string, unknown>,
        status: n.status as string,
        createdAt: (n.created_at as Date).toISOString(),
        readAt: n.read_at ? (n.read_at as Date).toISOString() : null,
        clickedAt: n.clicked_at ? (n.clicked_at as Date).toISOString() : null,
      })),
      nextCursor: hasMore ? encodeCursor({ t: last.cursor_ts, id: last.id }) : null,
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const r = await this.db.query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL AND status <> 'deferred'`,
      [userId],
    );
    return { count: r.rows[0].n };
  }

  async markRead(userId: string, id: string): Promise<void> {
    this.assertId(id);
    const r = await this.db.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [id, userId]);
    if (r.rowCount === 0) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  }

  /** A click also counts as "read". (Phase 6 will also write an ALERT_CLICKED analytics event.) */
  async recordClick(userId: string, id: string): Promise<void> {
    this.assertId(id);
    const r = await this.db.query(
      `UPDATE notifications SET clicked_at = COALESCE(clicked_at, now()), read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (r.rowCount === 0) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  }

  private assertId(id: string): void {
    if (!UUID_RE.test(id)) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
}