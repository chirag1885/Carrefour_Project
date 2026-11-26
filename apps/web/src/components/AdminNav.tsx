'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/products', label: 'Prices & stock' },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <div className="mb-5 flex items-center gap-2">
      <h1 className="me-4 text-2xl font-bold">Admin</h1>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${path === t.href ? 'bg-brand text-white' : 'bg-white ring-1 ring-gray-200 hover:bg-gray-50'}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}