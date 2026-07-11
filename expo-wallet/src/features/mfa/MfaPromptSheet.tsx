import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';
import { colors, space, radius } from '@/ui/theme';
import { mfaMethodLabel, type MfaMethod } from '@/lib/account/mfa';
import { canSubmit, type MfaPromptState } from '@/lib/account/mfaFlow';

export function MfaPromptSheet({
  open,
  state,
  busy,
  onSelectMethod,
  onChangeCode,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  state: MfaPromptState;
  busy: boolean;
  onSelectMethod: (m: MfaMethod) => void;
  onChangeCode: (code: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const needsCode = state.selected === 'totp' || state.selected === 'sms';
  return (
    <Sheet open={open} onClose={onCancel}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>Verify it's you</Text>
        <Text variant="caption" color={colors.textDim}>
          This action requires two-factor authentication.
        </Text>

        {state.methods.length > 1 && (
          <View style={styles.methods}>
            {state.methods.map((m) => (
              <Pressable
                key={m}
                onPress={() => onSelectMethod(m)}
                style={[styles.pill, state.selected === m && styles.pillActive]}
              >
                <Text variant="body" color={state.selected === m ? colors.onAccent : colors.text}>
                  {mfaMethodLabel(m)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {needsCode && <OtpInput value={state.code} onChange={onChangeCode} onComplete={onSubmit} />}
        {state.selected === 'passkey' && (
          <Text variant="caption" color={colors.textDim}>Tap verify to use your passkey.</Text>
        )}

        <View style={styles.actions}>
          <Button label="Verify" onPress={onSubmit} loading={busy} disabled={!canSubmit(state)} />
          <Button label="Cancel" variant="ghost" onPress={onCancel} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  methods: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill,
    backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  actions: { gap: space.sm },
});
