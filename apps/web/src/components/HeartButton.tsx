'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { api } from '@/lib/api';
import { useInvalidate, useWishlistMembership, useWishlists } from '@/lib/hooks';
import { useToast } from './Toast';

/** Pink and filled when the product is in any of your wishlists. Click toggles it. */
export function HeartButton({ productId }: { productId: string }) {
  const { defaultWishlist } = useWishlists();
  const { entriesFor } = useWishlistMembership();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const entries = entriesFor(productId);
  const filled = entries.length > 0;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (filled) {
        await Promise.all(entries.map((e) => api(`/wishlists/${e.wishlistId}/items/${e.itemId}`, { method: 'DELETE' })));
        toast('Item removed from wishlist');
      } else if (defaultWishlist) {
        await api(`/wishlists/${defaultWishlist.id}/items`, { method: 'POST', body: { productId } });
        toast('Added to your wishlist ♥');
      }
      await invalidate('/wishlists');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={filled ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-label={filled ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={filled}
      className="rounded-full bg-white p-2 text-gray-500 shadow ring-1 ring-gray-100 hover:text-pink-500 disabled:opacity-60"
    >
      <Heart size={18} className={filled ? 'fill-pink-500 text-pink-500' : ''} />
    </button>
  );
}