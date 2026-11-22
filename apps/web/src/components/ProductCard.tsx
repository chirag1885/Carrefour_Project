'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { aed, PLACEHOLDER_IMG } from '@/lib/format';
import { useInvalidate, useWishlists } from '@/lib/hooks';
import type { Product } from '@/lib/types';
import { useToast } from './Toast';

export function StockPill({ stock }: { stock: number }) {
  if (stock <= 0) return <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">Out of stock</span>;
  if (stock <= 5) return <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Only {stock} left</span>;
  return null;
}

export function ProductImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  // plain <img>: dataset images come from many different hosts
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src || PLACEHOLDER_IMG} alt={alt} className={className} loading="lazy" onError={(e) => { e.currentTarget.src = PLACEHOLDER_IMG; }} />;
}

export function ProductCard({ p }: { p: Product }) {
  const { defaultWishlist } = useWishlists();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const discount = p.listPrice && p.listPrice > p.currentPrice ? Math.round((1 - p.currentPrice / p.listPrice) * 100) : 0;

  async function wish() {
    if (!defaultWishlist) return;
    setBusy(true);
    try {
      await api(`/wishlists/${defaultWishlist.id}/items`, { method: 'POST', body: { productId: p.id } });
      toast('Added to your wishlist');
      await invalidate('/wishlists');
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'ALREADY_IN_WISHLIST' ? 'Already in your wishlist' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-100 transition hover:shadow-md">
      <Link href={`/products/${p.id}`} className="block aspect-square overflow-hidden bg-gray-50">
        <ProductImage src={p.imageUrl} alt={p.nameEn} className="h-full w-full object-contain p-3 transition group-hover:scale-105" />
      </Link>
      <button
        onClick={wish}
        disabled={busy}
        title="Add to wishlist"
        className="absolute right-2 top-2 rounded-full bg-white/90 p-2 text-lg shadow hover:text-accent disabled:opacity-50"
      >
        ♥
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {p.brand && <span className="text-xs uppercase tracking-wide text-gray-400">{p.brand}</span>}
        <Link href={`/products/${p.id}`} className="line-clamp-2 text-sm font-medium hover:text-brand">{p.nameEn}</Link>
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-base font-bold text-brand">{aed(p.currentPrice)}</span>
          {discount > 0 && p.listPrice && (
            <>
              <span className="text-xs text-gray-400 line-through">{aed(p.listPrice)}</span>
              <span className="text-xs font-semibold text-accent">-{discount}%</span>
            </>
          )}
        </div>
        <StockPill stock={p.totalStock} />
      </div>
    </div>
  );
}