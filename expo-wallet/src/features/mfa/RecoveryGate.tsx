import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { useOnNeedsRecovery, useRecoverEmbeddedWallet } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';
import { colors, space, radius } from '@/ui/theme';
import { isValidPasscode } from '@/lib/account/recovery';

const UNSUPPORTED_METHOD_MESSAGE =
  "This wallet uses a recovery method this app can't restore. Contact support.";

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
 * Supported methods: `user-passcode` (shows passcode input), `icloud` and
 * `google-drive` (one-tap cloud restore). Any other value (`recovery-encryption-key`,
 * `privy`, `privy-v2`, …) is considered unsupported — the sheet explains this
 * instead of attempting a passcode recovery that would always fail.
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

  const method = methodRef.current;
  const isCloud = method === 'icloud' || method === 'google-drive';
  const supported =
    method === 'user-passcode' || method === 'icloud' || method === 'google-drive';

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
      if (method === 'icloud') {
        await recover({ recoveryMethod: 'icloud' });
      } else if (method === 'google-drive') {
        await recover({ recoveryMethod: 'google-drive' });
      } else if (method === 'user-passcode') {
        await recover({ recoveryMethod: 'user-passcode', password: pass });
      } else {
        // recovery-encryption-key, privy, privy-v2, or unknown — cannot recover here.
        toast(UNSUPPORTED_METHOD_MESSAGE);
        setBusy(false);
        return;
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
          {!supported
            ? UNSUPPORTED_METHOD_MESSAGE
            : isCloud
              ? 'Restore your wallet from your secure cloud backup to continue.'
              : 'Enter your recovery passcode to restore your wallet.'}
        </Text>
        {supported && !isCloud && (
          <TextInput
            style={styles.input}
            placeholder="Recovery passcode"
            placeholderTextColor={colors.textDim}
            secureTextEntry
            value={pass}
            onChangeText={setPass}
          />
        )}
        {supported ? (
          <Button
            label={isCloud ? 'Restore from backup' : 'Recover'}
            onPress={run}
            loading={busy}
            disabled={!isCloud && !isValidPasscode(pass)}
          />
        ) : (
          <Button label="Close" onPress={close} />
        )}
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
