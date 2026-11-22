'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export default function RegisterPage() {
  const { user, loading, register } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/products');
  }, [loading, user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(fullName, email, password);
      router.replace('/products');
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'VALIDATION_ERROR' ? 'Check your details: a valid email and a password of at least 8 characters.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl bg-white p-6 shadow">
      <h1 className="mb-4 text-xl font-bold">Create your account</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input className="rounded border px-3 py-2" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input className="rounded border px-3 py-2" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="rounded border px-3 py-2" type="password" placeholder="Password (min 8 characters)" minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="rounded bg-brand px-3 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-500">
        Already registered? <Link href="/login" className="text-brand underline">Sign in</Link>
      </p>
    </div>
  );
}