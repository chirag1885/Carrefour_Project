'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useLatestNotifications, useUnreadCount } from '@/lib/hooks';
import { Dropdown } from './Dropdown';
import { NotificationRow, useNotificationActions } from './NotificationRow';

export function NotificationBell() {
  const { data: unread } = useUnreadCount();
  const { data: latest } = useLatestNotifications(8);
  const actions = useNotificationActions();
  const count = unread?.count ?? 0;

  return (
    <Dropdown
      label="Notifications"
      buttonClassName="relative flex flex-col items-center rounded px-2 py-1 hover:bg-white/10"
      panelClassName="w-[min(92vw,380px)]"
      trigger={() => (
        <>
          <span className="relative">
            <Bell size={22} />
            {count > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white ring-2 ring-brand">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </span>
          <span className="hidden text-[11px] lg:block">Alerts</span>
        </>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="font-semibold">Notifications</h3>
            <button
              onClick={() => void actions.markAllRead()}
              disabled={count === 0}
              className="text-xs font-medium text-brand hover:underline disabled:text-gray-400 disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>

          <div className="max-h-[420px] divide-y overflow-y-auto">
            {!latest && <p className="p-6 text-center text-sm text-gray-400">Loading…</p>}
            {latest && latest.items.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">
                <p className="mb-1 text-2xl">🔔</p>
                No notifications yet. We&apos;ll tell you when a price drops or an item is back in stock.
              </div>
            )}
            {latest?.items.map((n) => (
              <NotificationRow key={n.id} n={n} compact onOpen={() => void actions.open(n, close)} />
            ))}
          </div>

          <Link href="/notifications" onClick={close} className="block border-t px-4 py-3 text-center text-sm font-medium text-brand hover:bg-gray-50">
            See all notifications
          </Link>
        </div>
      )}
    </Dropdown>
  );
}