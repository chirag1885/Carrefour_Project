'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useInvalidate, useWishlistMembership, useWishlists } from '@/lib/hooks';
import { useToast } from './Toast';

export function AddToListsPanel({
  productId,
  withTarget = false,
  initialTarget = '',
  onDone,
}: {
  productId: string;
  withTarget?: boolean; // show the "alert me below" box
  initialTarget?: string; // price alert to carry over when copying an existing item
  onDone?: () => void;
}) {
  const { wishlists } = useWishlists();
  const { entriesFor } = useWishlistMembership();
  const invalidate = useInvalidate();
  const toast = useToast();
  const present = new Set(entriesFor(productId).map((e) => e.wishlistId));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(initialTarget);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function add() {
    const ids = [...picked];
    if (ids.length === 0) return toast('Choose at least one wishlist');
    const body: Record<string, unknown> = { productId };
    const t = target.trim();
    if (t) {
      const n = Number(t);
      if (Number.isNaN(n) || n < 0) return toast('Enter a valid price');
      body.targetPrice = n;
    }
    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => api(`/wishlists/${id}/items`, { method: 'POST', body })));
    const failed = results.filter((r) => r.status === 'rejected' && !(r.reason instanceof ApiError && r.reason.code === 'ALREADY_IN_WISHLIST')).length;
    toast(failed ? `Added to ${ids.length - failed} of ${ids.length} wishlists` : `Added to ${ids.length} wishlist${ids.length > 1 ? 's' : ''} ♥`);
    setPicked(new Set());
    await invalidate('/wishlists');
    setBusy(false);
    onDone?.();
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Save to wishlists</p>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
        {wishlists.map((w) => {
          const already = present.has(w.id);
          return (
            <li key={w.id}>
              <label className={`flex items-center gap-2 rounded px-1 py-1 ${already ? 'text-gray-400' : 'cursor-pointer hover:bg-gray-50'}`}>
                <input
                  type="checkbox"
                  checked={already || picked.has(w.id)}
                  disabled={already}
                  onChange={() => toggle(w.id)}
                  className="h-4 w-4 accent-[#004e9f]"
                />
                <span className="flex-1 truncate">{w.name}</span>
                {already && <span className="text-xs">✓ added</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {withTarget && (
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Alert me below… (AED, optional)"
          inputMode="decimal"
          className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
        />
      )}
      <button
        onClick={add}
        disabled={busy || picked.size === 0}
        className="mt-3 w-full rounded-full bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:bg-gray-200 disabled:text-gray-500"
      >
        {busy ? 'Adding…' : 'Add to selected lists'}
      </button>
    </div>
  );
}