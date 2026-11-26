'use client';

import Link from 'next/link';
import { PLACEHOLDER_IMG } from '@/lib/format';
import type { Product } from '@/lib/types';
import { CartControl } from './CartControl';
import { HeartButton } from './HeartButton';
import { Price } from './Price';

export function StockPill({ stock }: { stock: number }) {
  if (stock <= 0) return <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">Out of stock</span>;
  if (stock <= 5) return <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">Only {stock} left</span>;
  return null;
}

export function ProductImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  // plain <img>: dataset images come from many different hosts
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src || PLACEHOLDER_IMG} alt={alt} className={className} loading="lazy" onError={(e) => { e.currentTarget.src = PLACEHOLDER_IMG; }} />;
}

export function ProductCard({ p }: { p: Product }) {
  const discount = p.listPrice && p.listPrice > p.currentPrice ? Math.round((1 - p.currentPrice / p.listPrice) * 100) : 0;

  return (
    <div className="group relative flex h-full flex-col rounded-xl bg-white p-3 ring-1 ring-gray-200 transition hover:shadow-lg">
      {discount > 0 && <span className="absolute start-3 top-3 z-10 rounded bg-deal px-2 py-0.5 text-xs font-bold text-white">-{discount}%</span>}
      <div className="absolute end-3 top-3 z-10">
        <HeartButton productId={p.id} />
      </div>

      <Link href={`/products/${p.id}`} className="block aspect-square overflow-hidden rounded-lg bg-white">
        <ProductImage src={p.imageUrl} alt={p.nameEn} className="h-full w-full object-contain p-2 transition group-hover:scale-105" />
      </Link>

      <div className="mt-2 flex flex-1 flex-col">
        {p.brand && <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{p.brand}</span>}
        <Link href={`/products/${p.id}`} className="line-clamp-2 min-h-10 text-sm leading-5 text-gray-800 hover:text-brand">{p.nameEn}</Link>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <Price value={p.currentPrice} className="text-gray-900" />
          {discount > 0 && p.listPrice && <span className="text-xs text-gray-400 line-through">AED {p.listPrice.toFixed(2)}</span>}
        </div>
        <div className="mt-1 min-h-5"><StockPill stock={p.totalStock} /></div>

        <div className="mt-auto pt-3">
          <CartControl product={p} />
        </div>
      </div>
    </div>
  );
}