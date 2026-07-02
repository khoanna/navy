'use client';
import React, { createContext, useCallback, useContext, useState } from 'react';
import { colors, radius, space } from './theme';

const Ctx = createContext<(msg: string) => void>(() => {});
export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      {msg && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 110, transform: 'translateX(-50%)',
          maxWidth: 380, zIndex: 100, background: colors.surfaceHi, color: colors.textHi,
          border: `1px solid ${colors.borderStrong}`, borderRadius: `${radius.md}px`,
          padding: `${space.md}px ${space.lg}px`, fontSize: 14, boxShadow: '0 12px 24px rgba(0,0,0,0.45)',
        }}>
          {msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
