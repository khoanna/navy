import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Redirect } from 'expo-router';
import { usePrivy } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';
import { colors, gradients } from '../src/ui/theme';
import { Gradient } from '../src/ui/Gradient';
import { Icon } from '../src/ui/Icon';
import { Text } from '../src/ui/Text';

export default function Index() {
  const { isReady } = usePrivy();
  const { session, initializing } = useNavySession();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  if (!isReady || initializing) {
    const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
    const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
    return (
      <View style={styles.c}>
        <Animated.View style={{ transform: [{ scale }], opacity }}>
          <Gradient colors={gradients.ocean} style={styles.logo}>
            <Icon name="wallet" size={38} color={colors.onAccent} strokeWidth={2} />
          </Gradient>
        </Animated.View>
        <Text variant="label" muted upper style={{ marginTop: 24 }}>
          Navy
        </Text>
      </View>
    );
  }
  return <Redirect href={session ? '/home' : '/login'} />;
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  logo: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
