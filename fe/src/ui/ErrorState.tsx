'use client';
import React from 'react';
import type { MappedError } from '@/lib/mapError';
import { Button } from './Button';
import { Text } from './Text';
import { colors, space } from './theme';

export function ErrorState({ error, onRetry, compact }: {
  error: MappedError; onRetry?: () => void; compact?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      gap: space.sm, padding: compact ? `${space.lg}px` : `${space.huge}px ${space.xxl}px`,
    }}>
      <Text variant={compact ? 'h3' : 'h2'} color={colors.textHi} center>{error.title}</Text>
      <Text variant="caption" color={colors.textDim} center style={{ maxWidth: 360 }}>{error.detail}</Text>
      {onRetry && (
        <div style={{ marginTop: space.sm }}>
          <Button variant="secondary" label="Retry" onPress={onRetry} full={false} />
        </div>
      )}
    </div>
  );
}
