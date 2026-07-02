'use client';
import React, { useState } from 'react';
import { colors, radius, space } from './theme';
import { Text } from './Text';
import { Icon, IconName } from './Icon';

/** Rounded badge for statuses. Tone drives the color. */
export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }) {
  const map = {
    neutral: { bg: colors.glassFill, fg: colors.textDim, bd: colors.border },
    success: { bg: 'rgba(47,224,194,0.12)', fg: colors.success, bd: 'rgba(47,224,194,0.3)' },
    warning: { bg: 'rgba(255,200,97,0.12)', fg: colors.warning, bd: 'rgba(255,200,97,0.3)' },
    danger: { bg: 'rgba(255,107,131,0.12)', fg: colors.danger, bd: 'rgba(255,107,131,0.3)' },
    accent: { bg: 'rgba(79,140,255,0.14)', fg: colors.accent, bd: 'rgba(79,140,255,0.32)' },
  }[tone];
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: `${space.xs + 2}px`,
        alignSelf: 'flex-start',
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: `${space.md}px`,
        paddingRight: `${space.md}px`,
        borderRadius: `${radius.pill}px`,
        border: `1px solid ${map.bd}`,
        backgroundColor: map.bg,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: map.fg,
          flexShrink: 0,
        }}
      />
      <Text variant="label" color={map.fg}>
        {label}
      </Text>
    </div>
  );
}

/** A circular icon chip with a tinted ground. */
export function IconBadge({ name, color = colors.accent, size = 44 }: { name: IconName; color?: string; size?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: `${size / 3}px`,
        backgroundColor: hexA(color, 0.14),
        border: `1px solid ${hexA(color, 0.28)}`,
        flexShrink: 0,
      }}
    >
      <Icon name={name} size={size * 0.5} color={color} strokeWidth={2} />
    </div>
  );
}

/** Label-over-value field, used in detail cards. */
export function Field({
  label,
  value,
  mono,
  numeric,
  valueColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  numeric?: boolean;
  valueColor?: string;
}) {
  return (
    <div style={{ paddingTop: `${space.sm}px`, paddingBottom: `${space.sm}px` }}>
      <Text variant="label" muted upper>
        {label}
      </Text>
      <div style={{ marginTop: `${space.xs}px` }}>
        <Text
          variant={mono ? 'mono' : 'h3'}
          numeric={numeric}
          color={valueColor ?? colors.textHi}
          style={mono ? { userSelect: 'text' } : undefined}
        >
          {value}
        </Text>
      </div>
    </div>
  );
}

export function Divider({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      style={{
        height: 1,
        backgroundColor: colors.border,
        marginTop: `${space.lg}px`,
        marginBottom: `${space.lg}px`,
        ...style,
      }}
    />
  );
}

/** A tappable list row with a spring press; used for nav/actions. */
export function PressRow({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: React.CSSProperties;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      onClick={onPress}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        cursor: onPress ? 'pointer' : undefined,
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 120ms',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** #rrggbb + alpha → rgba(). */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
