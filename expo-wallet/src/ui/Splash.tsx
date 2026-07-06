import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { colors, gradients, space, radius } from './theme';
import { Gradient } from './Gradient';
import { Icon } from './Icon';
import { Text } from './Text';

/**
 * Full-screen Navy loading splash — shown while auth/session state settles, so
 * protected screens never flash before we know where to route. Ports the web
 * Splash which pulses the brand logo/icon using a CSS keyframe animation.
 */
export function Splash() {
  // Pulse animation: replicate CSS `navy-pulse` (scale + opacity)
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  return (
    <View style={styles.root}>
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <Gradient
          colors={gradients.ocean}
          style={styles.logoBox}
        >
          <Icon name="wallet" size={38} color={colors.onAccent} strokeWidth={2} />
        </Gradient>
      </Animated.View>
      <Text variant="label" muted upper style={styles.wordmark}>
        Navy
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBox: {
    width: 84,
    height: 84,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    marginTop: space.xxl,
  },
});
