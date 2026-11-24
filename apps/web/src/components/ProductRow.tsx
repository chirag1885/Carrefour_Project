'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Page, Product } from '@/lib/types';
import { ProductCard } from './ProductCard';

/** A horizontally scrolling shelf. `query` is a product-name search word. Hides itself if nothing matches. */
export function ProductRow({ title, query = '' }: { title: string; query?: string }) {
  const { user } = useAuth();
  const extra = query ? `&query=${encodeURIComponent(query)}` : '';
  const { data } = useSWR<Page<Product>>(user ? `/products?limit=12${extra}` : null, fetcher);
  if (data && data.items.length === 0) return null;
  const href = query ? `/products?query=${encodeURIComponent(query)}` : '/products';

  return (
    <section className="mb-6 rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        <Link href={href} className="flex items-center text-sm font-medium text-brand hover:underline">
          See all <ChevronRight size={16} />
        </Link>
      </div>
      <div className="scrollbar-none -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-1">
        {!data
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-72 w-48 shrink-0 animate-pulse rounded-xl bg-gray-100" />)
          : data.items.map((p) => (
              <div key={p.id} className="w-48 shrink-0 snap-start">
                <ProductCard p={p} />
              </div>
            ))}
      </div>
    </section>
  );
}