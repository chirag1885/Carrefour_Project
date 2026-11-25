'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Product } from '@/lib/types';
import { ProductCard } from './ProductCard';

export function SimilarProducts({ productId }: { productId: string }) {
  const t = useT();
  const { data } = useSWR<Product[]>(`/products/${productId}/similar`, fetcher);
  if (!data || data.length === 0) return null;

  return (
    <section className="mt-8 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-bold">{t('similar.title')}</h2>
      <div className="scrollbar-none -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-1">
        {data.map((p) => (
          <div key={p.id} className="w-48 shrink-0 snap-start">
            <ProductCard p={p} />
          </div>
        ))}
      </div>
    </section>
  );
}