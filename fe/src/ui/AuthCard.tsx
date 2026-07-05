// fe/src/ui/AuthCard.tsx
'use client';
import React from 'react';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { Icon } from './Icon';

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: space.xl }}>
      <div className="navy-fade-in" style={{ width: '100%', maxWidth: 420, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.xxl, padding: space.xxxl, display: 'flex', flexDirection: 'column', gap: space.lg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
          <div style={{ width: 34, height: 34, borderRadius: radius.md, background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, display: 'grid', placeItems: 'center' }}>
            <Icon name="wallet" size={18} color={colors.onAccent} />
          </div>
          <Text variant="h3" color={colors.textHi}>Navy</Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text variant="h1" color={colors.textHi} style={{ display: 'block' }}>{title}</Text>
          {subtitle && <Text variant="caption" dim style={{ display: 'block' }}>{subtitle}</Text>}
        </div>
        {children}
      </div>
    </div>
  );
}
