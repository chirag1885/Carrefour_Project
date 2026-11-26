'use client';

import { RequireAuth, useAuth } from '@/lib/auth';

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return <div className="rounded-2xl bg-white p-12 text-center text-gray-500 shadow-sm">🔒 This area is for administrators only.</div>;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AdminOnly>{children}</AdminOnly>
    </RequireAuth>
  );
}