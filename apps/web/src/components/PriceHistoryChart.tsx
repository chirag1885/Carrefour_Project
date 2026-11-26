'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { aed } from '@/lib/format';
import type { PriceHistory } from '@/lib/types';

const RANGES = [7, 15, 30, 90] as const;
// days between the dots on the x-axis: 90D -> every 15 days (6 dots), 30D -> every 5 days, 15D -> every 3, 7D -> daily
const STEP: Record<number, number> = { 7: 1, 15: 3, 30: 5, 90: 15 };
const W = 640;
const H = 260;
const PAD = { l: 58, r: 18, t: 18, b: 36 };

const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function PriceHistoryChart({ productId }: { productId: string }) {
  const { data, error } = useSWR<PriceHistory>(`/products/${productId}/price-history?range=90d`, fetcher);
  const [days, setDays] = useState<number>(90);
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(() => (data?.points ?? []).slice(-days).map((p) => ({ t: new Date(p.at), price: p.price })), [data, days]);

  if (error) return <p className="text-sm text-gray-400">Price history is not available right now.</p>;
  if (!data) return <div className="h-72 animate-pulse rounded-xl bg-gray-50" />;
  if (pts.length < 2) {
    return <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">The price graph will appear here as this product&apos;s price changes.</p>;
  }

  const n = pts.length;
  const prices = pts.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || hi * 0.02 || 1;
  const yMin = lo - span * 0.15;
  const yMax = hi + span * 0.15;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - PAD.b} L${x(0).toFixed(1)} ${H - PAD.b} Z`;

  const step = STEP[days] ?? 5;
  const ticks: number[] = [];
  for (let k = 0; k < 6; k++) {
    const i = n - 1 - step * k;
    if (i < 0) break;
    ticks.push(i);
  }
  ticks.reverse();

  const grid = [0, 1, 2, 3].map((k) => yMin + ((yMax - yMin) * k) / 3);
  const first = pts[0].price;
  const last = pts[n - 1].price;
  const delta = last - first;
  const pct = first ? (delta / first) * 100 : 0;
  const down = delta < 0; // a falling price is good news for a shopper
  const h = hover !== null ? pts[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Price history</h2>
          <p className="text-xs text-gray-500">
            {delta === 0 ? 'No change' : (
              <span className={down ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>
                {down ? '▼' : '▲'} {aed(Math.abs(delta))} ({Math.abs(pct).toFixed(1)}%)
              </span>
            )}{' '}
            over the last {n} days · low {aed(lo)} · high {aed(hi)}
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => {
                setDays(r);
                setHover(null);
              }}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${days === r ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {r}D
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Price history chart">
        <defs>
          <linearGradient id="phFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#004e9f" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#004e9f" stopOpacity="0" />
          </linearGradient>
        </defs>

        {grid.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeDasharray="3 4" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#9ca3af">{Math.round(v).toLocaleString('en-US')}</text>
          </g>
        ))}

        <path d={area} fill="url(#phFill)" />
        <path d={line} fill="none" stroke="#004e9f" strokeWidth="2.2" strokeLinejoin="round" />

        {ticks.map((i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(pts[i].price)} r="4.5" fill="#fff" stroke="#004e9f" strokeWidth="2" />
            <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="#6b7280">{i === n - 1 ? 'Today' : day(pts[i].t)}</text>
          </g>
        ))}

        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#9ca3af" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(h.price)} r="5" fill="#e30613" stroke="#fff" strokeWidth="2" />
            <g transform={`translate(${Math.min(Math.max(x(hover) - 55, PAD.l), W - PAD.r - 110)}, ${Math.max(y(h.price) - 48, 2)})`}>
              <rect width="110" height="38" rx="8" fill="#111827" />
              <text x="55" y="15" textAnchor="middle" fontSize="11" fill="#d1d5db">{day(h.t)}</text>
              <text x="55" y="30" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{aed(h.price)}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}