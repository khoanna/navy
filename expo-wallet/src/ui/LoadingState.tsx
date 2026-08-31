import React from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { Text } from './Text';
import { colors, space } from './theme';

interface LoadingStateProps {
  /** Optional loading message */
  message?: string;
  /** Size of the spinner (default: 'large') */
  size?: 'small' | 'large';
  /** Full screen centering or inline */
  fullScreen?: boolean;
}

/**
 * Reusable loading state component.
 * Shows an ActivityIndicator with optional message.
 */
export function LoadingState({
  message,
  size = 'large',
  fullScreen = false,
}: LoadingStateProps) {
  if (fullScreen) {
    return (
      <View style={styles.fullScreen}>
        <ActivityIndicator size={size} color={colors.aqua} />
        {message && (
          <Text variant="body" color={colors.textDim} style={styles.message}>
            {message}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.inline}>
      <ActivityIndicator size={size} color={colors.aqua} />
      {message && (
        <Text variant="caption" color={colors.textDim} style={styles.inlineMessage}>
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  inline: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    gap: space.sm,
  },
  message: {
    textAlign: 'center',
    marginTop: space.sm,
  },
  inlineMessage: {
    marginTop: space.xs,
  },
});
