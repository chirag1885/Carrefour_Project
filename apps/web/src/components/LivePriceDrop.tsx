'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TrendingDown } from 'lucide-react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { aed, timeAgo } from '@/lib/format';
import { useLatestNotifications, useWishlists } from '@/lib/hooks';
import { priceInfo } from '@/lib/notifications';
import type { Page, Product, WishlistItem } from '@/lib/types';
import { ProductImage } from './ProductCard';

const shell = 'ms-auto block w-full max-w-sm rounded-2xl bg-white p-4 text-gray-900 shadow-2xl';

function CardHeader({ live, label }: { live: boolean; label: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-green-700">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100">
          <TrendingDown size={15} />
        </span>
        {label}
      </div>
      {live && (
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-red-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
          </span>
          Live
        </span>
      )}
    </div>
  );
}

function Row({ product, oldPrice, newPrice, pct }: { product: Product; oldPrice: number | null; newPrice: number; pct: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-50">
        <ProductImage src={product.imageUrl} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-medium">{product.nameEn}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          {oldPrice !== null && <span className="text-gray-400 line-through">{aed(oldPrice)}</span>}
          <span className="text-lg font-extrabold text-brand">{aed(newPrice)}</span>
          {pct !== null && pct > 0 && <span className="rounded bg-deal px-1.5 py-0.5 text-xs font-bold text-white">-{pct.toFixed(1)}%</span>}
        </p>
      </div>
    </div>
  );
}

function Example({ signedIn }: { signedIn: boolean }) {
  return (
    <div className={shell}>
      <CardHeader live={false} label="Price drop on your wishlist" />
      <p className="text-sm font-medium">Gaming Laptop 15&quot;</p>
      <p className="mt-1 text-sm">
        <span className="text-gray-400 line-through">AED 3,000</span> <span className="text-lg font-extrabold text-brand">AED 2,500</span>{' '}
        <span className="ms-1 rounded bg-deal px-1.5 py-0.5 text-xs font-bold text-white">-16.7%</span>
      </p>
      <p className="mt-2 text-xs text-gray-400">
        Example. {signedIn ? 'Add items to a wishlist to see your real price drops here.' : 'Sign in to see your own price drops live.'}
      </p>
    </div>
  );
}

export function LivePriceDrop() {
  const { user } = useAuth();
  const { defaultWishlist } = useWishlists();
  const { data: feed } = useLatestNotifications(8); // same request as the bell: shared, polled every 5 s
  const { data: items } = useSWR<Page<WishlistItem>>(
    defaultWishlist ? `/wishlists/${defaultWishlist.id}/items?limit=20` : null,
    fetcher,
    { refreshInterval: 10000 },
  );

  // re-render every 30 s so "2 min ago" stays correct
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!user) return <Example signedIn={false} />;

  const alert = feed?.items.find((n) => (n.type === 'PRICE_DROP' || n.type === 'TARGET_REACHED') && n.product);
  if (alert && alert.product) {
    const { oldPrice, newPrice, dropPct } = priceInfo(alert);
    return (
      <Link key={alert.id} href={`/products/${alert.product.id}`} className={`${shell} animate-pop hover:shadow-[0_20px_50px_rgba(0,0,0,0.3)]`}>
        <CardHeader live label={alert.type === 'TARGET_REACHED' ? 'Your target price was reached' : 'Price drop on your wishlist'} />
        <Row product={alert.product} oldPrice={oldPrice} newPrice={newPrice ?? alert.product.currentPrice} pct={dropPct} />
        <p className="mt-2 text-xs text-gray-400">{timeAgo(alert.createdAt)}</p>
      </Link>
    );
  }

  const best = (items?.items ?? [])
    .filter((i) => i.addedPrice > i.product.currentPrice)
    .sort((a, b) => (b.addedPrice - b.product.currentPrice) / b.addedPrice - (a.addedPrice - a.product.currentPrice) / a.addedPrice)[0];
  if (best) {
    const pct = ((best.addedPrice - best.product.currentPrice) / best.addedPrice) * 100;
    return (
      <Link key={`${best.id}-${best.product.currentPrice}`} href={`/products/${best.product.id}`} className={`${shell} animate-pop hover:shadow-[0_20px_50px_rgba(0,0,0,0.3)]`}>
        <CardHeader live label="Biggest drop on your wishlist" />
        <Row product={best.product} oldPrice={best.addedPrice} newPrice={best.product.currentPrice} pct={pct} />
        <p className="mt-2 text-xs text-gray-400">Down since you added it</p>
      </Link>
    );
  }

  return <Example signedIn />;
}