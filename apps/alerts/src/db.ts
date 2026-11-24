import { Pool, type PoolClient } from 'pg';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const env = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_DB: z.string().min(1).default('wishlist'),
  POSTGRES_USER: z.string().min(1).default('wishlist'),
  POSTGRES_PASSWORD: z.string().optional(),
}).parse(process.env);
export const pool = new Pool(env.DATABASE_URL ? {
  connectionString: env.DATABASE_URL, max: 5,
} : {
  host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, database: env.POSTGRES_DB,
  user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, max: 5,
});
pool.on('error', () => console.error(JSON.stringify({ event: 'postgres_idle_error' })));

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { c.release(); }
}
