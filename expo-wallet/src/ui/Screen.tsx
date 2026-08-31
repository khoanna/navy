import React from 'react';
import {
  View,
  ScrollView,
  RefreshControl,
  StyleSheet,
  StyleProp,
  ViewStyle,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
  /** Show loading overlay */
  loading?: boolean;
  /** Loading message */
  loadingMessage?: string;
}

/**
 * Page shell for Expo/React Native. Applies phone-frame padding via SafeAreaView
 * and optionally wraps content in a ScrollView. Faithfully ports the web Screen
 * prop API (scroll, tabSafe, padded, contentStyle, onRefresh, refreshing).
 *
 * Supports:
 * - Pull-to-refresh with custom tint
 * - Loading overlay with optional message
 * - Keyboard avoiding behavior
 */
export function Screen({
  children,
  scroll,
  tabSafe,
  padded = true,
  contentStyle,
  onRefresh,
  refreshing = false,
  loading = false,
  loadingMessage,
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

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView
          style={styles.loadingWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ActivityIndicator size="large" color={colors.aqua} />
          {loadingMessage && (
            <View style={styles.loadingMessage}>
              <View style={styles.loadingText}>
                <ActivityIndicator size="small" color={colors.textDim} />
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

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
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  loadingMessage: {
    marginTop: space.sm,
  },
  loadingText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
