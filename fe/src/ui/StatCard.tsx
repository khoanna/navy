// fe/src/ui/StatCard.tsx
'use client';
import React from 'react';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { Pill, IconBadge } from './Bits';
import { IconName } from './Icon';

export function StatCard({ label, value, icon, delta, featured, onClick }: {
  label: string; value: string; icon?: IconName; delta?: string | null; featured?: boolean; onClick?: () => void;
}) {
  const base: React.CSSProperties = {
    borderRadius: radius.xl, padding: space.xxl, display: 'flex', flexDirection: 'column', gap: space.md,
    cursor: onClick ? 'pointer' : 'default', minHeight: 132,
  };
  const style: React.CSSProperties = featured
    ? { ...base, background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, boxShadow: '0 12px 28px rgba(79,140,255,0.35)' }
    : { ...base, background: colors.surface, border: `1px solid ${colors.border}` };
  const labelColor = featured ? 'rgba(4,17,31,0.7)' : colors.textDim;
  const valueColor = featured ? colors.onAccent : colors.textHi;
  return (
    <div onClick={onClick} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" upper style={{ color: labelColor }}>{label}</Text>
        {icon && <IconBadge name={icon} color={featured ? colors.onAccent : colors.accent} size={38} />}
      </div>
      <Text variant="h1" numeric color={valueColor}>{value}</Text>
      {delta != null && <Pill label={delta} tone={featured ? 'neutral' : 'success'} />}
    </div>
  );
}
