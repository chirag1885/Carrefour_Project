/**
 * Simulator worker: reads simulator:state from Redis every second and calls
 * PUT /admin/products/{id}/price on the real API.
 *
 * WHY HTTP (not direct DB writes):
 *   The simulator's job is to exercise the full write path: Zod validation,
 *   the product row lock, the no-op check, the outbox insert, and the advisory
 *   lock ordering guarantee. Direct DB writes bypass all of that. Using HTTP
 *   means the simulator is also an end-to-end integration test running in prod.
 *
 * PRNG:
 *   Math.random() is not seedable. We use mulberry32, a small and fast 32-bit
 *   PRNG that is fully deterministic given the same seed. The same seed always
 *   produces the same price sequence across worker restarts.
 */

import http from 'http';
import { createServer } from 'http';
import { Registry, Counter, Gauge } from 'prom-client';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const API_BASE = process.env.SIMULATOR_API_BASE_URL ?? 'http://localhost:8000/api/v1';
const ADMIN_EMAIL = process.env.SIMULATOR_ADMIN_EMAIL ?? 'admin@carrefour.test';
const ADMIN_PASSWORD = process.env.SIMULATOR_ADMIN_PASSWORD ?? 'Demo@1234';
const REDIS_URL = process.env.REDIS_URL ?? `redis://${process.env.REDIS_HOST ?? '127.0.0.1'}:${process.env.REDIS_PORT ?? 6379}`;
const METRICS_PORT = parseInt(process.env.SIMULATOR_METRICS_PORT ?? '9466', 10);
const STATE_KEY = 'simulator:state';
const STATE_POLL_MS = 1_000;

interface SimulatorState {
  running: boolean;
  config: { eventsPerSecond: number; seed: number };
}

const DEFAULT_STATE: SimulatorState = {
  running: false,
  config: { eventsPerSecond: 1, seed: 42 },
};

// ---------------------------------------------------------------------------
// Mulberry32 PRNG — deterministic, seedable, same output on every platform.
// See https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
const registry = new Registry();
registry.setDefaultLabels({ service: 'simulator' });

const requestsTotal = new Counter({
  name: 'simulator_requests_total',
  help: 'Price change API requests by result',
  labelNames: ['result'] as const,
  registers: [registry],
});

const epsActual = new Gauge({
  name: 'simulator_events_per_second_actual',
  help: 'Actual events per second (rolling 5-second window)',
  registers: [registry],
});

