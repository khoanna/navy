'use client';
import React from 'react';

type Dir = 'diagonal' | 'vertical' | 'horizontal';
const ANGLE: Record<Dir, string> = { diagonal: '135deg', vertical: '180deg', horizontal: '90deg' };

export interface GradientProps {
  colors: readonly string[];
  locations?: readonly number[];
  direction?: Dir;
  glow?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function Gradient({ colors, locations, direction = 'diagonal', glow, style, children }: GradientProps) {
  const stops = colors.map((c, i) => {
    const pct = locations ? locations[i] * 100 : (i / (colors.length - 1)) * 100;
    return `${c} ${pct}%`;
  }).join(', ');
  const base = `linear-gradient(${ANGLE[direction]}, ${stops})`;
  const glowLayer = 'radial-gradient(62% 62% at 82% 12%, rgba(255,255,255,0.35), rgba(255,255,255,0) 70%)';
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: glow ? `${glowLayer}, ${base}` : base, ...style }}>
      {children}
    </div>
  );
}
