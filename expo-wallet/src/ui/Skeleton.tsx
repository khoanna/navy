import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle, StyleSheet } from 'react-native';
import { radius } from './theme';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  /** Fully round (pill) ends. */
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Shimmering placeholder block for loading balances/lists. The web version uses
 * a CSS moving-gradient shimmer; React Native does not support background-size
 * animations, so we replicate the shimmer with an opacity pulse (same visual
 * frequency: 1.4 s per cycle).
 */
export function Skeleton({ width = '100%', height = 16, round, style }: SkeletonProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, [anim]);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.1] });

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width: width as ViewStyle['width'],
          height: height as ViewStyle['height'],
          borderRadius: round ? radius.pill : radius.sm,
          opacity,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#fff',
  },
});
