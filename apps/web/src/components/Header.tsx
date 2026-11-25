'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, Heart, Search, ShoppingCart, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Dropdown } from './Dropdown';
import { NotificationBell } from './NotificationBell';

export function Header() {
  const { user, logout } = useAuth();
  const { data: cart } = useCart();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState('');
  const count = cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;
  const iconBtn = 'relative flex flex-col items-center rounded px-2 py-1 hover:bg-white/10';

  function search(e: React.FormEvent) {
    e.preventDefault();
    router.push(q.trim() ? `/products?query=${encodeURIComponent(q.trim())}` : '/products');
  }

  return (
    <header className="sticky top-0 z-40 shadow-md">
      <div className="bg-brand-dark text-xs text-white/90">
        <div className="mx-auto flex max-w-7xl justify-between px-4 py-1.5">
          <span>{t('nav.free')}</span>
          <span className="hidden sm:inline">{t('nav.tagline')}</span>
        </div>
      </div>

      <div className="bg-brand text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/" className="shrink-0 text-xl font-extrabold tracking-tight">
            Smart<span className="text-red-300">Wishlist</span>
          </Link>

          <form onSubmit={search} className="order-3 flex w-full overflow-hidden rounded-lg bg-white md:order-none md:w-auto md:flex-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('nav.search')}
              className="min-w-0 flex-1 px-4 py-2.5 text-sm text-gray-900 outline-none"
            />
            <button className="bg-accent px-5 hover:bg-accent-dark" aria-label="Search">
              <Search size={20} />
            </button>
          </form>

          <nav className="ms-auto flex items-center gap-1 md:ms-0">
            <button
              onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}
              className="rounded px-2 py-1 text-sm font-semibold hover:bg-white/10"
              aria-label="Change language"
            >
              {t('nav.lang')}
            </button>

            {user ? (
              <>
                <Dropdown
                  label="Account"
                  buttonClassName="flex flex-col items-start rounded px-2 py-1 text-start hover:bg-white/10"
                  panelClassName="w-64"
                  trigger={() => (
                    <>
                      <span className="text-[11px] text-white/80">{t('nav.hello')}, {user.fullName.split(' ')[0]}</span>
                      <span className="flex items-center gap-1 text-sm font-semibold">
                        {t('nav.account')} <ChevronDown size={14} />
                      </span>
                    </>
                  )}
                >
                  {(close) => (
                    <div className="py-2 text-sm">
                      <p className="truncate border-b px-4 pb-2 text-xs text-gray-500">{user.email}</p>
                      {[
                        ['/products', t('nav.browse')],
                        ['/wishlist', t('nav.yourWishlists')],
                        ['/notifications', t('nav.notifications')],
                        ['/settings/notifications', t('nav.settings')],
                        ['/cart', t('nav.yourCart')],
                      ].map(([href, label]) => (
                        <Link key={href} href={href} onClick={close} className="block px-4 py-2 hover:bg-gray-50">
                          {label}
                        </Link>
                      ))}
                      <button
                        onClick={async () => {
                          close();
                          await logout();
                          router.replace('/login');
                        }}
                        className="block w-full border-t px-4 py-2 text-start text-red-600 hover:bg-gray-50"
                      >
                        {t('nav.signout')}
                      </button>
                    </div>
                  )}
                </Dropdown>

                <Link href="/wishlist" className={iconBtn}>
                  <Heart size={22} />
                  <span className="hidden text-[11px] lg:block">{t('nav.wishlist')}</span>
                </Link>
                <NotificationBell />
                <Link href="/cart" className={iconBtn}>
                  <span className="relative">
                    <ShoppingCart size={22} />
                    {count > 0 && (
                      <span className="absolute -end-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold ring-2 ring-brand">
                        {count}
                      </span>
                    )}
                  </span>
                  <span className="hidden text-[11px] lg:block">{t('nav.cart')}</span>
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className="flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium hover:bg-white/10">
                  <UserIcon size={18} /> {t('nav.signin')}
                </Link>
                <Link href="/register" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-dark">
                  {t('nav.create')}
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}