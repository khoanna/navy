'use client';
import React from 'react';
import { colors, radius, space } from './theme';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Bottom sheet: a scrim + slide-up panel anchored inside the phone frame.
 * Tapping the scrim (not the panel) closes it. Panel clears the home indicator.
 */
export function Sheet({ open, onClose, children }: SheetProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        background: 'rgba(2,4,10,0.55)',
        animation: 'navy-scrim-in 180ms ease both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          background: colors.bgElevated,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: `${radius.xxl}px ${radius.xxl}px 0 0`,
          padding: `${space.md}px ${space.xl}px calc(${space.xl}px + env(safe-area-inset-bottom))`,
          animation: 'navy-sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        <div
          style={{
            width: 38,
            height: 4,
            borderRadius: 9,
            background: 'rgba(255,255,255,0.2)',
            margin: `0 auto ${space.lg}px`,
          }}
        />
        {children}
      </div>
    </div>
  );
}
