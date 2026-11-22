import { z } from 'zod';
import { AppError } from './errors';

/** Opaque cursor = base64url(JSON). Clients must treat it as a black box. */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor<T>(raw: string | undefined, schema: z.ZodType<T>): T | null {
  if (raw === undefined || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const r = schema.safeParse(parsed);
    if (r.success) return r.data;
  } catch {
    /* fall through */
  }
  throw new AppError(400, 'INVALID_CURSOR', 'The cursor is invalid');
}