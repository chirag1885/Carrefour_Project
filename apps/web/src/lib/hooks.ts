'use client';

import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from './api';
import { useAuth } from './auth';
import type { AppNotification, Cart, Page, Wishlist } from './types';

export function useWishlists() {
  const { user } = useAuth();
  const swr = useSWR<Wishlist[]>(user ? '/wishlists' : null, fetcher);
  return { ...swr, wishlists: swr.data ?? [], defaultWishlist: swr.data?.find((w) => w.isDefault) };
}

export function useCart() {
  const { user } = useAuth();
  return useSWR<Cart>(user ? '/cart' : null, fetcher);
}

/** Re-fetch every cached response whose key contains one of these fragments (works for infinite lists too). */
export function useInvalidate() {
  const { mutate } = useSWRConfig();
  return (...fragments: string[]) =>
    mutate((key) => typeof key === 'string' && fragments.some((f) => key.includes(f)));
}

export function useUnreadCount() {
  const { user } = useAuth();
  // polled every 30 s now; Phase 4's WebSocket push will make this instant
  return useSWR<{ count: number }>(user ? '/notifications/unread-count' : null, fetcher, { refreshInterval: 30000 });
}

export function useLatestNotifications(limit = 8) {
  const { user } = useAuth();
  return useSWR<Page<AppNotification>>(user ? `/notifications?limit=${limit}` : null, fetcher, { refreshInterval: 30000 });
}