'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useToast } from '@/components/Toast';
import { ApiError, api, fetcher } from '@/lib/api';
import { RequireAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import type { Preferences } from '@/lib/types';

export default function NotificationSettingsPage() {
  return (
    <RequireAuth>
      <Loader />
    </RequireAuth>
  );
}

function Loader() {
  const { data, error, mutate } = useSWR<Preferences>('/me/preferences', fetcher);
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!data) return <div className="h-64 animate-pulse rounded-2xl bg-white" />;
  return <Form initial={data} onSaved={(p) => mutate(p, { revalidate: false })} />;
}

function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex items-center justify-between gap-4 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="ms-2 text-xs text-gray-400">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} className="h-5 w-5 accent-[#004e9f]" />
    </label>
  );
}

function Form({ initial, onSaved }: { initial: Preferences; onSaved: (p: Preferences) => unknown }) {
  const t = useT();
  const toast = useToast();
  const [f, setF] = useState<Preferences>(initial);
  const [quiet, setQuiet] = useState(initial.quietStart !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body: Preferences = {
        ...f,
        channelPush: false, // not available yet
        channelWhatsapp: false,
        quietStart: quiet ? (f.quietStart ?? '22:00') : null,
        quietEnd: quiet ? (f.quietEnd ?? '07:00') : null,
      };
      const saved = await api<Preferences>('/me/preferences', { method: 'PUT', body });
      await onSaved(saved);
      toast(t('settings.saved'));
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'VALIDATION_ERROR'
          ? 'Please check the values: quiet hours need two different times, and the minimum drop can have at most 2 decimals.'
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }

  const card = 'rounded-2xl bg-white p-5 shadow-sm';
  const input = 'rounded-lg border bg-gray-50 px-3 py-2';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      <section className={card}>
        <h2 className="mb-1 font-semibold">How should we reach you?</h2>
        <Toggle label="In-app notifications" checked={f.channelInApp} onChange={(v) => set('channelInApp', v)} />
        <Toggle label="Email" checked={f.channelEmail} onChange={(v) => set('channelEmail', v)} />
        <Toggle label="Push notifications" checked={false} disabled hint="Coming soon" />
        <Toggle label="WhatsApp" checked={false} disabled hint="Coming soon" />
      </section>

      <section className={card}>
        <h2 className="mb-2 font-semibold">When should we send them?</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select value={f.deliveryMode} onChange={(e) => set('deliveryMode', e.target.value as Preferences['deliveryMode'])} className={input}>
            <option value="instant">Instantly</option>
            <option value="daily_digest">One daily digest</option>
          </select>
          {f.deliveryMode === 'daily_digest' && (
            <label className="flex items-center gap-2 text-sm">
              at
              <select value={f.digestHourLocal} onChange={(e) => set('digestHourLocal', Number(e.target.value))} className={input}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-4 border-t pt-3">
          <Toggle label="Quiet hours" checked={quiet} onChange={setQuiet} hint="Alerts wait until quiet hours end" />
          {quiet && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              from <input type="time" value={f.quietStart ?? '22:00'} onChange={(e) => set('quietStart', e.target.value)} className={input} />
              to <input type="time" value={f.quietEnd ?? '07:00'} onChange={(e) => set('quietEnd', e.target.value)} className={input} />
            </div>
          )}
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-semibold">Avoid spam</h2>
        <label className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Ignore price drops smaller than (%)</span>
          <input type="number" min={0} max={100} step={0.5} value={f.minDropPercent} onChange={(e) => set('minDropPercent', Number(e.target.value))} className={`${input} w-28`} />
        </label>
        <label className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>Maximum alerts per day</span>
          <input type="number" min={0} max={50} step={1} value={f.maxAlertsPerDay} onChange={(e) => set('maxAlertsPerDay', Number(e.target.value))} className={`${input} w-28`} />
        </label>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={save} disabled={saving} className="rounded-full bg-brand px-8 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
        {saving ? 'Saving…' : t('settings.save')}
      </button>
    </div>
  );
}