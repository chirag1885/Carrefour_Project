'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCheck } from 'lucide-react';
import useSWRInfinite from 'swr/infinite';
import { NotificationRow, useNotificationActions } from '@/components/NotificationRow';
import { fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useUnreadCount } from '@/lib/hooks';
import type { AppNotification, Page } from '@/lib/types';

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <Feed />
    </RequireAuth>
  );
}

function Feed() {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const actions = useNotificationActions();
  const { data: unread } = useUnreadCount();

  const { data, error, size, setSize, isValidating } = useSWRInfinite<Page<AppNotification>>(
    (i, prev) => {
      if (prev && !prev.nextCursor) return null;
      const p = new URLSearchParams({ limit: '20' });
      if (tab === 'unread') p.set('unread', 'true');
      if (i > 0 && prev?.nextCursor) p.set('cursor', prev.nextCursor);
      return `/notifications?${p}`;
    },
    fetcher,
       { revalidateAll: true },
  );

  const items = data?.flatMap((d) => d.items) ?? [];
  const hasMore = !!data && !!data[data.length - 1].nextCursor;
  const count = unread?.count ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <button onClick={() => void actions.markAllRead()} disabled={count === 0} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-brand ring-1 ring-brand hover:bg-brand-light disabled:text-gray-400 disabled:ring-gray-200 disabled:hover:bg-transparent">
          <CheckCheck size={16} /> Mark all as read
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        {(['all', 'unread'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === t ? 'bg-brand text-white' : 'bg-white ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {t === 'all' ? 'All' : `Unread${count ? ` (${count})` : ''}`}
          </button>
        ))}
      </div>

      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {!data && !error && <div className="h-40 animate-pulse rounded-2xl bg-white" />}
      {data && items.length === 0 && (
        <div className="rounded-2xl bg-white p-12 text-center text-gray-500 shadow-sm">
          <p className="mb-2 text-4xl">{tab === 'unread' ? '✅' : '🔔'}</p>
          {tab === 'unread' ? "You're all caught up." : "Nothing yet. Add items to your wishlist with a target price and we'll notify you."}
          <div className="mt-4"><Link href="/products" className="text-brand underline">Browse products</Link></div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {items.map((n) => <NotificationRow key={n.id} n={n} onOpen={() => void actions.open(n)} />)}
      </div>

      {hasMore && (
        <div className="mt-5 text-center">
          <button onClick={() => setSize(size + 1)} disabled={isValidating} className="rounded-full bg-brand px-6 py-2 font-semibold text-white disabled:opacity-60">
            {isValidating ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}