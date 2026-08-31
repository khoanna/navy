import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { MappedError } from '../lib/ui/mapError';
import { Button } from './Button';
import { Text } from './Text';
import { IconBadge } from './Bits';
import { colors, space } from './theme';

interface Props {
  error: MappedError;
  onRetry?: () => void;
  compact?: boolean;
}

/** Full or inline error panel with an optional Retry. Use for load failures. */
export function ErrorState({ error, onRetry, compact }: Props) {
  return (
    <View style={[styles.wrap, compact ? styles.compact : styles.full]}>
      {!compact && (
        <IconBadge name="shield" color={colors.danger} size={64} />
      )}
      <Text
        variant={compact ? 'body' : 'h3'}
        color={compact ? colors.danger : colors.textHi}
        style={styles.title}
      >
        {error.title}
      </Text>
      <Text
        variant={compact ? 'caption' : 'body'}
        color={colors.textDim}
        style={styles.detail}
      >
        {error.detail}
      </Text>
      {onRetry && (
        <View style={styles.action}>
          <Button
            variant="secondary"
            label="Try again"
            onPress={onRetry}
            full={false}
            icon="refresh"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  full: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xl,
    gap: space.lg,
  },
  compact: {
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  title: { textAlign: 'center', marginBottom: 0 },
  detail: { textAlign: 'center', maxWidth: 320 },
  action: { marginTop: space.sm },
});
