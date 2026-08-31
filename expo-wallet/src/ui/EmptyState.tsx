import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { GlowIcon, PressRow } from './Bits';
import { colors, radius, space } from './theme';
import type { IconName } from './Icon';

interface EmptyStateProps {
  /** Icon name for the empty state */
  icon: IconName;
  /** Primary title */
  title: string;
  /** Optional description text */
  description?: string;
  /** Optional action button */
  action?: {
    label: string;
    onPress: () => void;
  };
  /** Icon color (default: textDim) */
  iconColor?: string;
  /** Icon size (default: 72) */
  iconSize?: number;
}

/**
 * Reusable empty state component for lists, searches, and sections.
 * Shows an icon, title, optional description, and optional action button.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  iconColor = colors.textDim,
  iconSize = 72,
}: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <GlowIcon name={icon} color={iconColor} size={iconSize} />
      <Text variant="h3" color={colors.text} center style={styles.title}>
        {title}
      </Text>
      {description && (
        <Text variant="caption" dim center style={styles.description}>
          {description}
        </Text>
      )}
      {action && (
        <PressRow onPress={action.onPress} style={styles.actionWrap}>
          <Text variant="bodyStrong" color={colors.aqua}>
            {action.label}
          </Text>
        </PressRow>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: space.xxxl,
    paddingHorizontal: space.xl,
  },
  title: {
    marginTop: space.lg,
  },
  description: {
    marginTop: space.sm,
    maxWidth: 280,
  },
  actionWrap: {
    marginTop: space.lg,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    backgroundColor: 'rgba(47,224,194,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(47,224,194,0.25)',
    borderRadius: radius.pill,
  },
});
