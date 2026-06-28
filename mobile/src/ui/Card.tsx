import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, radius, space, shadow } from './theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Tighter padding for list-like cards. */
  compact?: boolean;
  elevated?: boolean;
}

/** A surface panel with a hairline border — the default container for content. */
export function Card({ children, style, compact, elevated }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        { padding: compact ? space.lg : space.xxl },
        elevated && shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
