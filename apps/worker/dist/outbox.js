"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETAIN = exports.MARK_FAILED = exports.TAKE_BATCH = void 0;
exports.toMessage = toMessage;
exports.failureDelay = failureDelay;
const zod_1 = require("zod");
const envelope = zod_1.z.object({
    event_id: zod_1.z.uuid(),
    schema_version: zod_1.z.literal(1),
    occurred_at: zod_1.z.iso.datetime(),
    product_id: zod_1.z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const eventSchema = zod_1.z.discriminatedUnion('event_type', [
    envelope.extend({
        event_type: zod_1.z.literal('price.changed'),
        sku: zod_1.z.string().min(1),
        old_price: zod_1.z.number().nonnegative(),
        new_price: zod_1.z.number().positive(),
        currency: zod_1.z.string().length(3),
        source: zod_1.z.enum(['admin', 'promo', 'simulator']),
    }),
    envelope.extend({
        event_type: zod_1.z.literal('stock.changed'),
        store_id: zod_1.z.number().int().positive(),
        old_qty: zod_1.z.number().int().nonnegative(),
        new_qty: zod_1.z.number().int().nonnegative(),
    }),
]);
function toMessage(row) {
    const parsed = eventSchema.safeParse(row.payload);
    if (!parsed.success)
        return null;
    const event = parsed.data;
    if (event.event_id !== row.id || event.event_type !== row.topic || String(event.product_id) !== row.key) {
        return null;
    }
    return {
        topic: event.event_type,
        messages: [{
                key: row.key,
                value: JSON.stringify(row.payload),
                headers: {
                    event_id: event.event_id,
                    event_type: event.event_type,
                    schema_version: String(event.schema_version),
                },
            }],
    };
}
function failureDelay(base, failures, random = Math.random) {
    const maximum = Math.min(30_000, base * 2 ** Math.min(failures - 1, 16));
    return Math.round(maximum * (0.5 + random() * 0.5));
}
exports.TAKE_BATCH = `
  SELECT o.id, o.topic, o.key, o.payload
  FROM outbox_events AS o
  WHERE o.published_at IS NULL AND o.failed_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM outbox_events AS failed
      WHERE failed.topic = o.topic AND failed.key = o.key
        AND failed.failed_at IS NOT NULL AND failed.publish_order < o.publish_order
    )
  ORDER BY o.publish_order
  LIMIT $1
  FOR UPDATE OF o SKIP LOCKED
`;
exports.MARK_FAILED = `
  UPDATE outbox_events
  SET attempts = attempts + 1,
      last_error = $2,
      failed_at = CASE WHEN attempts + 1 >= 5 THEN clock_timestamp() ELSE NULL END
  WHERE id = $1
  RETURNING attempts
`;
exports.RETAIN = `
  WITH expired AS (
    SELECT id FROM outbox_events
    WHERE published_at < now() - make_interval(days => $1::int)
    ORDER BY published_at, id LIMIT 5000
  )
  DELETE FROM outbox_events WHERE id IN (SELECT id FROM expired)
`;
