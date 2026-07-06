import React from 'react';
import {
  View,
  ScrollView,
  RefreshControl,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

/**
 * Page shell for Expo/React Native. Applies phone-frame padding via SafeAreaView
 * and optionally wraps content in a ScrollView. Faithfully ports the web Screen
 * prop API (scroll, tabSafe, padded, contentStyle, onRefresh, refreshing).
 */
export function Screen({
  children,
  scroll,
  tabSafe,
  padded = true,
  contentStyle,
  onRefresh,
  refreshing = false,
}: ScreenProps) {
  const contentPad: ViewStyle = {
    paddingTop: space.lg,
    paddingBottom: tabSafe ? 96 + space.lg : space.lg,
    paddingLeft: padded ? space.xl : 0,
    paddingRight: padded ? space.xl : 0,
  };

  const content = (
    <View style={[styles.inner, contentPad, contentStyle]}>{children}</View>
  );

  if (scroll) {
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[contentPad, contentStyle]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.aqua}
                colors={[colors.aqua]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return <SafeAreaView style={styles.root}>{content}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  inner: {
    flex: 1,
    position: 'relative',
  },
});
