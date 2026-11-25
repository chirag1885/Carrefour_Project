'use client';

import { useRouter } from 'next/navigation';
import { Flame, Newspaper, PackageCheck, Sparkles, Store, Target, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useInvalidate } from '@/lib/hooks';
import { describeNotification } from '@/lib/notifications';
import type { AppNotification } from '@/lib/types';
import { ProductImage } from './ProductCard';

const ICONS = { drop: TrendingDown, target: Target, stock: PackageCheck, low: Flame, store: Store, similar: Sparkles, digest: Newspaper };
const TONES = { good: 'bg-green-100 text-green-700', warn: 'bg-orange-100 text-orange-700', info: 'bg-blue-100 text-blue-700' };

export function useNotificationActions() {
  const router = useRouter();
  const invalidate = useInvalidate();
  return {
    /** Opens the notification's product (or the wishlist), recording the click so it also counts as read. */
    async open(n: AppNotification, afterNavigate?: () => void) {
      void Promise.all([
        api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined),
        api(`/notifications/${n.id}/click`, { method: 'POST' }).catch(() => undefined),
      ]).finally(() => invalidate('/notifications'));
      router.push(n.productId ? `/products/${n.productId}` : '/wishlist');
      afterNavigate?.();
    },
    async markAllRead() {
      await api('/notifications/read-all', { method: 'POST' });
      await invalidate('/notifications');
    },
    async markRead(id: string) {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      await invalidate('/notifications');
    },
  };
}

export function NotificationRow({ n, onOpen, compact }: { n: AppNotification; onOpen: () => void; compact?: boolean }) {
  const d = describeNotification(n);
  const Icon = ICONS[d.icon];
  const unread = !n.readAt;
  return (
    <button
      onClick={onOpen}
      className={`flex w-full items-start gap-3 text-left transition hover:bg-gray-50 ${compact ? 'px-4 py-3' : 'rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-100'} ${unread ? 'bg-blue-50/40' : ''}`}
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONES[d.tone]}`}>
        <Icon size={18} />
      </span>
      {n.product && (
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-gray-50 ring-1 ring-gray-100">
          <ProductImage src={n.product.imageUrl} alt="" className="h-full w-full object-contain" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-sm leading-snug ${unread ? 'font-semibold text-gray-900' : 'text-gray-700'} ${compact ? 'line-clamp-2' : ''}`}>{d.title}</span>
        {d.detail && <span className="mt-0.5 block text-xs text-gray-500">{d.detail}</span>}
        <span className="mt-1 block text-xs text-gray-400">{timeAgo(n.createdAt)}</span>
      </span>
      {unread && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
    </button>
  );
}