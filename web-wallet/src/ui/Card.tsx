'use client';
import React from 'react';
import { colors, radius, space } from './theme';

export interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Tighter padding for list-like cards. */
  compact?: boolean;
  elevated?: boolean;
  /** Translucent frosted panel (Aurora Glass surfaces). */
  glass?: boolean;
}

/** A surface panel with a hairline border — the default container for content. */
export function Card({ children, style, compact, elevated, glass }: CardProps) {
  // Resolve a single `background` value so callers passing `background` (e.g. a
  // gradient) don't collide with our `backgroundColor` — React warns when a
  // shorthand and its longhand are mixed and one is dropped on rerender.
  const { background, backgroundColor, ...restStyle } = style ?? {};
  const surface = glass ? 'rgba(255,255,255,0.055)' : colors.surface;
  return (
    <div
      style={{
        background: background ?? backgroundColor ?? surface,
        backdropFilter: glass ? 'blur(14px)' : undefined,
        WebkitBackdropFilter: glass ? 'blur(14px)' : undefined,
        borderRadius: `${radius.xl}px`,
        border: `1px solid ${glass ? 'rgba(255,255,255,0.09)' : colors.border}`,
        padding: compact ? `${space.lg}px` : `${space.xxl}px`,
        ...(elevated ? { boxShadow: '0 12px 24px rgba(0,0,0,0.45)' } : {}),
        ...restStyle,
      }}
    >
      {children}
    </div>
  );
}
