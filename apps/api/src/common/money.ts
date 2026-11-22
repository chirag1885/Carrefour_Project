/** pg returns NUMERIC as string. The API contract uses JSON numbers (2 decimals). */
export const money = (v: string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// Exact money arithmetic for the write path.
// Prices are held as integer fils (1 AED = 100 fils), so "is 2,500.00 the same as 2,500?"
// never depends on floating point. `money()` above stays the helper for API responses.
// ---------------------------------------------------------------------------

const NUMERIC_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** pg NUMERIC(10,2) text such as "2500.00" -> integer fils (250000). */
export function filsFromNumeric(v: string): number {
  const m = NUMERIC_RE.exec(v.trim());
  if (!m) throw new RangeError(`Not a money amount: ${v}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** JSON number such as 2500 or 19.99 -> integer fils. Throws if it is negative or has more than 2 decimals. */
export function filsFromNumber(n: number): number {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Not a money amount: ${n}`);
  const fixed = n.toFixed(2);
  // 0.1 + 0.2 prints as 0.30 but is not equal to 0.3, so this rejects real float noise as well as a 3rd decimal.
  if (Number(fixed) !== n) throw new RangeError(`More than 2 decimal places: ${n}`);
  return filsFromNumeric(fixed);
}

/** 250000 -> "2500.00" (safe to send to pg as NUMERIC). */
export const filsToNumeric = (fils: number): string => `${Math.trunc(fils / 100)}.${String(fils % 100).padStart(2, '0')}`;

/** 250000 -> 2500 (a JSON number with at most 2 decimals, for events and responses). */
export const filsToNumber = (fils: number): number => Number(filsToNumeric(fils));
