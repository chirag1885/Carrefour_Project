import { config } from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

// Load the repo-root .env (works when started from apps/api or from the repo root).
// Real environment variables always win over the file.
config({
  path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
  quiet: true,
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(8000),
  API_BASE_PATH: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0), // number of reverse proxies in front of the API

  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('wishlist'),
  POSTGRES_USER: z.string().default('wishlist'),
  POSTGRES_PASSWORD: z.string().default('wishlist_local'),
  DATABASE_URL: z.string().optional(),

  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_COST: z.coerce.number().int().min(4).max(14).default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${msg}\n(copy .env.example to .env and set JWT_SECRET)`);
}

export const env = parsed.data;
export type Env = typeof env;