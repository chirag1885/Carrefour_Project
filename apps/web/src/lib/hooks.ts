'use client';

import { useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from './api';
import { useAuth } from './auth';
import type { AppNotification, Cart, MembershipEntry, Page, Wishlist } from './types';

export function useWishlists() {
  const { user } = useAuth();
  const swr = useSWR<Wishlist[]>(user ? '/wishlists' : null, fetcher);
  return { ...swr, wishlists: swr.data ?? [], defaultWishlist: swr.data?.find((w) => w.isDefault) };
}

/** Where each product is saved: powers the filled hearts and the "already added" ticks. */
export function useWishlistMembership() {
  const { user } = useAuth();
  const swr = useSWR<MembershipEntry[]>(user ? '/wishlists/membership' : null, fetcher);
  const byProduct = useMemo(() => {
    const m = new Map<string, MembershipEntry[]>();
    for (const e of swr.data ?? []) {
      const list = m.get(e.productId);
      if (list) list.push(e);
      else m.set(e.productId, [e]);
    }
    return m;
  }, [swr.data]);
  const entriesFor = useCallback((productId: string) => byProduct.get(productId) ?? [], [byProduct]);
  return { ...swr, entriesFor };
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
  return useSWR<{ count: number }>(user ? '/notifications/unread-count' : null, fetcher, { refreshInterval: 5000 });
}

export function useLatestNotifications(limit = 8) {
  const { user } = useAuth();
  return useSWR<Page<AppNotification>>(user ? `/notifications?limit=${limit}` : null, fetcher, { refreshInterval: 5000 });
}