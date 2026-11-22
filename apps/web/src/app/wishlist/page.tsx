'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { ProductImage, StockPill } from '@/components/ProductCard';
import { useToast } from '@/components/Toast';
import { ApiError, api, fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { aed, pct } from '@/lib/format';
import { useInvalidate, useWishlists } from '@/lib/hooks';
import type { MoveResult, Page, Trends, WishlistItem } from '@/lib/types';

export default function WishlistPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}

function Dashboard() {
  const { wishlists } = useWishlists();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const current = wishlists.find((w) => w.id === selected) ?? wishlists[0];

  const { data: trends } = useSWR<Trends>(current ? `/wishlists/${current.id}/trends` : null, fetcher);
  const { data, error, size, setSize, isValidating } = useSWRInfinite<Page<WishlistItem>>(
    (i, prev) => {
      if (!current || (prev && !prev.nextCursor)) return null;
      const p = new URLSearchParams({ limit: '20' });
      if (i > 0 && prev?.nextCursor) p.set('cursor', prev.nextCursor);
      return `/wishlists/${current.id}/items?${p}`;
    },
    fetcher,
    { revalidateFirstPage: false },
  );
  const items = data?.flatMap((d) => d.items) ?? [];
  const hasMore = !!data && !!data[data.length - 1].nextCursor;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  };

  const createList = () =>
    run(async () => {
      if (!newName.trim()) return;
      const w = await api<{ id: string }>('/wishlists', { method: 'POST', body: { name: newName.trim() } });
      setNewName('');
      setSelected(w.id);
      await invalidate('/wishlists');
    });

  const renameList = () =>
    run(async () => {
      if (!current) return;
      const name = window.prompt('New name', current.name)?.trim();
      if (!name || name === current.name) return;
      await api(`/wishlists/${current.id}`, { method: 'PATCH', body: { name } });
      await invalidate('/wishlists');
    });

  const deleteList = () =>
    run(async () => {
      if (!current || current.isDefault || !window.confirm(`Delete "${current.name}" and its items?`)) return;
      await api(`/wishlists/${current.id}`, { method: 'DELETE' });
      setSelected(null);
      await invalidate('/wishlists');
    });

  const moveAll = () =>
    run(async () => {
      if (!current) return;
      const r = await api<MoveResult>(`/wishlists/${current.id}/move-all-to-cart`, { method: 'POST' });
      toast(`Moved ${r.movedItemIds.length} to cart${r.skippedItemIds.length ? `, ${r.skippedItemIds.length} out of stock` : ''}`);
      await invalidate('/wishlists', '/cart');
    });

  return (
    <div>
      {/* tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {wishlists.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelected(w.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${w.id === current?.id ? 'bg-brand text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`}
          >
            {w.name}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createList();
          }}
          className="ml-auto flex gap-2"
        >
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New wishlist…" maxLength={100} className="rounded border bg-white px-3 py-1.5 text-sm" />
          <button className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white">Create</button>
        </form>
      </div>

      {current && (
        <>
          {/* summary */}
          <div className="mb-5 grid gap-3 rounded-xl bg-white p-4 shadow-sm sm:grid-cols-4">
            <Stat label="Items" value={String(items.length) + (hasMore ? '+' : '')} />
            <Stat label="Total now" value={trends ? aed(trends.currentTotal) : '…'} />
            <Stat label="Total when added" value={trends ? aed(trends.addedTotal) : '…'} />
            <Stat
              label="You save"
              value={trends ? aed(Math.max(trends.savings, 0)) : '…'}
              tone={trends && trends.savings > 0 ? 'good' : undefined}
            />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={moveAll} disabled={items.length === 0} className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              Move all in-stock to cart
            </button>
            <button onClick={renameList} className="rounded bg-white px-3 py-2 text-sm ring-1 ring-gray-200 hover:bg-gray-50">Rename</button>
            {!current.isDefault && (
              <button onClick={deleteList} className="rounded bg-white px-3 py-2 text-sm text-red-600 ring-1 ring-gray-200 hover:bg-red-50">Delete list</button>
            )}
          </div>
        </>
      )}

      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {data && items.length === 0 && (
        <div className="rounded-xl bg-white p-10 text-center text-gray-500">
          Nothing here yet. <Link href="/products" className="text-brand underline">Browse products</Link> and tap ♥ to start tracking prices.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {items.map((it) => (
          <ItemRow key={it.id} item={it} listId={current!.id} run={run} />
        ))}
      </div>

      {hasMore && (
        <div className="mt-5 text-center">
          <button onClick={() => setSize(size + 1)} disabled={isValidating} className="rounded-lg bg-brand px-5 py-2 text-white disabled:opacity-60">
            {isValidating ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${tone === 'good' ? 'text-green-600' : ''}`}>{value}</p>
    </div>
  );
}

function ItemRow({ item, listId, run }: { item: WishlistItem; listId: string; run: (fn: () => Promise<void>) => Promise<void> }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const p = item.product;
  const [target, setTarget] = useState(item.targetPrice?.toString() ?? '');

  const change = pct(item.addedPrice, p.currentPrice);
  const diff = p.currentPrice - item.addedPrice;
  const unavailable = p.totalStock <= 0;

  const saveTarget = () =>
    run(async () => {
      const t = target.trim();
      const n = t === '' ? null : Number(t);
      if (n !== null && (Number.isNaN(n) || n < 0)) return toast('Enter a valid price');
      await api(`/wishlists/${listId}/items/${item.id}`, { method: 'PATCH', body: { targetPrice: n } });
      toast(n === null ? 'Target removed' : `Alert set at ${aed(n)}`);
      await invalidate('/wishlists');
    });

  const toCart = () =>
    run(async () => {
      await api(`/wishlists/${listId}/items/${item.id}/move-to-cart`, { method: 'POST', body: {} });
      toast('Moved to cart');
      await invalidate('/wishlists', '/cart');
    });

  const remove = () =>
    run(async () => {
      await api(`/wishlists/${listId}/items/${item.id}`, { method: 'DELETE' });
      await invalidate('/wishlists');
    });

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm sm:flex-row">
      <Link href={`/products/${p.id}`} className="h-28 w-28 shrink-0 self-center overflow-hidden rounded-lg bg-gray-50">
        <ProductImage src={p.imageUrl} alt={p.nameEn} className="h-full w-full object-contain" />
      </Link>

      <div className="flex-1">
        <Link href={`/products/${p.id}`} className="font-medium hover:text-brand">{p.nameEn}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-brand">{aed(p.currentPrice)}</span>
          {Math.abs(diff) >= 0.01 ? (
            <span className={`text-sm font-semibold ${diff < 0 ? 'text-green-600' : 'text-red-600'}`}>
              {diff < 0 ? '↓' : '↑'} {aed(Math.abs(diff))} ({Math.abs(change).toFixed(1)}%) since added
            </span>
          ) : (
            <span className="text-sm text-gray-400">same as when added ({aed(item.addedPrice)})</span>
          )}
          <StockPill stock={p.totalStock} />
          {item.badges.map((b) => (
            <span key={b} className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">{b}</span>
          ))}
          {item.targetPrice !== null && p.currentPrice <= item.targetPrice && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Target reached 🎯</span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm">
          <label className="text-gray-500">Alert me below</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="AED" inputMode="decimal" className="w-28 rounded border px-2 py-1" />
          <button onClick={saveTarget} className="rounded bg-gray-100 px-3 py-1 hover:bg-gray-200">Save</button>
        </div>
      </div>

      <div className="flex gap-2 self-center sm:flex-col">
        <button onClick={toCart} disabled={unavailable} className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:bg-gray-300">
          {unavailable ? 'Unavailable' : 'Move to cart'}
        </button>
        <button onClick={remove} className="rounded px-4 py-2 text-sm text-red-600 ring-1 ring-gray-200 hover:bg-red-50">Remove</button>
      </div>
    </div>
  );
}