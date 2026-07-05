// fe/src/ui/TopBar.tsx
'use client';
import React from 'react';
import { colors, space } from './theme';
import { Text } from './Text';

export function TopBar({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg, padding: `${space.xl}px 0 ${space.lg}px`, marginBottom: space.lg, borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {eyebrow && <Text variant="label" upper dim style={{ display: 'block' }}>{eyebrow}</Text>}
        <Text variant="h1" color={colors.textHi} style={{ display: 'block' }}>{title}</Text>
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>{right}</div>}
    </header>
  );
}
