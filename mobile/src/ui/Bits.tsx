import React, { useRef } from 'react';
import { View, Pressable, Animated, StyleSheet, ViewStyle, StyleProp } from 'react-native';
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
    <View style={[styles.pill, { backgroundColor: map.bg, borderColor: map.bd }]}>
      <View style={[styles.dot, { backgroundColor: map.fg }]} />
      <Text variant="label" color={map.fg}>
        {label}
      </Text>
    </View>
  );
}

/** A circular icon chip with a tinted ground. */
export function IconBadge({ name, color = colors.accent, size = 44 }: { name: IconName; color?: string; size?: number }) {
  return (
    <View
      style={[
        styles.iconBadge,
        { width: size, height: size, borderRadius: size / 3, backgroundColor: hexA(color, 0.14), borderColor: hexA(color, 0.28) },
      ]}
    >
      <Icon name={name} size={size * 0.5} color={color} strokeWidth={2} />
    </View>
  );
}

/** Label-over-value field, used in detail cards. */
export function Field({ label, value, mono, numeric, valueColor }: { label: string; value: string; mono?: boolean; numeric?: boolean; valueColor?: string }) {
  return (
    <View style={styles.field}>
      <Text variant="label" muted upper>
        {label}
      </Text>
      <Text
        variant={mono ? 'mono' : 'h3'}
        numeric={numeric}
        color={valueColor ?? colors.textHi}
        selectable={mono}
        style={{ marginTop: space.xs }}
      >
        {value}
      </Text>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/** A tappable list row with a spring press; used for nav/actions. */
export function PressRow({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={() => animate(0.97)} onPressOut={() => animate(1)} style={[styles.pressRow, style]}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** #rrggbb + alpha → rgba(). */
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  iconBadge: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  field: { paddingVertical: space.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.lg },
  pressRow: { flexDirection: 'row', alignItems: 'center' },
});
