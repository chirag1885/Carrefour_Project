'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { AdminNav } from '@/components/AdminNav';
import { RequireAdmin } from '@/components/RequireAdmin';
import { useToast } from '@/components/Toast';
import { api, fetcher } from '@/lib/api';
import { aed } from '@/lib/format';
import type { AdminOverview, Page, Product } from '@/lib/types';

export default function AdminProductsPage() {
  return (
    <RequireAdmin>
      <Editor />
    </RequireAdmin>
  );
}

function Editor() {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, mutate } = useSWR<Page<Product>>(`/products?limit=15${q ? `&query=${encodeURIComponent(q)}` : ''}`, fetcher);
  const { data: overview } = useSWR<AdminOverview>('/admin/analytics/overview?days=30', fetcher);

  // Drops the most wishlisted products by 20%, so real wishlisters get real alerts.
  async function flashSale() {
    const targets = overview?.topWishlisted.map((t) => t.product) ?? [];
    if (targets.length === 0) return toast('No wishlisted products yet');
    if (!window.confirm(`Drop the price of ${targets.length} most-wishlisted products by 20%?`)) return;
    setBusy(true);
    let ok = 0;
    for (const p of targets) {
      try {
        await api(`/admin/products/${p.id}/price`, { method: 'PUT', body: { price: Math.max(0.01, Math.round(p.currentPrice * 0.8 * 100) / 100), source: 'promo' } });
        ok++;
      } catch {
        /* keep going */
      }
    }
    setBusy(false);
    toast(`Flash sale applied to ${ok} of ${targets.length} products`);
    await mutate();
  }

  return (
    <div>
      <AdminNav />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search a product to edit…" className="w-full rounded-lg border bg-white px-4 py-2 sm:max-w-sm" />
        <button onClick={flashSale} disabled={busy} className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-60">
          {busy ? 'Applying…' : '⚡ Flash sale: top wishlisted −20%'}
        </button>
      </div>

      <div className="space-y-3">
        {!data && <div className="h-32 animate-pulse rounded-2xl bg-white" />}
        {data?.items.map((p) => <Row key={p.id} p={p} onChanged={() => mutate()} />)}
        {data && data.items.length === 0 && <p className="text-gray-500">No products match.</p>}
      </div>
    </div>
  );
}

function Row({ p, onChanged }: { p: Product; onChanged: () => void }) {
  const toast = useToast();
  const [price, setPrice] = useState(p.currentPrice.toFixed(2));
  const [stock, setStock] = useState(String(p.totalStock));

  async function setPriceNow() {
    const n = Number(price);
    if (!(n > 0) || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return toast('Enter a positive price with at most 2 decimals');
    try {
      await api(`/admin/products/${p.id}/price`, { method: 'PUT', body: { price: n, source: 'admin' } });
      toast(`Price set to ${aed(n)}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function setStockNow(value?: number) {
    const n = value ?? Number(stock);
    if (!Number.isInteger(n) || n < 0) return toast('Enter a whole number of 0 or more');
    try {
      await api(`/admin/products/${p.id}/stock`, { method: 'PUT', body: { quantity: n } });
      setStock(String(n));
      toast(`Stock set to ${n}`);
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const input = 'w-28 rounded-lg border px-3 py-1.5 text-sm';
  const btn = 'rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200';
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white p-4 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 font-medium">{p.nameEn}</p>
        <p className="text-xs text-gray-400">#{p.id} · now {aed(p.currentPrice)} · stock {p.totalStock}</p>
      </div>
      <div className="flex items-center gap-2">
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={input} aria-label="Price" />
        <button onClick={setPriceNow} className={btn}>Set price</button>
      </div>
      <div className="flex items-center gap-2">
        <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" className={input} aria-label="Stock" />
        <button onClick={() => setStockNow()} className={btn}>Set stock</button>
        <button onClick={() => setStockNow(0)} className={`${btn} text-red-600`}>Sell out</button>
        <button onClick={() => setStockNow(20)} className={btn}>Restock 20</button>
      </div>
    </div>
  );
}