// Rolling 5-second window of request timestamps
const recentRequests: number[] = [];
function recordRequest(): void {
  const now = Date.now();
  recentRequests.push(now);
  const cutoff = now - 5_000;
  while (recentRequests[0] < cutoff) recentRequests.shift();
  epsActual.set(recentRequests.length / 5);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
let accessToken: string | null = null;

async function apiCall(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

async function login(): Promise<void> {
  const { status, json } = await apiCall('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (status !== 200) throw new Error(`Login failed: ${status} ${JSON.stringify(json)}`);
  accessToken = (json as { accessToken: string }).accessToken;
  console.log(JSON.stringify({ event: 'simulator_login', email: ADMIN_EMAIL }));
}

// ---------------------------------------------------------------------------
// Product cache — refreshed every 60 s
// ---------------------------------------------------------------------------
interface Product { id: string; currentPrice: number }
let products: Product[] = [];
let lastProductRefresh = 0;

async function refreshProducts(): Promise<void> {
  const { status, json } = await apiCall('GET', '/products?limit=100');
  if (status !== 200) return;
  const page = json as { items: { id: string; currentPrice: number }[] };
  if (page.items?.length) {
    products = page.items.map((p) => ({ id: p.id, currentPrice: p.currentPrice }));
    lastProductRefresh = Date.now();
    console.log(JSON.stringify({ event: 'products_refreshed', count: products.length }));
  }
}

// ---------------------------------------------------------------------------
// Price change logic
// ---------------------------------------------------------------------------
interface ProductState { id: string; basePrice: number; currentPrice: number }
const productStates = new Map<string, ProductState>();

function nextPrice(state: ProductState, rng: () => number): number {
  // ±1–3% random walk, clamped to 50%–150% of the original base price
  const pct = (rng() * 0.04) - 0.01;         // -1% to +3%
  const drift = rng() < 0.5 ? pct : -pct;    // roughly symmetric
  const raw = state.currentPrice * (1 + drift);
  const lo = state.basePrice * 0.50;
  const hi = state.basePrice * 1.50;
  const clamped = Math.max(lo, Math.min(hi, raw));
  // Round to 2 decimal places (integer-fils arithmetic to avoid float noise)
  return Math.round(clamped * 100) / 100;
}

// ---------------------------------------------------------------------------
// Redis state reader
// ---------------------------------------------------------------------------
async function readState(redisClient: import('ioredis').default): Promise<SimulatorState> {
  try {
    const raw = await redisClient.get(STATE_KEY);
    return raw ? (JSON.parse(raw) as SimulatorState) : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  // Dynamic import so we don't need to compile the ioredis types into the entrypoint
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  redis.on('error', (e: Error) => console.error(JSON.stringify({ event: 'redis_error', message: e.message })));

  // Initial login and product load
  await login();
  await refreshProducts();

  let currentSeed = DEFAULT_STATE.config.seed;
  let rng = mulberry32(currentSeed);
  let lastTick = Date.now();

  // Graceful shutdown
  let stopping = false;
  const stop = async (): Promise<void> => {
    stopping = true;
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());

  console.log(JSON.stringify({ event: 'simulator_started', apiBase: API_BASE }));

  while (!stopping) {
    await new Promise((r) => setTimeout(r, STATE_POLL_MS));

    const state = await readState(redis);
    if (!state.running || state.config.eventsPerSecond === 0) {
      lastTick = Date.now();
      continue;
    }

    // Re-seed if the seed changed (config update)
    if (state.config.seed !== currentSeed) {
      currentSeed = state.config.seed;
      rng = mulberry32(currentSeed);
    }

    // Refresh product list every 60 s
    if (Date.now() - lastProductRefresh > 60_000) await refreshProducts();
    if (products.length === 0) continue;

    // Compute how many events this tick should emit based on elapsed time
    const now = Date.now();
    const elapsed = (now - lastTick) / 1_000;
    lastTick = now;
    const count = Math.max(1, Math.round(state.config.eventsPerSecond * elapsed));

    for (let i = 0; i < count && !stopping; i++) {
      // Pick a product deterministically from the PRNG
      const idx = Math.floor(rng() * products.length);
      const product = products[idx];

      // Track per-product state
      if (!productStates.has(product.id)) {
        productStates.set(product.id, {
          id: product.id,
          basePrice: product.currentPrice,
          currentPrice: product.currentPrice,
        });
      }
      const ps = productStates.get(product.id)!;
      const newPrice = nextPrice(ps, rng);

      let { status, json } = await apiCall('PUT', `/admin/products/${product.id}/price`, {
        price: newPrice,
        source: 'simulator',
      });

      // Re-auth on 401 and retry once
      if (status === 401) {
        try { await login(); } catch { /* continue */ }
        ({ status, json } = await apiCall('PUT', `/admin/products/${product.id}/price`, {
          price: newPrice,
          source: 'simulator',
        }));
      }

      if (status === 200) {
        ps.currentPrice = newPrice;
        const result = (json as { currentPrice: number }).currentPrice !== ps.currentPrice ? 'noop' : 'changed';
        requestsTotal.inc({ result });
        recordRequest();
      } else if (status === 429) {
        requestsTotal.inc({ result: 'rate_limited' });
        const retryAfter = parseInt((json as Record<string, string>)?.retryAfter ?? '1', 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1_000));
      } else {
        requestsTotal.inc({ result: 'error' });
        console.error(JSON.stringify({ event: 'simulator_error', status, product_id: product.id }));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Metrics + health server
// ---------------------------------------------------------------------------
const metricsServer = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': registry.contentType });
    res.end(await registry.metrics());
  } else {
    res.writeHead(404);
    res.end();
  }
});

metricsServer.listen(METRICS_PORT, () => {
  console.log(JSON.stringify({ event: 'metrics_listening', port: METRICS_PORT }));
});

run().catch((e) => {
  console.error(JSON.stringify({ event: 'fatal', message: (e as Error).message }));
  process.exit(1);
});
