import React, { useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, Animated, StyleProp, ViewStyle, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { colors, space } from './theme';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Pad for the floating tab bar at the bottom. */
  tabSafe?: boolean;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/** Ambient aurora wash behind every screen — two soft blobs over the base bg. */
function Aurora() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="aurora_a" cx="12%" cy="0%" r="55%">
          <Stop offset="0" stopColor={colors.accent} stopOpacity="0.20" />
          <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="aurora_b" cx="95%" cy="22%" r="50%">
          <Stop offset="0" stopColor={colors.aqua} stopOpacity="0.14" />
          <Stop offset="1" stopColor={colors.aqua} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#aurora_a)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#aurora_b)" />
    </Svg>
  );
}

/**
 * Page shell: applies safe-area insets, paints the aurora background, fades the
 * content in on mount, and optionally scrolls / pull-to-refreshes.
 */
export function Screen({ children, scroll, tabSafe, padded = true, contentStyle, onRefresh, refreshing }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, useNativeDriver: true, speed: 12, bounciness: 4 }),
    ]).start();
  }, [fade, rise]);

  const pad: ViewStyle = {
    paddingTop: insets.top + space.sm,
    paddingBottom: (tabSafe ? 96 : insets.bottom + space.lg),
    paddingHorizontal: padded ? space.xl : 0,
  };

  const inner = (
    <Animated.View style={[{ flex: scroll ? 0 : 1, opacity: fade, transform: [{ translateY: rise }] }, contentStyle]}>
      {children}
    </Animated.View>
  );

  return (
    <View style={styles.root}>
      <Aurora />
      {scroll ? (
        <ScrollView
          contentContainerStyle={pad}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? <RefreshControl tintColor={colors.aqua} refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
          }
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={[styles.flex, pad]}>{inner}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
});
