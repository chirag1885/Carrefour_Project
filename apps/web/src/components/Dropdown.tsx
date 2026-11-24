'use client';

import { useEffect, useRef, useState } from 'react';

/** Click-to-open panel that closes on outside click or Escape. */
export function Dropdown({
  trigger,
  children,
  buttonClassName = '',
  panelClassName = '',
  label,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={buttonClassName}>
        {trigger(open)}
      </button>
      {open && (
        <div className={`absolute right-0 top-full z-50 mt-2 rounded-xl bg-white text-gray-900 shadow-2xl ring-1 ring-black/10 ${panelClassName}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}