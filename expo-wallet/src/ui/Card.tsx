import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors, radius, space } from './theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Tighter padding for list-like cards. */
  compact?: boolean;
  elevated?: boolean;
  /** Translucent frosted panel (Aurora Glass surfaces).
   *  Note: `backdropFilter` (blur) is not supported in React Native — the glass
   *  look is approximated with a translucent background only. */
  glass?: boolean;
}

/** A surface panel with a hairline border — the default container for content. */
export function Card({ children, style, compact, elevated, glass }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        compact ? styles.compact : styles.normal,
        glass ? styles.glass : styles.solid,
        elevated ? styles.elevated : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  solid: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  glass: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(255,255,255,0.09)',
  },
  normal: {
    padding: space.xxl,
  },
  compact: {
    padding: space.lg,
  },
  elevated: {
    // box-shadow not available in RN; shadowProps are iOS-only
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12, // Android
  },
});
