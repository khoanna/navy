import React, { useRef } from 'react';
import { Pressable, Animated, StyleSheet, ViewStyle, ActivityIndicator, View } from 'react-native';
import { colors, radius, space, gradients, shadow } from './theme';
import { Text } from './Text';
import { Gradient } from './Gradient';
import { Icon, IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: ViewStyle;
}

/**
 * Pressable button with a spring press-in. The primary variant rides the ocean
 * gradient; others are flat surfaces. Replaces RN's bare <Button> everywhere.
 */
export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, full = true, style }: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;

  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const tint =
    variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : colors.textHi;

  const Inner = (
    <View style={styles.row}>
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <>
          {icon && <Icon name={icon} size={18} color={tint} strokeWidth={2} />}
          <Text variant="bodyStrong" color={tint}>
            {label}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <Animated.View style={[full && styles.full, { transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => animate(0.96)}
        onPressOut={() => animate(1)}
        style={[styles.base, isDisabled && styles.disabled]}
      >
        {variant === 'primary' ? (
          <Gradient colors={gradients.ocean} style={[styles.fill, !isDisabled && shadow.accentGlow]}>
            {Inner}
          </Gradient>
        ) : (
          <View
            style={[
              styles.fill,
              variant === 'ghost' ? styles.ghost : styles.secondary,
              variant === 'danger' && styles.dangerBg,
            ]}
          >
            {Inner}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  full: { alignSelf: 'stretch' },
  base: { borderRadius: radius.pill, overflow: 'hidden' },
  disabled: { opacity: 0.45 },
  fill: {
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  secondary: { backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.borderStrong },
  ghost: { backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.border },
  dangerBg: { backgroundColor: 'rgba(255,107,131,0.12)', borderWidth: 1, borderColor: 'rgba(255,107,131,0.3)' },
});
