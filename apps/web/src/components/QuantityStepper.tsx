'use client';

import { Minus, Plus } from 'lucide-react';

export function QuantityStepper({
  value,
  max,
  busy,
  onChange,
}: {
  value: number;
  max: number;
  busy?: boolean;
  onChange: (next: number) => void;
}) {
  const btn = 'flex h-8 w-8 items-center justify-center text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="inline-flex items-center overflow-hidden rounded-full border border-gray-300 bg-white">
      <button type="button" className={btn} disabled={busy || value <= 1} onClick={() => onChange(value - 1)} aria-label="Decrease quantity">
        <Minus size={16} />
      </button>
      <span className="w-9 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button type="button" className={btn} disabled={busy || value >= max} onClick={() => onChange(value + 1)} aria-label="Increase quantity">
        <Plus size={16} />
      </button>
    </div>
  );
}