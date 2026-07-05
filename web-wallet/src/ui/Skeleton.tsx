'use client';
import React from 'react';
import { radius } from './theme';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  round?: boolean;
  style?: React.CSSProperties;
}

/** A shimmering placeholder block for loading balances/lists. */
export function Skeleton({ width = '100%', height = 16, round, style }: SkeletonProps) {
  return (
    <div
      className="navy-skeleton"
      style={{
        width,
        height,
        borderRadius: round ? '999px' : `${radius.sm}px`,
        background:
          'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.10) 37%, rgba(255,255,255,0.04) 63%)',
        backgroundSize: '200% 100%',
        animation: 'navy-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}
