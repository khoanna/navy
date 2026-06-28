import React, { useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, shadow } from '../../src/ui/theme';
import { Icon, IconName } from '../../src/ui/Icon';
import { Text } from '../../src/ui/Text';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'home', label: 'Wallet', icon: 'home' },
  { name: 'scan', label: 'Scan', icon: 'scan' },
  { name: 'farming', label: 'Earn', icon: 'sprout' },
  { name: 'history', label: 'Activity', icon: 'clock' },
];

function TabItem({ focused, label, icon, onPress }: { focused: boolean; label: string; icon: IconName; onPress: () => void }) {
  const lift = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(lift, { toValue: focused ? 1 : 0, useNativeDriver: true, speed: 20, bounciness: 10 }).start();
  }, [focused, lift]);
  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  return (
    <Pressable onPress={onPress} style={styles.item} hitSlop={8}>
      <Animated.View style={[styles.itemInner, focused && styles.itemActive, { transform: [{ translateY }] }]}>
        <Icon name={icon} size={22} color={focused ? colors.aqua : colors.textMute} strokeWidth={focused ? 2.2 : 1.8} />
      </Animated.View>
      <Text variant="label" color={focused ? colors.textHi : colors.textMute} style={styles.itemLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Props come from expo-router's <Tabs tabBar>; we only read `state`/`navigation`.
 * Typed loosely because @react-navigation/bottom-tabs isn't a direct dep.
 */
function NavyTabBar({ state, navigation }: { state: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, space.md) }]} pointerEvents="box-none">
      <View style={styles.bar}>
        {state.routes.map((route: { key: string; name: string }, i: number) => {
          const meta = TABS.find((t) => t.name === route.name);
          if (!meta) return null;
          const focused = state.index === i;
          return (
            <TabItem
              key={route.key}
              focused={focused}
              label={meta.label}
              icon={meta.icon}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <NavyTabBar {...props} />} screenOptions={{ headerShown: false }}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(17,27,46,0.96)',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    marginHorizontal: space.xl,
    ...shadow.card,
  },
  item: { alignItems: 'center', paddingHorizontal: space.lg, gap: 3 },
  itemInner: {
    width: 44,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActive: { backgroundColor: 'rgba(47,224,194,0.12)' },
  itemLabel: { fontSize: 10, letterSpacing: 0.5 },
});
