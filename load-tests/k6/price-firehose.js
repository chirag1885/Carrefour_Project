import http from 'k6/http';
import { check } from 'k6';
import { BASE, login, auth } from './common.js';

export const options = {
  scenarios: {
    firehose: { executor: 'constant-arrival-rate', rate: 80, timeUnit: '1s', duration: '60s', preAllocatedVUs: 50, maxVUs: 200 },
  },
  thresholds: { http_req_duration: ['p(95)<300'], http_req_failed: ['rate<0.01'] },
};

export function setup() {
  const token = login(__ENV.ADMIN_EMAIL || 'admin@carrefour.test');
  const items = http.get(`${BASE}/products?limit=100`, auth(token)).json('items');
  return { token, products: items.map((p) => ({ id: p.id, price: p.currentPrice })) };
}

export default function ({ token, products }) {
  const p = products[Math.floor(Math.random() * products.length)];
  const price = Math.max(0.01, Math.round(p.price * (0.9 + Math.random() * 0.2) * 100) / 100);
  const r = http.put(`${BASE}/admin/products/${p.id}/price`, JSON.stringify({ price, source: 'promo' }), auth(token));
  check(r, { 'price set': (x) => x.status === 200 });
}