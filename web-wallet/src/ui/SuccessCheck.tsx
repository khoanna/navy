'use client';
import React from 'react';
import { colors } from './theme';

export interface SuccessCheckProps {
  size?: number;
}

/** Animated seafoam success check with a glowing disc. */
export function SuccessCheck({ size = 88 }: SuccessCheckProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'radial-gradient(circle, #2FE0C2, #17C4A8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 44px rgba(47,224,194,0.6)',
        animation: 'navy-check-pop 420ms cubic-bezier(0.22,1,0.36,1) both',
      }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5 10 17.5 19 7"
          stroke={colors.onAccent}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 30,
            strokeDashoffset: 30,
            animation: 'navy-check-draw 360ms ease 200ms forwards',
          }}
        />
      </svg>
    </div>
  );
}
