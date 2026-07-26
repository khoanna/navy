import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { MappedError } from '../lib/ui/mapError';
import { Button } from './Button';
import { Text } from './Text';
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
      <Text variant={compact ? 'body' : 'h2'} color={colors.textHi} style={styles.title}>
        {error.title}
      </Text>
      <Text variant="caption" color={colors.textDim} style={styles.detail}>
        {error.detail}
      </Text>
      {onRetry && (
        <View style={styles.action}>
          <Button variant="secondary" label="Retry" onPress={onRetry} full={false} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  full: { flex: 1, justifyContent: 'center', padding: space.xl },
  compact: { paddingVertical: space.lg, paddingHorizontal: space.md },
  title: { textAlign: 'center', marginBottom: space.xs },
  detail: { textAlign: 'center', maxWidth: 320 },
  action: { marginTop: space.lg },
});
