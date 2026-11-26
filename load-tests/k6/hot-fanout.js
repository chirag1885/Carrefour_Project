import http from 'k6/http';
import { check } from 'k6';
import { BASE, login, auth } from './common.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const token = login(__ENV.ADMIN_EMAIL || 'admin@carrefour.test');
  const id = __ENV.PRODUCT_ID;
  const cur = http.get(`${BASE}/products/${id}`, auth(token)).json('currentPrice');
  const next = Math.max(0.01, Math.round(cur * 0.8 * 100) / 100); // -20% clears every threshold
  const r = http.put(`${BASE}/admin/products/${id}/price`, JSON.stringify({ price: next, source: 'promo' }), auth(token));
  check(r, { 'price set': (x) => x.status === 200 });
  console.log(`price ${cur} -> ${next} at ${new Date().toISOString()}`);
}