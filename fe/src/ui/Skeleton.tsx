import React from 'react';

export function Skeleton({ height = 16, width = '100%', radius = 8 }: {
  height?: number | string; width?: number | string; radius?: number;
}) {
  return (
    <span aria-hidden style={{
      display: 'block', height, width, borderRadius: radius,
      background: 'linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.10), rgba(255,255,255,.04))',
      backgroundSize: '200% 100%', animation: 'navy-skeleton 1.4s ease-in-out infinite',
    }} />
  );
}
