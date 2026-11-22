'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/hooks';

export function Nav() {
  const { user, logout } = useAuth();
  const { data: cart } = useCart();
  const path = usePathname();
  const router = useRouter();
  const count = cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;

  const link = (href: string, label: string) => (
    <Link href={href} className={`rounded px-3 py-1.5 text-sm font-medium ${path.startsWith(href) ? 'bg-white/20' : 'hover:bg-white/10'}`}>
      {label}
    </Link>
  );

  return (
    <header className="bg-brand text-white shadow">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link href="/products" className="mr-4 text-lg font-bold">
          Smart<span className="text-red-300">Wishlist</span>
        </Link>
        {user && (
          <>
            {link('/products', 'Products')}
            {link('/wishlist', 'Wishlist')}
            {link('/cart', `Cart${count ? ` (${count})` : ''}`)}
          </>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="hidden sm:inline">{user.fullName}</span>
              <button
                onClick={async () => {
                  await logout();
                  router.replace('/login');
                }}
                className="rounded bg-white/15 px-3 py-1.5 hover:bg-white/25"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:underline">Sign in</Link>
              <Link href="/register" className="rounded bg-accent px-3 py-1.5 font-medium">Create account</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}