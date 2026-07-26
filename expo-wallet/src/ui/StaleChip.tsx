import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radius, space } from './theme';

/** Small non-blocking pill shown when a background refresh failed but data is still visible. */
export function StaleChip({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable style={styles.chip} onPress={onRetry} accessibilityRole="button">
      <Text variant="caption" color={colors.textDim}>Couldn't refresh · Retry</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
});
