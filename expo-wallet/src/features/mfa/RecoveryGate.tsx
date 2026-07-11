import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { useOnNeedsRecovery, useRecoverEmbeddedWallet } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import { colors, space, radius } from '@/ui/theme';
import { isValidPasscode } from '@/lib/account/recovery';

/**
 * Root-mounted invisible gate.
 *
 * Registers the Privy `onNeedsRecovery` listener. When the SDK signals that
 * the embedded wallet must be recovered (new device / local state wipe) it
 * opens a bottom-sheet prompt.
 *
 * The SDK callback provides:
 *   - `recoveryMethod` — the method the wallet was set up with
 *   - `onRecovered`   — **must** be called after `recover()` resolves
 *
 * Cloud methods (icloud / google-drive) are one-tap; user-passcode shows an
 * input field. All other method values fall back to passcode entry.
 */
export function RecoveryGate() {
  const { recover } = useRecoverEmbeddedWallet();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  // Which method did the SDK tell us to use, and the callback to signal completion.
  const methodRef = useRef<string>('user-passcode');
  const onRecoveredRef = useRef<(() => void) | null>(null);

  const isCloud =
    methodRef.current === 'icloud' || methodRef.current === 'google-drive';

  const close = useCallback(() => {
    setOpen(false);
    setPass('');
    setBusy(false);
  }, []);

  // Called by the SDK when the wallet needs recovery.
  const onNeedsRecovery = useCallback(
    ({ recoveryMethod, onRecovered }: { recoveryMethod: string; onRecovered: () => void }) => {
      methodRef.current = recoveryMethod;
      onRecoveredRef.current = onRecovered;
      setOpen(true);
    },
    [],
  );

  useOnNeedsRecovery({ onNeedsRecovery });

  const run = async () => {
    setBusy(true);
    try {
      const method = methodRef.current;
      if (method === 'icloud') {
        await recover({ recoveryMethod: 'icloud' });
      } else if (method === 'google-drive') {
        await recover({ recoveryMethod: 'google-drive' });
      } else {
        // user-passcode, recovery-encryption-key, privy, privy-v2, unknown — fall back to passcode
        await recover({ recoveryMethod: 'user-passcode', password: pass });
      }
      onRecoveredRef.current?.();
      toast('Wallet recovered');
      close();
    } catch (e: unknown) {
      toast(`Recovery failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>
          Recover your wallet
        </Text>
        <Text variant="caption" color={colors.textDim}>
          {isCloud
            ? 'Restore your wallet from your secure cloud backup to continue.'
            : 'Enter your recovery passcode to restore your wallet.'}
        </Text>
        {!isCloud && (
          <TextInput
            style={styles.input}
            placeholder="Recovery passcode"
            placeholderTextColor={colors.textDim}
            secureTextEntry
            value={pass}
            onChangeText={setPass}
          />
        )}
        <Button
          label={isCloud ? 'Restore from backup' : 'Recover'}
          onPress={run}
          loading={busy}
          disabled={!isCloud && !isValidPasscode(pass)}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
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
