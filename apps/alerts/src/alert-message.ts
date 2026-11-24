import { NotificationRequested, notificationKey, type ProductEvent } from './events';
import { dropPercent, fils, type Decision, type WishlistItem } from './alert-decision';

export interface AlertEnrichment {
  lowestInDays: 30 | 60 | 90 | null;
  offerLabel: string | null;
  addedPrice: number;
}

export function buildNotification(event: ProductEvent, userId: string, item: WishlistItem,
  decision: Extract<Decision, { action: 'send' }>, enrichment: AlertEnrichment): NotificationRequested {
  const idempotencyKey = notificationKey(decision.type, userId, event.product_id, event.event_id);
  const payload = event.event_type === 'price.changed' ? {
    old_price: event.old_price, new_price: event.new_price,
    drop_pct: dropPercent(event.old_price, event.new_price),
    lowest_in_days: enrichment.lowestInDays, offer_label: enrichment.offerLabel,
    target_hit: item.targetPrice !== null && fils(event.new_price) <= fils(item.targetPrice),
    added_price: enrichment.addedPrice,
    savings_vs_added: Number(fils(enrichment.addedPrice) - fils(event.new_price)) / 100,
  } : { old_qty: event.old_qty, new_qty: event.new_qty, store_id: event.store_id };
  return NotificationRequested.parse({
    event_type: 'notification.requested', schema_version: 1, event_id: event.event_id,
    occurred_at: event.occurred_at, product_id: event.product_id, user_id: userId,
    type: decision.type, idempotency_key: idempotencyKey, channels: decision.channels,
    deliver_after: decision.deliverAfter?.toISOString() ?? null,
    payload: { ...payload, cta_url: '/products/' + event.product_id + '?ref=alert&notif=' + encodeURIComponent(idempotencyKey) },
  });
}
