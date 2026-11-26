import { Injectable } from '@nestjs/common';
import { PRODUCT_COLS_JOINED, productRowFromJoin, toProduct } from '../catalogue/product.mapper';
import { money } from '../common/money';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';

// "sent" = the notification was delivered on at least one channel
const SENT = `(n.status = 'sent' OR EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id = n.id AND d.status = 'sent'))`;
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null; // a missing table or column must not break the whole dashboard
  }
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  async overview(days: number) {
    const win = `>= now() - make_interval(days => $1)`;
    const [types, daily, adds, carts, buys, top] = await Promise.all([
      this.db.query<{ type: string; sent: number; opened: number; clicked: number }>(
        `SELECT n.type, count(*)::int AS sent, count(n.read_at)::int AS opened, count(n.clicked_at)::int AS clicked
           FROM notifications n
          WHERE n.created_at ${win} AND ${SENT}
          GROUP BY n.type ORDER BY sent DESC`,
        [days],
      ),
      this.db.query<{ day: string; sent: number; clicked: number }>(
        `SELECT to_char(date_trunc('day', n.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                count(*)::int AS sent, count(n.clicked_at)::int AS clicked
           FROM notifications n
          WHERE n.created_at ${win} AND ${SENT}
          GROUP BY 1 ORDER BY 1`,
        [days],
      ),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM wishlist_items WHERE added_at ${win}`, [days]),
      this.db.query<{ source: string; n: number }>(
        `SELECT source, count(*)::int AS n FROM cart_items WHERE added_at ${win} GROUP BY source`,
        [days],
      ),
      this.db.query<{ purchases: number; revenue: string; revenue_alerts: string; purchased_alerts: number }>(
        `SELECT count(*)::int AS purchases,
                COALESCE(sum(amount), 0) AS revenue,
                COALESCE(sum(amount) FILTER (WHERE notification_id IS NOT NULL), 0) AS revenue_alerts,
                count(DISTINCT notification_id)::int AS purchased_alerts
           FROM analytics_events
          WHERE event_type = 'PURCHASE_MOCK' AND occurred_at ${win}`,
        [days],
      ),
      this.db.query(
        `SELECT count(*)::int AS adds, ${PRODUCT_COLS_JOINED}
           FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
          GROUP BY p.id ORDER BY adds DESC, p.id LIMIT 20`,
      ),
    ]);

    const sent = types.rows.reduce((a, r) => a + r.sent, 0);
    const opened = types.rows.reduce((a, r) => a + r.opened, 0);
    const clicked = types.rows.reduce((a, r) => a + r.clicked, 0);
    const bySource = Object.fromEntries(carts.rows.map((r) => [r.source, r.n])) as Record<string, number>;
    const b = buys.rows[0];
    const cartFromAlerts = bySource.notification ?? 0;

    return {
      rangeDays: days,
      currency: 'AED',
      // fields from the OpenAPI contract
      alertsSent: sent,
      alertsOpened: opened,
      alertsClicked: clicked,
      wishlistAdds: adds.rows[0].n,
      cartAddsFromWishlist: bySource.wishlist ?? 0,
      cartAddsFromAlerts: cartFromAlerts,
      revenueInfluenced: money(b.revenue_alerts) ?? 0,
      // extras for the dashboard
      revenue: money(b.revenue) ?? 0,
      purchases: b.purchases,
      openRate: pct(opened, sent),
      ctr: pct(clicked, sent),
      funnel: [
        { label: 'Alerts sent', value: sent },
        { label: 'Opened', value: opened },
        { label: 'Clicked', value: clicked },
        { label: 'Added to cart', value: cartFromAlerts },
        { label: 'Purchased', value: b.purchased_alerts },
      ],
      byType: types.rows,
      daily: daily.rows,
      topWishlisted: top.rows.map((r) => ({ product: toProduct(productRowFromJoin(r)), adds: r.adds as number })),
    };
  }

  /** Is the pipeline healthy? Every probe is independent, so one failing probe shows as null instead of a 500. */
  async health() {
    const [db, redis, outbox, deliveries, counts] = await Promise.all([
      this.db.query('SELECT 1').then(() => true).catch(() => false),
      this.redis.ping(),
      safe(async () => {
        const r = await this.db.query<{ pending: number; oldest: number | null }>(
          `SELECT count(*)::int AS pending, extract(epoch FROM now() - min(created_at))::int AS oldest
             FROM outbox_events WHERE published_at IS NULL`,
        );
        return { pending: r.rows[0].pending, oldestSeconds: r.rows[0].oldest };
      }),
      safe(async () => {
        const r = await this.db.query<{ status: string; n: number }>(
          `SELECT status, count(*)::int AS n FROM notification_deliveries GROUP BY status`,
        );
        const m = Object.fromEntries(r.rows.map((x) => [x.status, x.n])) as Record<string, number>;
        return { pending: m.pending ?? 0, sent: m.sent ?? 0, failed: m.failed ?? 0, dead: m.dead ?? 0 };
      }),
      safe(async () => {
        const r = await this.db.query<{ users: number; products: number; items: number }>(
          `SELECT (SELECT count(*) FROM users)::int AS users,
                  (SELECT count(*) FROM products)::int AS products,
                  (SELECT count(*) FROM wishlist_items)::int AS items`,
        );
        return { users: r.rows[0].users, products: r.rows[0].products, wishlistItems: r.rows[0].items };
      }),
    ]);
    return { db, redis, outbox, deliveries, counts, time: new Date().toISOString() };
  }

  /** Newest notifications across all users, with delivery status. Used as the live feed in the demo. */
  async activity(limit: number) {
    const r = await this.db.query(
      `SELECT n.id, n.type, n.status, n.created_at, n.read_at, n.clicked_at, n.product_id,
              u.email AS user_email, p.name_en AS product_name,
              (SELECT string_agg(d.channel || ':' || d.status, ', ' ORDER BY d.channel)
                 FROM notification_deliveries d WHERE d.notification_id = n.id) AS deliveries
         FROM notifications n
         JOIN users u ON u.id = n.user_id
         LEFT JOIN products p ON p.id = n.product_id
        ORDER BY n.created_at DESC
        LIMIT $1`,
      [limit],
    );
    return r.rows.map((n) => ({
      id: n.id as string,
      type: n.type as string,
      status: n.status as string,
      createdAt: (n.created_at as Date).toISOString(),
      readAt: n.read_at ? (n.read_at as Date).toISOString() : null,
      clickedAt: n.clicked_at ? (n.clicked_at as Date).toISOString() : null,
      userEmail: n.user_email as string,
      productId: n.product_id === null ? null : String(n.product_id),
      productName: (n.product_name as string | null) ?? null,
      deliveries: (n.deliveries as string | null) ?? null,
    }));
  }
}