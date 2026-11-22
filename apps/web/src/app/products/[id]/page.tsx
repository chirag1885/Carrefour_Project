'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { ProductImage, StockPill } from '@/components/ProductCard';
import { useToast } from '@/components/Toast';
import { ApiError, api, fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { aed } from '@/lib/format';
import { useInvalidate, useWishlists } from '@/lib/hooks';
import type { ProductDetails } from '@/lib/types';

export default function ProductPage() {
  return (
    <RequireAuth>
      <Details />
    </RequireAuth>
  );
}

function Details() {
  const { id } = useParams<{ id: string }>();
  const { data: p, error } = useSWR<ProductDetails>(`/products/${id}`, fetcher);
  const { wishlists, defaultWishlist } = useWishlists();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [wlId, setWlId] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!p) return <p className="text-gray-500">Loading…</p>;

  const discount = p.listPrice && p.listPrice > p.currentPrice ? Math.round((1 - p.currentPrice / p.listPrice) * 100) : 0;
  const chosen = wlId || defaultWishlist?.id || '';

  async function addToWishlist() {
    if (!p || !chosen) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { productId: p.id };
      if (target.trim()) body.targetPrice = Number(target);
      await api(`/wishlists/${chosen}/items`, { method: 'POST', body });
      toast(target.trim() ? `Added. We'll alert you at ${aed(Number(target))}` : 'Added to wishlist');
      await invalidate('/wishlists');
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'ALREADY_IN_WISHLIST' ? 'Already in that wishlist' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addToCart() {
    if (!p) return;
    try {
      await api('/cart/items', { method: 'POST', body: { productId: p.id, quantity: 1 } });
      toast('Added to cart');
      await invalidate('/cart');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <ProductImage src={p.imageUrl} alt={p.nameEn} className="mx-auto max-h-[420px] object-contain" />
      </div>

      <div className="flex flex-col gap-4">
        <div>
          {p.brand && <p className="text-xs uppercase tracking-wide text-gray-400">{p.brand}</p>}
          <h1 className="text-2xl font-bold">{p.nameEn}</h1>
          <p className="text-sm text-gray-500">{p.category}{p.subcategory ? ` › ${p.subcategory}` : ''}</p>
        </div>

        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-3xl font-bold text-brand">{aed(p.currentPrice)}</span>
          {discount > 0 && p.listPrice && (
            <>
              <span className="text-gray-400 line-through">{aed(p.listPrice)}</span>
              <span className="font-semibold text-accent">-{discount}%</span>
            </>
          )}
          <StockPill stock={p.totalStock} />
        </div>

        {p.badges.map((b) => (
          <span key={b} className="w-fit rounded bg-green-100 px-2 py-1 text-sm font-semibold text-green-800">{b}</span>
        ))}

        {p.offers.length > 0 && (
          <ul className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            {p.offers.map((o) => (
              <li key={o.id}>🏷️ {o.label}</li>
            ))}
          </ul>
        )}

        {p.descriptionEn && <p className="text-sm text-gray-700">{p.descriptionEn}</p>}

        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">Track this price</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={chosen} onChange={(e) => setWlId(e.target.value)} className="rounded border px-3 py-2">
              {wishlists.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Alert me below… (AED, optional)"
              inputMode="decimal"
              className="flex-1 rounded border px-3 py-2"
            />
            <button onClick={addToWishlist} disabled={busy || !chosen} className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-60">
              ♥ Add to wishlist
            </button>
          </div>
        </div>

        <button
          onClick={addToCart}
          disabled={p.totalStock <= 0}
          className="rounded-lg bg-brand px-5 py-3 font-medium text-white hover:bg-brand-dark disabled:bg-gray-300"
        >
          {p.totalStock <= 0 ? 'Out of stock' : 'Add to cart'}
        </button>
      </div>
    </div>
  );
}