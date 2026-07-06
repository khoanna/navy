import React, { useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { normalizeOtp } from '@/lib/ui/otp';
import { Text } from './Text';
import { colors, radius } from './theme';

export interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  onComplete?: (code: string) => void;
}

/**
 * Six-box one-time-code field. A hidden TextInput accepts input while a row of
 * styled boxes displays each digit, faithfully porting the web component.
 */
export function OtpInput({ value, onChange, length = 6, onComplete }: OtpInputProps) {
  const inputRef = useRef<TextInput>(null);
  const cells = Array.from({ length }, (_, i) => i);

  const handle = (raw: string) => {
    const next = normalizeOtp(raw, length);
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.container}>
      {/* Hidden input that actually receives keystrokes */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handle}
        keyboardType="number-pad"
        maxLength={length}
        style={styles.hiddenInput}
        caretHidden
        contextMenuHidden
        accessible
        accessibilityLabel="One-time code"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />
      {/* Visual digit boxes */}
      <View style={styles.row}>
        {cells.map((i) => {
          const active = i === value.length;
          return (
            <View
              key={i}
              style={[
                styles.cell,
                { borderColor: active ? colors.accent : colors.borderStrong },
              ]}
            >
              <Text variant="h2" color={colors.textHi}>
                {value[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  hiddenInput: {
    position: 'absolute',
    // Move it off-screen so it isn't visible but still receives focus/input.
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  cell: {
    width: 44,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
