import React from 'react';
import { View } from 'react-native';
import { Skeleton } from './Skeleton';
import { space } from './theme';

/** N stacked skeleton rows for loading lists (history, farming, home). */
export function SkeletonList({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: space.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </View>
  );
}
