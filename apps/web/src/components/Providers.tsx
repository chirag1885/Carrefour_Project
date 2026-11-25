'use client';

import { SWRConfig } from 'swr';
import { AuthProvider } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n';
import { ToastProvider } from './Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ revalidateOnFocus: false, shouldRetryOnError: false }}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </SWRConfig>
  );
}