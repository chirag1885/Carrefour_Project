import { z } from 'zod';

export interface OutboxRow {
  id: string;
  topic: string;
  key: string;
  payload: unknown;
}

const envelope = z.object({
  event_id: z.uuid(),
  schema_version: z.literal(1),
  occurred_at: z.iso.datetime(),
  product_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const eventSchema = z.discriminatedUnion('event_type', [
  envelope.extend({
    event_type: z.literal('price.changed'),
    sku: z.string().min(1),
    old_price: z.number().nonnegative(),
    new_price: z.number().positive(),
    currency: z.string().length(3),
    source: z.enum(['admin', 'promo', 'simulator']),
  }),
  envelope.extend({
    event_type: z.literal('stock.changed'),
    store_id: z.number().int().positive(),
    old_qty: z.number().int().nonnegative(),
    new_qty: z.number().int().nonnegative(),
  }),
]);

export function toMessage(row: OutboxRow) {
  const parsed = eventSchema.safeParse(row.payload);
  if (!parsed.success) return null;
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

export function failureDelay(base: number, failures: number, random = Math.random): number {
  const maximum = Math.min(30_000, base * 2 ** Math.min(failures - 1, 16));
  return Math.round(maximum * (0.5 + random() * 0.5));
}

export const TAKE_BATCH = `
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

export const MARK_FAILED = `
  UPDATE outbox_events
  SET attempts = attempts + 1,
      last_error = $2,
      failed_at = CASE WHEN attempts + 1 >= 5 THEN clock_timestamp() ELSE NULL END
  WHERE id = $1
  RETURNING attempts
`;

export const RETAIN = `
  WITH expired AS (
    SELECT id FROM outbox_events
    WHERE published_at < now() - make_interval(days => $1::int)
    ORDER BY published_at, id LIMIT 5000
  )
  DELETE FROM outbox_events WHERE id IN (SELECT id FROM expired)
`;
