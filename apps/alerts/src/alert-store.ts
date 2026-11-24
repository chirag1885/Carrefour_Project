import type { PoolClient } from 'pg';
import { decide, type WishlistItem, type UserPreferences } from './alert-decision';
import { buildNotification } from './alert-message';
import type { Channel, ProductEvent } from './events';

interface Row {
  id: string; user_id: string; target_price: string | null; added_price: string;
  notify_on_drop: boolean; notify_on_restock: boolean; notify_on_low_stock: boolean;
  low_stock_threshold: number; store_id: number | null; last_notified_price: string | null;
  channel_in_app: boolean; channel_email: boolean; min_drop_percent: string;
  max_alerts_per_day: number; delivery_mode: string; timezone: string;
  quiet_until: Date | null; next_digest: Date; tomorrow_digest: Date;
}

// PostgreSQL applies the user's timezone (including DST); overnight quiet hours are supported.
export const CANDIDATES = `
SELECT wi.*, p.channel_in_app,p.channel_email,p.min_drop_percent,p.max_alerts_per_day,
 p.delivery_mode,u.timezone,
 CASE WHEN p.quiet_start IS NULL OR p.quiet_end IS NULL OR p.quiet_start=p.quiet_end THEN NULL
 WHEN p.quiet_start<p.quiet_end AND local.t::time>=p.quiet_start AND local.t::time<p.quiet_end
 THEN (local.t::date+p.quiet_end) AT TIME ZONE u.timezone
 WHEN p.quiet_start>p.quiet_end AND local.t::time>=p.quiet_start
 THEN (local.t::date+1+p.quiet_end) AT TIME ZONE u.timezone
 WHEN p.quiet_start>p.quiet_end AND local.t::time<p.quiet_end
 THEN (local.t::date+p.quiet_end) AT TIME ZONE u.timezone END AS quiet_until,
 (local.t::date + CASE WHEN local.t::time>=make_time(p.digest_hour_local,0,0) THEN 1 ELSE 0 END
 + make_time(p.digest_hour_local,0,0)) AT TIME ZONE u.timezone AS next_digest,
 (local.t::date+1+make_time(p.digest_hour_local,0,0)) AT TIME ZONE u.timezone AS tomorrow_digest
FROM wishlist_items wi JOIN users u ON u.id=wi.user_id
JOIN user_preferences p ON p.user_id=u.id
CROSS JOIN LATERAL (SELECT statement_timestamp() AT TIME ZONE u.timezone AS t) local
WHERE wi.product_id=$1 AND wi.added_at <= $2
ORDER BY wi.user_id,wi.id
`;

export async function materializeEvent(c: PoolClient, event: ProductEvent): Promise<number> {
  // Same transaction as notification rows and delivery jobs: a crash rolls everything back.
  const inserted = await c.query('INSERT INTO alert_consumed_events(event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.event_id]);
  if (!inserted.rowCount) return 0;
  if (event.event_type === 'price.changed' && event.new_price >= event.old_price) return 0;
  // Serialize quota allocation per user across all product partitions. Acquire locks in UUID order.
  await c.query(`SELECT u.id FROM users u WHERE EXISTS
    (SELECT 1 FROM wishlist_items w WHERE w.user_id=u.id AND w.product_id=$1)
    ORDER BY u.id FOR UPDATE OF u`, [event.product_id]);
  const { rows } = await c.query<Row>(CANDIDATES, [event.product_id, event.occurred_at]);
  const clock = (await c.query<{ t: Date }>('SELECT clock_timestamp() AS t')).rows[0].t;
  let count = 0;
  for (const r of rows) {
    const channels: Channel[] = [];
    if (r.channel_in_app) channels.push('in_app');
    if (r.channel_email) channels.push('email');
    const item: WishlistItem = {
      targetPrice: r.target_price === null ? null : Number(r.target_price),
      notifyOnDrop: r.notify_on_drop, notifyOnRestock: r.notify_on_restock,
      notifyOnLowStock: r.notify_on_low_stock, lowStockThreshold: r.low_stock_threshold, storeId: r.store_id,
    };
    const prefs: UserPreferences = { channels, minDropPercent: Number(r.min_drop_percent),
      maxAlertsPerDay: r.max_alerts_per_day, deliveryMode: r.delivery_mode === 'daily_digest' ? 'digest' : 'instant' };
    if (!prefs.maxAlertsPerDay) continue;
    // Per-user/per-product cooldown, not one shared key suppressing other customers.
    const low = await c.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND product_id=$2
      AND type='LOW_STOCK' AND payload->>'store_id'=$3 AND created_at > now()-interval '24 hours' LIMIT 1`,
      [r.user_id,event.product_id,event.event_type === 'stock.changed' ? String(event.store_id) : '']);
    const d = decide(event,item,prefs,{
      dedupeHit:false, capCount:0, lastNotifiedPrice:r.last_notified_price===null?null:Number(r.last_notified_price),
      lowStockCooldown:Boolean(low.rowCount), quietUntil:r.quiet_until, nextDigestAt:r.next_digest,
      tomorrowDigestAt:r.tomorrow_digest,
    },clock);
    if (d.action !== 'send') continue;
    let due = d.deliverAfter ?? clock;
    // Reserve a slot on the intended local calendar day. Do not let deferred alerts bypass the cap.
    let reserved = false;
    for (let day=0;day<7;day++) {
      const q = await c.query<{ n: string }>(`SELECT count(*) n FROM notifications
        WHERE user_id=$1 AND (COALESCE(deliver_after,created_at) AT TIME ZONE $2)::date =
        ($3::timestamptz AT TIME ZONE $2)::date`, [r.user_id,r.timezone,due]);
      if (Number(q.rows[0].n)<prefs.maxAlertsPerDay) { reserved=true; break; }
      due = (await c.query<{ t: Date }>(`SELECT (($1::timestamptz AT TIME ZONE $2)::date+1+
        ($3::timestamptz AT TIME ZONE $2)::time) AT TIME ZONE $2 AS t`,[due,r.timezone,r.tomorrow_digest])).rows[0].t;
    }
    if (!reserved) continue;
    const message = buildNotification(event,r.user_id,item,{...d,deliverAfter:due},{
      lowestInDays:null,offerLabel:null,addedPrice:Number(r.added_price),
    });
    const n = await c.query<{id:string}>(`INSERT INTO notifications
      (user_id,type,product_id,payload,idempotency_key,status,deliver_after)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [r.user_id,message.type,event.product_id,JSON.stringify({...message.payload,occurred_at:event.occurred_at}),
        message.idempotency_key,due>clock?'deferred':'created',due]);
    if (!n.rowCount) continue;
    await c.query(`INSERT INTO notification_deliveries(notification_id,channel,next_attempt_at)
      SELECT $1,channel,$2 FROM unnest($3::text[]) AS channel`, [n.rows[0].id,due,channels]);
    if (event.event_type==='price.changed') {
      await c.query('UPDATE wishlist_items SET last_notified_price=$1,last_notified_at=now() WHERE id=$2',
        [event.new_price,r.id]);
    }
    count++;
  }
  return count;
}
