import React from 'react';
import { Skeleton } from './Skeleton';

export function SkeletonList({ rows = 4, height = 48 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} height={height} />)}
    </div>
  );
}
