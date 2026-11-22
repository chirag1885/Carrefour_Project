'use client';

import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from './api';
import { useAuth } from './auth';
import type { Cart, Wishlist } from './types';

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