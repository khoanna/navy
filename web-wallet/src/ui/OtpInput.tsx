'use client';
import React, { useRef } from 'react';
import { colors, radius } from './theme';
import { Text } from './Text';
import { normalizeOtp } from '@/lib/ui/otp';

export interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  onComplete?: (code: string) => void;
}

/** Six-box one-time-code field. One real input underlays clickable display cells. */
export function OtpInput({ value, onChange, length = 6, onComplete }: OtpInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const cells = Array.from({ length });

  const handle = (raw: string) => {
    const next = normalizeOtp(raw, length);
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  return (
    <div style={{ position: 'relative' }} onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => handle(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
        }}
        aria-label="One-time code"
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {cells.map((_, i) => {
          const active = i === value.length;
          return (
            <div
              key={i}
              style={{
                width: 44,
                height: 54,
                borderRadius: `${radius.md}px`,
                background: colors.bgElevated,
                border: `1px solid ${active ? colors.accent : colors.borderStrong}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="h2" color={colors.textHi}>
                {value[i] ?? ''}
              </Text>
            </div>
          );
        })}
      </div>
    </div>
  );
}
