'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AdminNav } from '@/components/AdminNav';
import { RequireAdmin } from '@/components/RequireAdmin';
import { fetcher } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { ActivityItem, AdminOverview, SystemHealth } from '@/lib/types';

export default function AdminPage() {
  return (
    <RequireAdmin>
      <Dashboard />
    </RequireAdmin>
  );
}

const num = (n: number) => n.toLocaleString('en-US');

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-brand">{value}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok === null ? 'bg-gray-300' : ok ? 'bg-green-500' : 'bg-red-500'}`} />;
}

function Dashboard() {
  const [days, setDays] = useState(30);
  const { data: o } = useSWR<AdminOverview>(`/admin/analytics/overview?days=${days}`, fetcher, { refreshInterval: 10000 });
  const { data: h } = useSWR<SystemHealth>('/admin/system/health', fetcher, { refreshInterval: 5000 });
  const { data: feed } = useSWR<ActivityItem[]>('/admin/activity?limit=15', fetcher, { refreshInterval: 3000 });

  const maxDaily = Math.max(1, ...(o?.daily.map((d) => d.sent) ?? [1]));
  const rate = o && o.wishlistAdds > 0 ? Math.round((o.cartAddsFromWishlist / o.wishlistAdds) * 1000) / 10 : 0;

  return (
    <div>
      <AdminNav />

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Overview</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border bg-white px-3 py-1.5 text-sm">
          {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>

      {!o ? (
        <div className="h-40 animate-pulse rounded-2xl bg-white" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Alerts sent" value={num(o.alertsSent)} />
            <Kpi label="Items added to wishlists" value={num(o.wishlistAdds)} />
            <Kpi label="Moved to cart from wishlists" value={num(o.cartAddsFromWishlist)} />
            <Kpi label="Wishlist → cart rate" value={`${rate}%`} hint="moved to cart ÷ added to wishlists" />
          </div>

          <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Alerts sent per day</h3>
            {o.daily.length === 0 ? (
              <p className="text-sm text-gray-400">No alerts in this period yet.</p>
            ) : (
              <div className="flex h-40 items-end gap-1 overflow-x-auto">
                {o.daily.map((d) => (
                  <div key={d.day} className="flex h-full min-w-6 flex-1 flex-col justify-end" title={`${d.day}: ${d.sent} alerts`}>
                    <div className="flex flex-1 items-end justify-center">
                      <div className="w-3 rounded-t bg-brand" style={{ height: `${(d.sent / maxDaily) * 100}%` }} />
                    </div>
                    <span className="mt-1 text-center text-[9px] text-gray-400">{d.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">System health <span className="ms-2 text-xs font-normal text-gray-400">refreshes every 5 s</span></h3>
          {!h ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between"><span><Dot ok={h.db} /> Database</span><span>{h.db ? 'up' : 'DOWN'}</span></li>
              <li className="flex items-center justify-between"><span><Dot ok={h.redis} /> Redis</span><span>{h.redis ? 'up' : 'DOWN'}</span></li>
              <li className="flex items-center justify-between">
                <span><Dot ok={h.outbox ? h.outbox.pending < 50 : null} /> Outbox backlog</span>
                <span>{h.outbox ? `${h.outbox.pending} pending${h.outbox.oldestSeconds ? ` · oldest ${h.outbox.oldestSeconds}s` : ''}` : 'n/a'}</span>
              </li>
              <li className="flex items-center justify-between">
                <span><Dot ok={h.deliveries ? h.deliveries.dead === 0 && h.deliveries.failed === 0 : null} /> Deliveries</span>
                <span>{h.deliveries ? `${h.deliveries.sent} sent · ${h.deliveries.pending} pending · ${h.deliveries.failed} failed · ${h.deliveries.dead} dead` : 'n/a'}</span>
              </li>
              {h.counts && (
                <li className="border-t pt-2 text-xs text-gray-400">{num(h.counts.users)} users · {num(h.counts.products)} products · {num(h.counts.wishlistItems)} wishlist items</li>
              )}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">Live alert feed <span className="ms-2 text-xs font-normal text-gray-400">refreshes every 3 s</span></h3>
          <ul className="divide-y text-sm">
            {(feed ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                <span className="rounded bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand">{a.type}</span>
                <span className="min-w-0 flex-1 truncate">{a.productName ?? '—'} <span className="text-gray-400">→ {a.userEmail}</span></span>
                <span className="text-xs text-gray-400">{a.deliveries ?? 'no deliveries'}</span>
                <span className="text-xs text-gray-400">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
            {feed && feed.length === 0 && <li className="py-3 text-gray-400">No alerts yet. Change a price in Prices &amp; stock to trigger some.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}