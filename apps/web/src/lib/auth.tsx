'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { api, refreshSession, setAccessToken } from './api';
import type { Session, User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { mutate } = useSWRConfig();

  // On every page load, try to restore the session from the httpOnly refresh cookie.
  useEffect(() => {
    let alive = true;
    refreshSession().then((s) => {
      if (!alive) return;
      setUser(s?.user ?? null);
      setLoading(false);
    });
    const expired = () => setUser(null);
    window.addEventListener('auth:expired', expired);
    return () => {
      alive = false;
      window.removeEventListener('auth:expired', expired);
    };
  }, []);

  const start = useCallback((s: Session) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      start(await api<Session>('/auth/login', { method: 'POST', body: { email, password }, auth: false }));
    },
    [start],
  );

  const register = useCallback(
    async (fullName: string, email: string, password: string) => {
      start(await api<Session>('/auth/register', { method: 'POST', body: { fullName, email, password }, auth: false }));
    },
    [start],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', auth: false }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    await mutate(() => true, undefined, { revalidate: false }); // drop every cached response
  }, [mutate]);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}

/** Wrap a page: shows a spinner while restoring the session, redirects to /login if signed out. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);
  if (loading || !user) return <p className="p-10 text-center text-gray-500">Loading…</p>;
  return <>{children}</>;
}