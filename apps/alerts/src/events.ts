import { z } from 'zod';

export const ChannelSchema = z.enum(['in_app', 'email']);
export const NotificationTypeSchema = z.enum([
  'PRICE_DROP', 'TARGET_REACHED', 'BACK_IN_STOCK', 'STORE_BACK_IN_STOCK',
  'LOW_STOCK', 'SIMILAR_SUGGESTION', 'DIGEST',
]);
export type Channel = z.infer<typeof ChannelSchema>;
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
const productId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const money = z.number().min(0).max(99_999_999.99).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001);
const envelope = z.object({
  event_id: z.uuid(), schema_version: z.literal(1), occurred_at: z.iso.datetime(),
  product_id: productId,
});
export const PriceChanged = envelope.extend({
  event_type: z.literal('price.changed'), sku: z.string().min(1),
  old_price: money, new_price: money.refine(n => n > 0),
  currency: z.literal('AED'), source: z.enum(['admin', 'promo', 'simulator']),
});
export const StockChanged = envelope.extend({
  event_type: z.literal('stock.changed'), store_id: z.number().int().positive(),
  old_qty: z.number().int().nonnegative(), new_qty: z.number().int().nonnegative(),
});
export const ProductEvent = z.discriminatedUnion('event_type', [PriceChanged, StockChanged]);
export type ProductEvent = z.infer<typeof ProductEvent>;
export type PriceChangedPayload = z.infer<typeof PriceChanged>;
export type StockChangedPayload = z.infer<typeof StockChanged>;
export const notificationKey = (type: NotificationType, user: string, product: number, event: string) =>
  [type, user, product, event].join(':');
export const NotificationRequested = envelope.extend({
  event_type: z.literal('notification.requested'),
  user_id: z.uuid(), type: NotificationTypeSchema,
  idempotency_key: z.string().min(1),
  channels: z.array(ChannelSchema).min(1).refine(a => new Set(a).size === a.length),
  deliver_after: z.iso.datetime().nullable(),
  payload: z.object({
    old_price: money.optional(), new_price: money.optional(),
    drop_pct: z.number().min(0).max(100).optional(),
    lowest_in_days: z.union([z.literal(30), z.literal(60), z.literal(90)]).nullable().optional(),
    target_hit: z.boolean().optional(), added_price: money.optional(),
    savings_vs_added: z.number().optional(), offer_label: z.string().nullable().optional(),
    old_qty: z.number().int().nonnegative().optional(), new_qty: z.number().int().nonnegative().optional(),
    store_id: z.number().int().positive().optional(), cta_url: z.string().startsWith('/products/'),
  }),
}).refine(e => e.idempotency_key === notificationKey(e.type, e.user_id, e.product_id, e.event_id), {
  message: 'idempotency key does not match event identity',
});
export type NotificationRequested = z.infer<typeof NotificationRequested>;
const cursor = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(v => BigInt(v) <= 9223372036854775807n);
export const AlertFanout = envelope.extend({
  event_type: z.literal('alert.fanout'), cursor_from: cursor, cursor_to: cursor,
  price_event: PriceChanged,
}).refine(e => BigInt(e.cursor_from) < BigInt(e.cursor_to) &&
  e.event_id === e.price_event.event_id && e.product_id === e.price_event.product_id);
