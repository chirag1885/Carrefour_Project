'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Gift } from 'lucide-react';
import useSWR from 'swr';
import { Price } from '@/components/Price';
import { ProductImage } from '@/components/ProductCard';
import { useToast } from '@/components/Toast';
import { ApiError, api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { SharedWishlist } from '@/lib/types';

export default function SharedWishlistPage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, mutate } = useSWR<SharedWishlist>(`/shared/${token}`, fetcher);
  const [busy, setBusy] = useState<string | null>(null);

  async function claim(itemId: string) {
    const name = window.prompt('Your name (shown to other gift-givers)', user?.fullName ?? '')?.trim();
    if (!name) return;
    setBusy(itemId);
    try {
      await api(`/shared/${token}/items/${itemId}/claim`, { method: 'POST', body: { claimedBy: name } });
      toast("Great, it's marked as yours to gift 🎁");
      await mutate();
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'ALREADY_CLAIMED' ? 'Someone already claimed this one' : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white p-12 text-center text-gray-500 shadow-sm">
        <p className="mb-2 text-4xl">🔗</p>
        {(error as Error).message}
      </div>
    );
  }
  if (!data) return <div className="h-64 animate-pulse rounded-2xl bg-white" />;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light text-brand"><Gift /></span>
        <div>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-sm text-gray-500">Pick something to gift. Claimed items are hidden from the owner, so it stays a surprise.</p>
        </div>
      </div>

      {data.items.length === 0 && <p className="text-gray-500">This wishlist is empty.</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {data.items.map((it) => (
          <div key={it.id} className="flex flex-col rounded-xl bg-white p-3 ring-1 ring-gray-200">
            <div className="aspect-square overflow-hidden rounded-lg bg-white">
              <ProductImage src={it.product.imageUrl} alt={it.product.nameEn} className="h-full w-full object-contain p-2" />
            </div>
            <p className="mt-2 line-clamp-2 min-h-10 text-sm">{it.product.nameEn}</p>
            <Price value={it.product.currentPrice} className="mt-1 text-gray-900" />
            <div className="mt-auto pt-3">
              {it.isClaimed ? (
                <span className="block rounded-full bg-gray-100 py-2 text-center text-sm font-medium text-gray-500">Already claimed</span>
              ) : user ? (
                <button onClick={() => claim(it.id)} disabled={busy === it.id} className="w-full rounded-full bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-60">
                  I&apos;ll gift this
                </button>
              ) : (
                <Link href="/login" className="block rounded-full border border-brand py-2 text-center text-sm font-semibold text-brand hover:bg-brand-light">
                  Sign in to claim
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}