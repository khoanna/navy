import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle, StyleSheet, View } from 'react-native';
import { colors, radius } from './theme';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  /** Fully round (pill) ends. */
  round?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Avatar circle shape */
  circle?: boolean;
  /** Shimmer animation speed in ms (default 1200ms per cycle) */
  speed?: number;
}

/**
 * Shimmering placeholder block for loading balances/lists.
 * Uses a gradient-like animation to simulate the shimmer effect.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  round,
  circle,
  style,
  speed = 1200,
}: SkeletonProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: speed,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: speed,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [shimmerAnim, speed]);

  // Interpolate background color for shimmer effect
  const bgColor = shimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [
      'rgba(255,255,255,0.06)',
      'rgba(255,255,255,0.12)',
      'rgba(255,255,255,0.06)',
    ],
  });

  const borderRadius = circle
    ? (typeof height === 'number' ? height / 2 : 20)
    : round
    ? radius.pill
    : radius.sm;

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width: width as ViewStyle['width'],
          height: height as ViewStyle['height'],
          borderRadius,
          backgroundColor: bgColor,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
