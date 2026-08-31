import React, { useRef, useEffect } from 'react';
import {
  Pressable,
  View,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ViewStyle,
  Animated,
} from 'react-native';
import { colors, radius, space, gradients } from './theme';
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
  /** When true (default) the button stretches to full width. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Pressable button with a scale press effect. Primary rides the ocean gradient;
 * others are flat surfaces.
 *
 * Features:
 * - Animated press feedback with spring effect
 * - Loading state with spinner
 * - Disabled state with visual feedback
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  full = true,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (!isDisabled) {
      Animated.spring(scaleAnim, {
        toValue: 0.96,
        useNativeDriver: true,
        speed: 50,
        bounciness: 4,
      }).start();
    }
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const tint =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'danger'
      ? colors.danger
      : colors.textHi;

  const Inner = (
    <View style={styles.inner}>
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <>
          {icon && <Icon name={icon} size={18} color={tint} strokeWidth={2} />}
          <Text variant="bodyStrong" color={isDisabled ? colors.textDim : tint}>
            {label}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, full && styles.fullWidth]}>
      <Pressable
        onPress={isDisabled ? undefined : onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.wrapper,
          isDisabled && styles.disabled,
          pressed && !isDisabled && styles.pressed,
          style,
        ]}
      >
        {variant === 'primary' ? (
          <Gradient colors={gradients.ocean} style={styles.fill}>
            {Inner}
          </Gradient>
        ) : (
          <View
            style={[
              styles.fill,
              variant === 'ghost' ? styles.ghost : styles.secondary,
              variant === 'danger' ? styles.dangerBg : null,
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
  wrapper: {
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  fill: {
    height: 54,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
  secondary: {
    backgroundColor: colors.surfaceHi,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ghost: {
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dangerBg: {
    backgroundColor: 'rgba(255,107,131,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,131,0.3)',
  },
});
