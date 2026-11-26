'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Heart, ListPlus, Pencil, Share2, ShoppingCart, Target, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { AddToListsPanel } from '@/components/AddToListsPanel';
import { Dropdown } from '@/components/Dropdown';
import { Price } from '@/components/Price';
import { ProductImage, StockPill } from '@/components/ProductCard';
import { useToast } from '@/components/Toast';
import { ApiError, api, fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { aed, pct } from '@/lib/format';
import { useInvalidate, useWishlists } from '@/lib/hooks';
import type { MoveResult, Page, Share, Trends, WishlistItem } from '@/lib/types';

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

  const { data: trends, mutate: mutateTrends } = useSWR<Trends>(current ? `/wishlists/${current.id}/trends` : null, fetcher);
  const { data, error, size, setSize, isValidating, mutate: mutateItems } = useSWRInfinite<Page<WishlistItem>>(
    (i, prev) => {
      if (!current || (prev && !prev.nextCursor)) return null;
      const p = new URLSearchParams({ limit: '20' });
      if (i > 0 && prev?.nextCursor) p.set('cursor', prev.nextCursor);
      return `/wishlists/${current.id}/items?${p}`;
    },
    fetcher,
    { revalidateAll: true },
  );
  const items = data?.flatMap((d) => d.items) ?? [];
  const hasMore = !!data && !!data[data.length - 1].nextCursor;

  /** Re-fetch everything this page shows. Called after every change so nothing needs a manual reload. */
  const refresh = async () => {
    await Promise.all([mutateItems(), mutateTrends(), invalidate('/cart', '/wishlists/membership')]);
  };

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
      await refresh();
    });

  const shareList = () =>
    run(async () => {
      if (!current) return;
      const s = await api<Share>(`/wishlists/${current.id}/share`, { method: 'POST', body: { permission: 'view' } });
      const url = `${window.location.origin}/shared/${s.token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('Share link copied. Anyone with it can view and copy this list.');
      } catch {
        window.prompt('Copy this link', url);
      }
    });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Heart className="fill-pink-500 text-pink-500" /> Your wishlists</h1>
          <p className="text-sm text-gray-500">Track prices and get alerted when they drop.</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void createList(); }} className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New wishlist (e.g. Ramadan)" maxLength={100} className="w-56 rounded-full border bg-white px-4 py-2 text-sm" />
          <button className="rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">Create</button>
        </form>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {wishlists.map((w) => (
          <button key={w.id} onClick={() => setSelected(w.id)} className={`rounded-full px-4 py-2 text-sm font-semibold ${w.id === current?.id ? 'bg-brand text-white shadow' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {w.name}
          </button>
        ))}
      </div>

      {current && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={<Heart size={18} />} label="Items" value={`${items.length}${hasMore ? '+' : ''}`} />
            <Stat icon={<Wallet size={18} />} label="Total now" value={trends ? aed(trends.currentTotal) : '…'} />
            <Stat icon={<Wallet size={18} />} label="Total when added" value={trends ? aed(trends.addedTotal) : '…'} />
            <Stat icon={<TrendingDown size={18} />} label="You save" value={trends ? aed(Math.max(trends.savings, 0)) : '…'} good={!!trends && trends.savings > 0} />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={moveAll} disabled={items.length === 0} className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              <ShoppingCart size={16} /> Move all in-stock to cart
            </button>
            <button onClick={shareList} className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm ring-1 ring-gray-200 hover:bg-gray-50"><Share2 size={14} /> Share list</button>
            <button onClick={renameList} className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm ring-1 ring-gray-200 hover:bg-gray-50"><Pencil size={14} /> Rename</button>
            {!current.isDefault && (
              <button onClick={deleteList} className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm text-red-600 ring-1 ring-gray-200 hover:bg-red-50"><Trash2 size={14} /> Delete list</button>
            )}
          </div>
        </>
      )}

      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {data && items.length === 0 && (
        <div className="rounded-2xl bg-white p-12 text-center text-gray-500 shadow-sm">
          <p className="mb-2 text-5xl">💙</p>
          Nothing here yet. <Link href="/products" className="text-brand underline">Browse products</Link> and tap ♥ to start tracking prices.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {items.map((it) => <ItemRow key={it.id} item={it} listId={current!.id} run={run} refresh={refresh} />)}
      </div>

      {hasMore && (
        <div className="mt-5 text-center">
          <button onClick={() => setSize(size + 1)} disabled={isValidating} className="rounded-full bg-brand px-8 py-2.5 font-semibold text-white disabled:opacity-60">
            {isValidating ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, good }: { icon: React.ReactNode; label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${good ? 'bg-green-100 text-green-700' : 'bg-brand-light text-brand'}`}>{icon}</span>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
        <p className={`text-lg font-bold ${good ? 'text-green-600' : ''}`}>{value}</p>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  listId,
  run,
  refresh,
}: {
  item: WishlistItem;
  listId: string;
  run: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const toast = useToast();
  const p = item.product;
  const [target, setTarget] = useState(item.targetPrice?.toString() ?? '');

  const diff = p.currentPrice - item.addedPrice;
  const change = pct(item.addedPrice, p.currentPrice);
  const unavailable = p.totalStock <= 0;
  const reached = item.targetPrice !== null && p.currentPrice <= item.targetPrice;

  const saveTarget = () =>
    run(async () => {
      const t = target.trim();
      const n = t === '' ? null : Number(t);
      if (n !== null && (Number.isNaN(n) || n < 0)) return toast('Enter a valid price');
      await api(`/wishlists/${listId}/items/${item.id}`, { method: 'PATCH', body: { targetPrice: n } });
      toast(n === null ? 'Target removed' : `Alert set at ${aed(n)}`);
      await refresh();
    });

  const toCart = () =>
    run(async () => {
      await api(`/wishlists/${listId}/items/${item.id}/move-to-cart`, { method: 'POST', body: {} });
      toast('Moved to cart');
      await refresh();
    });

  const remove = () =>
    run(async () => {
      await api(`/wishlists/${listId}/items/${item.id}`, { method: 'DELETE' });
      toast('Item removed from wishlist');
      await refresh();
    });

  return (
    <div className={`flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm sm:flex-row ${reached ? 'ring-2 ring-amber-300' : ''}`}>
      <Link href={`/products/${p.id}`} className="h-32 w-32 shrink-0 self-center overflow-hidden rounded-xl bg-gray-50">
        <ProductImage src={p.imageUrl} alt={p.nameEn} className="h-full w-full object-contain" />
      </Link>

      <div className="min-w-0 flex-1">
        {p.brand && <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{p.brand}</p>}
        <Link href={`/products/${p.id}`} className="line-clamp-2 font-medium hover:text-brand">{p.nameEn}</Link>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Price value={p.currentPrice} size="md" className="text-brand" />
          {Math.abs(diff) >= 0.01 ? (
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${diff < 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {diff < 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />} {aed(Math.abs(diff))} ({Math.abs(change).toFixed(1)}%)
            </span>
          ) : (
            <span className="text-xs text-gray-400">unchanged since added ({aed(item.addedPrice)})</span>
          )}
          <StockPill stock={p.totalStock} />
          {item.badges.map((b) => <span key={b} className="rounded bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">{b}</span>)}
          {reached && <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800"><Target size={12} /> Target reached</span>}
        </div>
        {Math.abs(diff) >= 0.01 && <p className="mt-1 text-xs text-gray-400">Added at {aed(item.addedPrice)}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="text-gray-500">Alert me below</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="AED" inputMode="decimal" className="w-28 rounded-lg border px-3 py-1.5" />
          <button onClick={saveTarget} className="rounded-lg bg-gray-100 px-3 py-1.5 font-medium hover:bg-gray-200">Save</button>
        </div>
      </div>

      <div className="flex gap-2 self-center sm:w-44 sm:flex-col">
        <button onClick={toCart} disabled={unavailable} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:bg-gray-200 disabled:text-gray-500">
          <ShoppingCart size={15} /> {unavailable ? 'Unavailable' : 'Move to cart'}
        </button>
        <Dropdown
          label="Add to other wishlists"
          buttonClassName="flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-brand ring-1 ring-brand hover:bg-brand-light"
          panelClassName="w-72 p-4"
          trigger={() => (
            <>
              <ListPlus size={15} /> Add to lists
            </>
          )}
        >
          {(close) => <AddToListsPanel productId={p.id} initialTarget={item.targetPrice?.toString() ?? ''} onDone={close} />}
        </Dropdown>
        <button onClick={remove} className="flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-red-600 ring-1 ring-gray-200 hover:bg-red-50">
          <Trash2 size={15} /> Remove
        </button>
      </div>
    </div>
  );
}