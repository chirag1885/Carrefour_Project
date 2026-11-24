'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useCart } from '@/lib/hooks';
import type { Cart, Product } from '@/lib/types';
import { useToast } from './Toast';

export function CartControl({ product: p, showLink = false }: { product: Product; showLink?: boolean }) {
  const { data: cart, mutate } = useCart();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const qty = cart?.items.find((i) => i.product.id === p.id)?.quantity ?? 0;
  const soldOut = p.totalStock <= 0;

  async function run(fn: () => Promise<Cart>) {
    setBusy(true);
    try {
      await mutate(await fn(), { revalidate: false });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const add = () => run(() => api<Cart>('/cart/items', { method: 'POST', body: { productId: p.id, quantity: 1 } }));
  const setQty = (n: number) => run(() => api<Cart>(`/cart/items/${p.id}`, { method: 'PATCH', body: { quantity: n } }));
  const remove = () => run(() => api<Cart>(`/cart/items/${p.id}`, { method: 'DELETE' }));

  if (qty === 0) {
    return (
      <button
        onClick={add}
        disabled={soldOut || busy}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:bg-gray-200 disabled:text-gray-500"
      >
        <ShoppingCart size={16} /> {soldOut ? 'Out of stock' : busy ? 'Adding…' : 'Add to cart'}
      </button>
    );
  }

  const btn = 'flex h-10 w-12 items-center justify-center hover:bg-white/15 disabled:opacity-40';
  return (
    <div>
      <div className="flex items-center justify-between overflow-hidden rounded-full bg-brand text-white">
        <button
          onClick={qty === 1 ? remove : () => setQty(qty - 1)}
          disabled={busy}
          className={btn}
          aria-label={qty === 1 ? 'Remove from cart' : 'Decrease quantity'}
        >
          {qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}
        </button>
        <span className="text-sm font-semibold tabular-nums">{qty} in cart</span>
        <button
          onClick={() => setQty(qty + 1)}
          disabled={busy || qty >= p.totalStock}
          title={qty >= p.totalStock ? 'No more stock available' : undefined}
          className={btn}
          aria-label="Increase quantity"
        >
          <Plus size={16} />
        </button>
      </div>
      {showLink && (
        <Link href="/cart" className="mt-2 block text-center text-sm text-brand hover:underline">
          Go to cart
        </Link>
      )}
    </div>
  );
}