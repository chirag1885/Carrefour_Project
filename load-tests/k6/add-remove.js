import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, login, auth, idem } from './common.js';

const users = JSON.parse(open('./users.json'));

export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '60s', target: 100 },
    { duration: '20s', target: 0 },
  ],
  thresholds: { 'http_req_duration{kind:write}': ['p(95)<150'], http_req_failed: ['rate<0.01'] },
};

export function setup() {
  const tokens = users.slice(0, 50).map((e) => login(e));
  const products = http.get(`${BASE}/products?limit=100`, auth(tokens[0])).json('items').map((p) => p.id);
  return { tokens, products };
}

export default function ({ tokens, products }) {
  const h = auth(tokens[__VU % tokens.length], { 'Idempotency-Key': idem() });
  const wl = http.get(`${BASE}/wishlists`, h).json('0.id');
  const productId = products[Math.floor(Math.random() * products.length)];

  const add = http.post(`${BASE}/wishlists/${wl}/items`, JSON.stringify({ productId }), { ...h, tags: { kind: 'write' } });
  check(add, { 'added or already there': (r) => r.status === 201 || r.status === 409 });
  if (add.status === 201) {
    const del = http.del(`${BASE}/wishlists/${wl}/items/${add.json('id')}`, null, { ...h, tags: { kind: 'write' } });
    check(del, { 'removed': (r) => r.status === 204 });
  }
  sleep(0.5);
}