'use client';
import React from 'react';
import { colors, radius, space } from './theme';

export interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Tighter padding for list-like cards. */
  compact?: boolean;
  elevated?: boolean;
}

/** A surface panel with a hairline border — the default container for content. */
export function Card({ children, style, compact, elevated }: CardProps) {
  return (
    <div
      style={{
        backgroundColor: colors.surface,
        borderRadius: `${radius.xl}px`,
        border: `1px solid ${colors.border}`,
        padding: compact ? `${space.lg}px` : `${space.xxl}px`,
        ...(elevated ? { boxShadow: '0 12px 24px rgba(0,0,0,0.45)' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
