import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { colors } from './theme';
import { Icon } from './Icon';

export interface SuccessCheckProps {
  size?: number;
}

/**
 * Animated seafoam success check with a glowing disc. The web version uses CSS
 * keyframe animations (pop scale + SVG stroke-dashoffset draw-on). Here we
 * replicate with Animated: scale-in pop on mount + opacity fade for the
 * checkmark. Keeps the same prop API.
 */
export function SuccessCheck({ size = 88 }: SuccessCheckProps) {
  const scale = useRef(new Animated.Value(0.4)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pop the disc in
    Animated.spring(scale, {
      toValue: 1,
      damping: 12,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
    // Then fade the check in after a short delay
    Animated.timing(checkOpacity, {
      toValue: 1,
      duration: 200,
      delay: 200,
      useNativeDriver: true,
    }).start();
  }, [scale, checkOpacity]);

  return (
    <Animated.View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ scale }],
        },
      ]}
    >
      <Animated.View style={{ opacity: checkOpacity }}>
        <Icon name="check" size={size * 0.45} color={colors.onAccent} strokeWidth={2.6} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  disc: {
    // Seafoam gradient replicated as a flat colour (LinearGradient not trivial
    // inside Animated.View; acceptable visual approximation).
    backgroundColor: '#2FE0C2',
    alignItems: 'center',
    justifyContent: 'center',
    // Glow: iOS shadow
    shadowColor: 'rgba(47,224,194,1)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 22,
    elevation: 10,
  },
});
