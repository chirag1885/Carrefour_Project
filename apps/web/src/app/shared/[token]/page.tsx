'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Copy, ListPlus, Users } from 'lucide-react';
import useSWR from 'swr';
import { AddToListsPanel } from '@/components/AddToListsPanel';
import { Dropdown } from '@/components/Dropdown';
import { Price } from '@/components/Price';
import { ProductImage } from '@/components/ProductCard';
import { useToast } from '@/components/Toast';
import { ApiError, api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInvalidate } from '@/lib/hooks';
import type { SharedWishlist, Wishlist } from '@/lib/types';

export default function SharedWishlistPage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data, error } = useSWR<SharedWishlist>(`/shared/${token}`, fetcher);
  const [copying, setCopying] = useState(false);
  const [name, setName] = useState('');
  const [done, setDone] = useState<{ name: string; count: number } | null>(null);

  async function copyAll() {
    if (!data) return;
    setCopying(true);
    try {
      const body = name.trim() ? { name: name.trim() } : {};
      const w = await api<Wishlist & { itemCount: number }>(`/shared/${token}/copy`, { method: 'POST', body });
      setDone({ name: w.name, count: w.itemCount });
      toast(`Copied ${w.itemCount} items to "${w.name}"`);
      await invalidate('/wishlists');
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'WISHLIST_NAME_TAKEN' ? 'You already have a wishlist with that name. Choose another name.' : (e as Error).message);
    } finally {
      setCopying(false);
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
      <div className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light text-brand"><Users /></span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold">{data.name}</h1>
            <p className="text-sm text-gray-500">Shared wishlist · {data.items.length} item{data.items.length === 1 ? '' : 's'} · view only</p>
          </div>
        </div>

        <div className="mt-4 border-t pt-4">
          {done ? (
            <p className="text-sm text-green-700">
              ✓ Copied {done.count} items to your wishlist &ldquo;{done.name}&rdquo;.{' '}
              <Link href="/wishlist" className="font-semibold underline">Open my wishlists</Link>
            </p>
          ) : user ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Name for your copy (default: ${data.name})`}
                maxLength={100}
                className="w-full rounded-full border px-4 py-2 text-sm sm:w-80"
              />
              <button onClick={copyAll} disabled={copying || data.items.length === 0} className="flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
                <Copy size={15} /> {copying ? 'Copying…' : 'Copy whole wishlist'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              <Link href="/login" className="font-semibold text-brand underline">Sign in</Link> to copy this wishlist or add its items to your own.
            </p>
          )}
        </div>
      </div>

      {data.items.length === 0 && <p className="text-gray-500">This wishlist is empty.</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {data.items.map((it) => (
          <div key={it.id} className="flex flex-col rounded-xl bg-white p-3 ring-1 ring-gray-200">
            <Link href={user ? `/products/${it.product.id}` : '/login'} className="block aspect-square overflow-hidden rounded-lg bg-white">
              <ProductImage src={it.product.imageUrl} alt={it.product.nameEn} className="h-full w-full object-contain p-2" />
            </Link>
            <p className="mt-2 line-clamp-2 min-h-10 text-sm">{it.product.nameEn}</p>
            <Price value={it.product.currentPrice} className="mt-1 text-gray-900" />
            <div className="mt-auto pt-3">
              {user ? (
                <Dropdown
                  label="Add to my wishlists"
                  buttonClassName="flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm font-semibold text-brand ring-1 ring-brand hover:bg-brand-light"
                  panelClassName="w-72 p-4"
                  trigger={() => (
                    <>
                      <ListPlus size={15} /> Add to my wishlist
                    </>
                  )}
                >
                  {(close) => <AddToListsPanel productId={it.product.id} onDone={close} />}
                </Dropdown>
              ) : (
                <Link href="/login" className="block rounded-full border border-brand py-2 text-center text-sm font-semibold text-brand hover:bg-brand-light">Sign in to add</Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}