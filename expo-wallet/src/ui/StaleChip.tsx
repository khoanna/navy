import React, { useRef } from 'react';
import { Pressable, StyleSheet, Animated, View } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors, radius, space } from './theme';

/** Non-blocking pill shown when a background refresh failed but data is still visible. */
export function StaleChip({ onRetry }: { onRetry: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        style={styles.chip}
        onPress={onRetry}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel="Couldn't refresh. Tap to retry"
      >
        <Icon name="refresh" size={14} color={colors.warning} strokeWidth={2} />
        <Text variant="caption" color={colors.warning}>
          Couldn't refresh · Tap to retry
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderColor: 'rgba(255,200,97,0.35)',
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: 'rgba(255,200,97,0.08)',
  },
});
