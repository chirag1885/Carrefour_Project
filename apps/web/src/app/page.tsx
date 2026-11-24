'use client';

import Link from 'next/link';
import { BellRing, Heart, TrendingDown } from 'lucide-react';
import { ProductRow } from '@/components/ProductRow';
import { useAuth } from '@/lib/auth';

const SHELVES = [
  { title: 'Featured electronics', query: '' },
  { title: 'Laptops', query: 'laptop' },
  { title: 'Headphones & audio', query: 'headphone' },
  { title: 'Mobiles & tablets', query: 'phone' },
  { title: 'TVs & displays', query: 'tv' },
];

export default function Home() {
  const { user } = useAuth();

  return (
    <div>
      {/* hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand via-brand to-sky-500 p-8 text-white shadow-lg md:p-12">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10" />
        <div className="absolute -bottom-24 right-40 h-72 w-72 rounded-full bg-white/5" />
        <div className="relative grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="mb-2 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">NEW · Smart price alerts</p>
            <h1 className="text-3xl font-extrabold leading-tight md:text-5xl">Shop electronics.<br />Never miss a price drop.</h1>
            <p className="mt-3 max-w-md text-white/85">Save products to your wishlist, set your target price, and we&apos;ll alert you the moment it drops or comes back in stock.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {user ? (
                <>
                  <Link href="/products" className="rounded-full bg-accent px-6 py-3 font-semibold shadow hover:bg-accent-dark">Browse products</Link>
                  <Link href="/wishlist" className="rounded-full bg-white/15 px-6 py-3 font-semibold hover:bg-white/25">Your wishlist</Link>
                </>
              ) : (
                <>
                  <Link href="/register" className="rounded-full bg-accent px-6 py-3 font-semibold shadow hover:bg-accent-dark">Create free account</Link>
                  <Link href="/login" className="rounded-full bg-white/15 px-6 py-3 font-semibold hover:bg-white/25">Sign in</Link>
                </>
              )}
            </div>
          </div>

          {/* illustrative alert card */}
          <div className="hidden md:block">
            <div className="ml-auto max-w-xs rounded-2xl bg-white p-4 text-gray-900 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-green-700">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100"><TrendingDown size={15} /></span>
                Price drop on your wishlist
              </div>
              <p className="text-sm font-medium">Gaming Laptop 15&quot;</p>
              <p className="mt-1 text-sm"><span className="text-gray-400 line-through">AED 3,000</span> <span className="text-lg font-extrabold text-brand">AED 2,500</span> <span className="ml-1 rounded bg-deal px-1.5 py-0.5 text-xs font-bold text-white">-16.7%</span></p>
              <p className="mt-1 text-xs text-gray-400">Lowest in 90 days · just now</p>
            </div>
          </div>
        </div>
      </section>

      {/* value props */}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { icon: Heart, title: 'Save what you love', text: 'Multiple wishlists for every occasion.' },
          { icon: BellRing, title: 'Get instant alerts', text: 'Price drops, restocks and low-stock warnings.' },
          { icon: TrendingDown, title: 'Buy at the right time', text: 'See price history and savings since you added.' },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand"><Icon size={22} /></span>
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-gray-500">{text}</p>
            </div>
          </div>
        ))}
      </section>

      {/* shelves (each hides itself if no product matches) */}
      {user && (
        <div className="mt-8">
          {SHELVES.map((s) => (
            <ProductRow key={s.title} title={s.title} query={s.query} />
          ))}
        </div>
      )}
    </div>
  );
}