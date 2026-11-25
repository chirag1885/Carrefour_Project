'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Heart, Tag, Truck } from 'lucide-react';
import useSWR from 'swr';
import { CartControl } from '@/components/CartControl';
import { Price } from '@/components/Price';
import { ProductImage, StockPill } from '@/components/ProductCard';
import { useToast } from '@/components/Toast';
import { ApiError, api, fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { aed } from '@/lib/format';
import { useInvalidate, useWishlists } from '@/lib/hooks';
import type { ProductDetails } from '@/lib/types';
import { PricePrediction } from '@/components/PricePrediction';
import { SimilarProducts } from '@/components/SimilarProducts';

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

  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!p) return <div className="h-96 animate-pulse rounded-2xl bg-white" />;

  const discount = p.listPrice && p.listPrice > p.currentPrice ? Math.round((1 - p.currentPrice / p.listPrice) * 100) : 0;
  const chosen = wlId || defaultWishlist?.id || '';
  const soldOut = p.totalStock <= 0;
  const attrs = Object.entries(p.attributes ?? {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object');

  async function addToWishlist() {
    if (!p || !chosen) return;
    try {
      const body: Record<string, unknown> = { productId: p.id };
      if (target.trim()) body.targetPrice = Number(target);
      await api(`/wishlists/${chosen}/items`, { method: 'POST', body });
      toast(target.trim() ? `Saved. We'll alert you at ${aed(Number(target))}` : 'Added to wishlist ♥');
      await invalidate('/wishlists');
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'ALREADY_IN_WISHLIST' ? 'Already in that wishlist' : (e as Error).message);
    }
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-gray-500">
        <Link href="/" className="hover:underline">Home</Link> › <Link href="/products" className="hover:underline">Products</Link>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_320px]">
        <div className="h-fit rounded-2xl bg-white p-4 shadow-sm lg:sticky lg:top-32">
          <ProductImage src={p.imageUrl} alt={p.nameEn} className="mx-auto max-h-[420px] w-full object-contain" />
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {p.brand && <p className="text-sm font-medium uppercase tracking-wide text-brand">{p.brand}</p>}
          <h1 className="text-2xl font-bold leading-snug">{p.nameEn}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {p.badges.map((b) => <span key={b} className="rounded bg-green-100 px-2 py-1 text-xs font-bold text-green-800">{b}</span>)}
            <StockPill stock={p.totalStock} />
          </div>

          <hr className="my-4" />
          <div className="flex flex-wrap items-baseline gap-3">
            {discount > 0 && <span className="text-2xl font-light text-deal">-{discount}%</span>}
            <Price value={p.currentPrice} size="lg" />
          </div>
          {discount > 0 && p.listPrice && <p className="mt-1 text-sm text-gray-500">Was: <span className="line-through">{aed(p.listPrice)}</span></p>}

          {p.offers.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-xl bg-brand-light p-3 text-sm text-brand-dark">
              {p.offers.map((o) => <li key={o.id} className="flex items-center gap-2"><Tag size={15} /> {o.label}</li>)}
            </ul>
          )}

          {p.descriptionEn && <p className="mt-4 text-sm leading-relaxed text-gray-700">{p.descriptionEn}</p>}

          {attrs.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <tbody>
                {attrs.map(([k, v]) => (
                  <tr key={k} className="border-t">
                    <td className="w-1/3 py-2 pr-3 font-medium capitalize text-gray-500">{k.replace(/_/g, ' ')}</td>
                    <td className="py-2">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* buy box */}
        <aside className="h-fit space-y-4 lg:sticky lg:top-32">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <Price value={p.currentPrice} size="lg" />
            <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-600"><Truck size={16} /> Free delivery over AED 100</p>
            <p className={`mt-2 text-lg font-semibold ${soldOut ? 'text-deal' : 'text-green-700'}`}>{soldOut ? 'Currently unavailable' : p.totalStock <= 5 ? `Only ${p.totalStock} left in stock` : 'In stock'}</p>
            <div className="mt-4">
              <CartControl product={p} showLink />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="mb-1 flex items-center gap-2 font-semibold"><Heart size={18} className="text-accent" /> Track this price</h2>
            <p className="mb-3 text-xs text-gray-500">Set a target and we&apos;ll alert you when it&apos;s reached.</p>
            <select value={chosen} onChange={(e) => setWlId(e.target.value)} className="mb-2 w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm">
              {wishlists.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Alert me below… (AED, optional)" inputMode="decimal" className="mb-3 w-full rounded-lg border px-3 py-2 text-sm" />
            <button onClick={addToWishlist} disabled={!chosen} className="w-full rounded-full border-2 border-accent py-2 font-semibold text-accent hover:bg-accent hover:text-white disabled:opacity-50">
              Add to wishlist
            </button>
          </div>
                    <PricePrediction productId={p.id} />
        </aside>
      </div>
            <SimilarProducts productId={p.id} />
    </div>
  );
}