import React from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { colors, radius, space } from './theme';
import { Text } from './Text';
import { Icon, IconName } from './Icon';

// ---------------------------------------------------------------------------
// Pill
// ---------------------------------------------------------------------------

type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

/** Rounded badge for statuses. Tone drives the color. */
export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: PillTone;
}) {
  const map: Record<PillTone, { bg: string; fg: string; bd: string }> = {
    neutral: { bg: colors.glassFill, fg: colors.textDim, bd: colors.border },
    success: { bg: 'rgba(47,224,194,0.12)', fg: colors.success, bd: 'rgba(47,224,194,0.3)' },
    warning: { bg: 'rgba(255,200,97,0.12)', fg: colors.warning, bd: 'rgba(255,200,97,0.3)' },
    danger: { bg: 'rgba(255,107,131,0.12)', fg: colors.danger, bd: 'rgba(255,107,131,0.3)' },
    accent: { bg: 'rgba(79,140,255,0.14)', fg: colors.accent, bd: 'rgba(79,140,255,0.32)' },
  };
  const { bg, fg, bd } = map[tone];

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: bg, borderColor: bd },
      ]}
    >
      <View style={[styles.pillDot, { backgroundColor: fg }]} />
      <Text variant="label" color={fg}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// IconBadge
// ---------------------------------------------------------------------------

/** A leading list-row icon — a borderless soft-filled disc (token-avatar style). */
export function IconBadge({
  name,
  color = colors.accent,
  size = 44,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  const bg = hexA(color, 0.12);
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
        },
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.46)} color={color} strokeWidth={2} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// GlowIcon
// ---------------------------------------------------------------------------

/** A large empty-state icon — a borderless glyph in a soft radial halo. */
export function GlowIcon({
  name,
  color = colors.aqua,
  size = 92,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  // RN does not support radial-gradient backgrounds; we approximate with a
  // semi-transparent circle behind the icon.
  const bg = hexA(color, 0.15);
  return (
    <View
      style={[
        styles.glowWrap,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.4)} color={color} strokeWidth={1.7} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

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
    <View style={styles.field}>
      <Text variant="label" muted upper>
        {label}
      </Text>
      <View style={styles.fieldValue}>
        <Text
          variant={mono ? 'mono' : 'h3'}
          numeric={numeric}
          color={valueColor ?? colors.textHi}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

// ---------------------------------------------------------------------------
// PressRow
// ---------------------------------------------------------------------------

/** A tappable list row with a spring press; used for nav/actions. */
export function PressRow({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pressRow,
        { opacity: pressed && onPress ? 0.75 : 1, transform: [{ scale: pressed && onPress ? 0.97 : 1 }] },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** #rrggbb → rgba() with alpha. Handles 3- and 6-digit hex. */
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  // Expand short hex
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Pill
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs + 2,
    paddingVertical: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  // IconBadge
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // GlowIcon
  glowWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Field
  field: {
    paddingVertical: space.sm,
  },
  fieldValue: {
    marginTop: space.xs,
  },
  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: space.lg,
  },
  // PressRow
  pressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
