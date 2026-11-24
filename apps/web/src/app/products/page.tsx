'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import useSWRInfinite from 'swr/infinite';
import { ProductCard } from '@/components/ProductCard';
import { fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import type { Page, Product } from '@/lib/types';

export default function ProductsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="text-gray-500">Loading…</p>}>
        <Browse />
      </Suspense>
    </RequireAuth>
  );
}

function Browse() {
  const sp = useSearchParams();
  const q = sp.get('query') ?? '';

  const { data, error, size, setSize, isValidating } = useSWRInfinite<Page<Product>>(
    (i, prev) => {
      if (prev && !prev.nextCursor) return null;
      const p = new URLSearchParams({ limit: '24' });
      if (q) p.set('query', q);
      if (i > 0 && prev?.nextCursor) p.set('cursor', prev.nextCursor);
      return `/products?${p}`;
    },
    fetcher,
  );

  const products = data?.flatMap((d) => d.items) ?? [];
  const hasMore = !!data && !!data[data.length - 1].nextCursor;
  const loadingMore = isValidating && size > (data?.length ?? 0);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">{q ? `Results for “${q}”` : 'Electronics'}</h1>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          {data && <span>{products.length}{hasMore ? '+' : ''} items</span>}
          {q && <Link href="/products" className="font-medium text-accent hover:underline">Clear search</Link>}
        </div>
      </div>

      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {data && products.length === 0 && (
        <div className="rounded-2xl bg-white p-10 text-center text-gray-500">
          <p className="mb-1 text-3xl">🔍</p>
          No products found. Try another search or <Link href="/products" className="text-brand underline">see everything</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {!data && !error && Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-80 animate-pulse rounded-xl bg-white" />)}
        {products.map((p) => <ProductCard key={p.id} p={p} />)}
      </div>

      {hasMore && (
        <div className="mt-6 text-center">
          <button onClick={() => setSize(size + 1)} disabled={loadingMore} className="rounded-full bg-brand px-8 py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </section>
  );
}