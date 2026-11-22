import type { Session } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

// The access token lives only in memory (never localStorage): an XSS bug can't steal a long-lived credential.
// The long-lived refresh token is an httpOnly cookie the browser sends only to /auth/*.
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

async function doRefresh(): Promise<Session | null> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    const s = res.ok ? ((await res.json()) as Session) : null;
    accessToken = s?.accessToken ?? null;
    return s;
  } catch {
    return null;
  }
}

let refreshing: Promise<Session | null> | null = null;
/** One refresh at a time: refresh tokens rotate, so parallel refreshes would invalidate each other. */
export function refreshSession(): Promise<Session | null> {
  if (!refreshing) refreshing = doRefresh().finally(() => (refreshing = null));
  return refreshing;
}

interface Opts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean; // false for login/register/logout
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const send = () => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken && opts.auth !== false) headers.Authorization = `Bearer ${accessToken}`;
    if (method === 'POST') headers['Idempotency-Key'] = crypto.randomUUID(); // the API requires one on creating POSTs
    return fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && opts.auth !== false) {
      const s = await refreshSession();
      if (s) res = await send();
      else window.dispatchEvent(new Event('auth:expired')); // session is really gone: back to the login page
    }
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is the API running?');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? res.statusText, data?.details);
  return data as T;
}

/** SWR fetcher */
export const fetcher = <T,>(path: string) => api<T>(path);