'use client';

import { createContext, useCallback, useContext, useState } from 'react';

const Ctx = createContext<(msg: string) => void>(() => undefined);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msgs, setMsgs] = useState<{ id: number; text: string }[]>([]);
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setMsgs((m) => [...m, { id, text }]);
    setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {msgs.map((m) => (
          <div key={m.id} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {m.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}