'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Price } from '@/components/Price';
import { ProductImage } from '@/components/ProductCard';
import { QuantityStepper } from '@/components/QuantityStepper';
import { useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { aed } from '@/lib/format';
import { useCart } from '@/lib/hooks';
import type { Cart } from '@/lib/types';

export default function CartPage() {
  return (
    <RequireAuth>
      <CartView />
    </RequireAuth>
  );
}

const SOURCE: Record<string, string> = { wishlist: 'Moved from your wishlist', notification: 'Added from a price alert', direct: '' };

function CartView() {
  const { data: cart, error, mutate } = useCart();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function change(productId: string, run: () => Promise<Cart>) {
    setBusyId(productId);
    try {
      await mutate(await run(), { revalidate: false });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }
  const setQty = (id: string, quantity: number) => change(id, () => api<Cart>(`/cart/items/${id}`, { method: 'PATCH', body: { quantity } }));
  const remove = (id: string) => change(id, () => api<Cart>(`/cart/items/${id}`, { method: 'DELETE' }));

  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!cart) return <div className="h-64 animate-pulse rounded-2xl bg-white" />;

  if (cart.items.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-12 text-center shadow-sm">
        <p className="mb-2 text-5xl">🛒</p>
        <h1 className="text-xl font-bold">Your cart is empty</h1>
        <p className="mt-1 text-gray-500">Looks like you haven&apos;t added anything yet.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Link href="/products" className="rounded-full bg-brand px-6 py-2.5 font-semibold text-white hover:bg-brand-dark">Continue shopping</Link>
          <Link href="/wishlist" className="rounded-full px-6 py-2.5 font-semibold text-brand ring-1 ring-brand hover:bg-brand-light">View wishlist</Link>
        </div>
      </div>
    );
  }

  const units = cart.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between border-b pb-3">
          <h1 className="text-xl font-bold">Shopping cart</h1>
          <span className="text-sm text-gray-500">Price</span>
        </div>

        <ul className="divide-y">
          {cart.items.map((i) => {
            const p = i.product;
            const diff = p.currentPrice - i.priceAtAdd;
            const busy = busyId === p.id;
            return (
              <li key={p.id} className={`flex gap-4 py-5 ${busy ? 'opacity-60' : ''}`}>
                <Link href={`/products/${p.id}`} className="h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-gray-50">
                  <ProductImage src={p.imageUrl} alt={p.nameEn} className="h-full w-full object-contain" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${p.id}`} className="line-clamp-2 font-medium hover:text-brand">{p.nameEn}</Link>
                  <p className={`mt-1 text-sm font-medium ${p.totalStock > 0 ? 'text-green-700' : 'text-deal'}`}>{p.totalStock > 0 ? (p.totalStock <= 5 ? `Only ${p.totalStock} left in stock` : 'In stock') : 'Currently unavailable'}</p>
                  {Math.abs(diff) >= 0.01 && (
                    <p className={`text-xs font-medium ${diff < 0 ? 'text-green-600' : 'text-red-600'}`}>
                      Price {diff < 0 ? 'dropped' : 'rose'} by {aed(Math.abs(diff))} since you added it
                    </p>
                  )}
                  {SOURCE[i.source] && <p className="text-xs text-gray-400">{SOURCE[i.source]}</p>}

                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <QuantityStepper value={i.quantity} max={Math.max(p.totalStock, i.quantity)} busy={busy} onChange={(n) => setQty(p.id, n)} />
                    <button onClick={() => remove(p.id)} disabled={busy} className="flex items-center gap-1 text-sm text-brand hover:underline">
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <Price value={p.currentPrice * i.quantity} />
                  {i.quantity > 1 && <p className="text-xs text-gray-400">{aed(p.currentPrice)} each</p>}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="border-t pt-3 text-right text-lg">
          Subtotal ({units} {units === 1 ? 'item' : 'items'}): <Price value={cart.subtotal} />
        </p>
      </section>

      <aside className="rounded-2xl bg-white p-5 shadow-sm lg:sticky lg:top-40">
        <p className="mb-1 text-sm text-green-700">{cart.subtotal >= 100 ? '✓ Your order qualifies for free delivery' : `Add ${aed(100 - cart.subtotal)} more for free delivery`}</p>
        <p className="text-lg">Subtotal ({units} {units === 1 ? 'item' : 'items'}): <Price value={cart.subtotal} /></p>
        <button disabled title="Checkout is out of scope for this project" className="mt-4 w-full rounded-full bg-gray-200 py-3 font-semibold text-gray-500">
          Proceed to checkout (demo)
        </button>
        <Link href="/products" className="mt-3 block text-center text-sm text-brand hover:underline">Continue shopping</Link>
      </aside>
    </div>
  );
}