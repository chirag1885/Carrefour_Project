import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE, login, auth } from './common.js';

const users = JSON.parse(open('./users.json'));

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '60s', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: { http_req_duration: ['p(95)<200'], http_req_failed: ['rate<0.001'] },
};

export function setup() {
  return users.slice(0, 50).map((e) => login(e)); // 50 sessions reused by all virtual users
}

export default function (tokens) {
  const h = auth(tokens[__VU % tokens.length]);
  const lists = http.get(`${BASE}/wishlists`, h);
  check(lists, { 'lists 200': (r) => r.status === 200 });
  if (lists.status === 200 && lists.json().length > 0) {
    const items = http.get(`${BASE}/wishlists/${lists.json('0.id')}/items?limit=20`, h);
    check(items, { 'items 200': (r) => r.status === 200 });
  }
  sleep(1);
}