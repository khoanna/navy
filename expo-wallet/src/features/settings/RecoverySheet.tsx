import React, { useState } from 'react';
import { View, StyleSheet, TextInput, Platform, Pressable } from 'react-native';
import { useSetEmbeddedWalletRecovery } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import { colors, space, radius } from '@/ui/theme';
import {
  availableRecoveryMethods,
  recoveryMethodLabel,
  isValidPasscode,
  passcodesMatch,
  type RecoveryMethod,
} from '@/lib/account/recovery';

export function RecoverySheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { setRecovery } = useSetEmbeddedWalletRecovery();
  const toast = useToast();
  const methods = availableRecoveryMethods(Platform.OS);
  const [method, setMethod] = useState<RecoveryMethod>(methods[0]);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMethod(methods[0]);
    setPass('');
    setConfirm('');
    setBusy(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const isPasscode = method === 'user-passcode';
  const canSave = isPasscode ? passcodesMatch(pass, confirm) : true;

  const save = async () => {
    setBusy(true);
    try {
      if (method === 'user-passcode') {
        await setRecovery({ recoveryMethod: 'user-passcode', password: pass });
      } else if (method === 'icloud') {
        await setRecovery({ recoveryMethod: 'icloud' });
      } else {
        await setRecovery({ recoveryMethod: 'google-drive' });
      }
      toast('Recovery method set');
      reset();
      onDone();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      toast(`Could not set recovery: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>
          Wallet recovery
        </Text>
        <Text variant="caption" color={colors.textDim}>
          Choose how to recover your wallet on a new device.
        </Text>

        <View style={styles.methods}>
          {methods.map((m) => (
            <Pressable
              key={m}
              onPress={() => setMethod(m)}
              style={[styles.methodPill, method === m && styles.methodPillActive]}
            >
              <Text variant="body" color={method === m ? colors.onAccent : colors.text}>
                {recoveryMethodLabel(m)}
              </Text>
            </Pressable>
          ))}
        </View>

        {isPasscode && (
          <View style={styles.fields}>
            <TextInput
              style={styles.input}
              placeholder="Recovery passcode (min 8 chars)"
              placeholderTextColor={colors.textMute}
              secureTextEntry
              value={pass}
              onChangeText={setPass}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm passcode"
              placeholderTextColor={colors.textMute}
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
            />
            {pass.length > 0 && !isValidPasscode(pass) && (
              <Text variant="caption" color={colors.danger}>
                Passcode must be at least 8 characters.
              </Text>
            )}
          </View>
        )}

        <Button label="Set recovery" onPress={save} loading={busy} disabled={!canSave} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  methods: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  methodPill: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  fields: { gap: space.sm },
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textHi,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 16,
  },
});
