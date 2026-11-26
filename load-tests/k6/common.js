import http from 'k6/http';
import { check } from 'k6';

export const BASE = __ENV.BASE_URL || 'http://host.docker.internal:8000/api/v1';
export const PASSWORD = __ENV.PASSWORD || 'Demo@1234';

export function login(email) {
  const r = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(r, { 'login 200': (x) => x.status === 200 });
  return r.json('accessToken');
}

export const auth = (token, extra = {}) => ({
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
});

export const idem = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${__VU}`;