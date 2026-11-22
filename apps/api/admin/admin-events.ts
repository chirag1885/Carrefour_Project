/**
 * Outbox event payloads for the admin write path (README section 6.3, schema_version 1).
 *
 * `occurred_at` is deliberately NOT built here: the SQL stamps it from the same clock_timestamp()
 * that stamps the history row and the outbox row, so all three always agree (see OCCURRED_AT_SQL).
 * These shapes move into packages/events when Phase 3 WI-0 creates that package.
 */
import { randomUUID } from 'crypto';

export interface PriceChangedPayload {
  event_id: string;
  event_type: 'price.changed';
  schema_version: 1;
  product_id: number;
  sku: string;
  old_price: number;
  new_price: number;
  currency: string;
  source: 'admin' | 'promo';
}

export interface StockChangedPayload {
  event_id: string;
  event_type: 'stock.changed';
  schema_version: 1;
  product_id: number;
  store_id: number;
  old_qty: number;
  new_qty: number;
}

export const newEventId = (): string => randomUUID();

/** Events carry product_id as a JSON number (README 6.3); the API itself uses string BigIds. */
export function eventProductId(id: string): number {
  const n = Number(id);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Product id ${id} is too large for an event payload`);
  return n;
}

/**
 * SQL fragment for `occurred_at`. Expects a CTE named `t` with a `ts` column (clock_timestamp()).
 * Microsecond precision, UTC, e.g. 2026-11-22T10:15:30.123456Z.
 */
export const OCCURRED_AT_SQL = `jsonb_build_object('occurred_at', to_char(t.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))`;
