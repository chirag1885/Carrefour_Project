'use client';

import { Hourglass, Info, ThumbsUp } from 'lucide-react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Prediction } from '@/lib/types';

export function PricePrediction({ productId }: { productId: string }) {
  const t = useT();
  const { data } = useSWR<Prediction>(`/products/${productId}/prediction`, fetcher);
  if (!data) return <div className="h-28 animate-pulse rounded-2xl bg-white" />;

  const look = {
    BUY_NOW: { label: t('pred.buy'), Icon: ThumbsUp, box: 'bg-green-50 ring-green-200', chip: 'bg-green-600 text-white' },
    WAIT: { label: t('pred.wait'), Icon: Hourglass, box: 'bg-amber-50 ring-amber-200', chip: 'bg-amber-500 text-white' },
    INSUFFICIENT_DATA: { label: t('pred.none'), Icon: Info, box: 'bg-gray-50 ring-gray-200', chip: 'bg-gray-500 text-white' },
  }[data.verdict];

  return (
    <div className={`rounded-2xl p-5 shadow-sm ring-1 ${look.box}`}>
      <h2 className="mb-2 text-sm font-semibold text-gray-600">{t('pred.title')}</h2>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${look.chip}`}>
        <look.Icon size={15} /> {look.label}
      </span>
      <ul className="mt-3 space-y-1 text-sm text-gray-700">
        {data.reasons.map((r) => (
          <li key={r}>• {r}</li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-gray-400">{t('pred.note')}</p>
    </div>
  );
}