'use client';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { colors, radius, space } from './theme';
import { Text } from './Text';

export type ToastIntent = 'info' | 'success' | 'error';
type ToastFn = (msg: string, intent?: ToastIntent) => void;

const Ctx = createContext<ToastFn>(() => {});
export function useToast(): ToastFn { return useContext(Ctx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; intent: ToastIntent } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastFn>((msg, intent = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, intent });
    const dwell = intent === 'error' ? 4600 : 3200;
    timer.current = setTimeout(() => setToast(null), dwell);
  }, []);

  const borderColor =
    toast?.intent === 'error' ? colors.danger
    : toast?.intent === 'success' ? colors.success
    : colors.borderStrong;

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div
          role="status"
          data-intent={toast.intent}
          className="navy-fade-in"
          style={{
            position: 'fixed', bottom: space.xxl, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, maxWidth: 420, padding: `${space.md}px ${space.xl}px`,
            borderRadius: radius.md,
            background: colors.surfaceHi,
            border: `1px solid ${borderColor}`,
            boxShadow: '0 12px 32px rgba(0,0,0,.45)',
          }}
        >
          <Text variant="body" color={colors.textHi}>{toast.msg}</Text>
        </div>
      )}
    </Ctx.Provider>
  );
}
