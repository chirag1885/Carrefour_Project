'use client';

import Link from 'next/link';
import { ProductImage } from '@/components/ProductCard';
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

const SOURCE: Record<string, string> = { wishlist: 'From your wishlist', notification: 'From a price alert', direct: '' };

function CartView() {
  const { data: cart, error, mutate } = useCart();
  const toast = useToast();

  async function remove(productId: string) {
    try {
      const next = await api<Cart>(`/cart/items/${productId}`, { method: 'DELETE' });
      await mutate(next, { revalidate: false });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!cart) return <p className="text-gray-500">Loading…</p>;

  if (cart.items.length === 0) {
    return (
      <div className="rounded-xl bg-white p-10 text-center text-gray-500">
        Your cart is empty. <Link href="/wishlist" className="text-brand underline">Go to your wishlist</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-3">
        {cart.items.map((i) => {
          const diff = i.product.currentPrice - i.priceAtAdd;
          return (
            <div key={i.product.id} className="flex items-center gap-4 rounded-xl bg-white p-4 shadow-sm">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded bg-gray-50">
                <ProductImage src={i.product.imageUrl} alt={i.product.nameEn} className="h-full w-full object-contain" />
              </div>
              <div className="flex-1">
                <Link href={`/products/${i.product.id}`} className="font-medium hover:text-brand">{i.product.nameEn}</Link>
                <p className="text-sm text-gray-500">
                  Qty {i.quantity} · {aed(i.product.currentPrice)} each
                  {Math.abs(diff) >= 0.01 && (
                    <span className={diff < 0 ? ' text-green-600' : ' text-red-600'}>
                      {' '}({diff < 0 ? 'cheaper' : 'dearer'} by {aed(Math.abs(diff))} than when added)
                    </span>
                  )}
                </p>
                {SOURCE[i.source] && <span className="text-xs text-gray-400">{SOURCE[i.source]}</span>}
              </div>
              <button onClick={() => remove(i.product.id)} className="text-sm text-red-600 hover:underline">Remove</button>
            </div>
          );
        })}
      </div>

      <aside className="h-fit rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Order summary</h2>
        <div className="flex justify-between text-lg font-bold">
          <span>Subtotal</span>
          <span>{aed(cart.subtotal)}</span>
        </div>
        <button disabled className="mt-4 w-full rounded-lg bg-gray-300 py-2 text-white" title="Checkout is out of scope for this project">
          Checkout (demo)
        </button>
      </aside>
    </div>
  );
}