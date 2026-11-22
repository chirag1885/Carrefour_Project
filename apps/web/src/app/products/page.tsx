'use client';

import { useEffect, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { ProductCard } from '@/components/ProductCard';
import { fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import type { Page, Product } from '@/lib/types';

const CATEGORIES = ['Electronics', 'Grocery', 'Home & Kitchen', 'Fashion', 'Beauty & Personal Care', 'Baby & Kids', 'Toys & Games', 'Health & Wellness'];

export default function ProductsPage() {
  return (
    <RequireAuth>
      <Browse />
    </RequireAuth>
  );
}

function Browse() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300); // debounce typing
    return () => clearTimeout(t);
  }, [input]);

  const { data, error, size, setSize, isValidating } = useSWRInfinite<Page<Product>>(
    (i, prev) => {
      if (prev && !prev.nextCursor) return null; // last page reached
      const p = new URLSearchParams({ limit: '24' });
      if (q) p.set('query', q);
      if (category) p.set('category', category);
      if (i > 0 && prev?.nextCursor) p.set('cursor', prev.nextCursor);
      return `/products?${p}`;
    },
    fetcher,
    { revalidateFirstPage: false },
  );

  const products = data?.flatMap((d) => d.items) ?? [];
  const hasMore = !!data && !!data[data.length - 1].nextCursor;
  const loadingMore = isValidating && size > (data?.length ?? 0);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search products…"
          className="w-full rounded-lg border bg-white px-4 py-2 sm:max-w-sm"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border bg-white px-3 py-2">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {!data && !error && <p className="text-gray-500">Loading…</p>}
      {data && products.length === 0 && <p className="text-gray-500">No products found.</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} p={p} />
        ))}
      </div>

      {hasMore && (
        <div className="mt-6 text-center">
          <button onClick={() => setSize(size + 1)} disabled={loadingMore} className="rounded-lg bg-brand px-5 py-2 text-white hover:bg-brand-dark disabled:opacity-60">
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}