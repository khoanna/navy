import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useMfaEnrollment, usePrivy } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';
import { useToast } from '@/ui/Toast';
import { isValidEnrollCode, otpauthSecretGroups } from '@/lib/account/mfa';
import { describeLinkedAccounts } from '@/lib/account/linkedAccounts';
import { colors, radius, space } from '@/ui/theme';

type PickMethod = 'totp' | 'passkey';

export function MfaEnrollSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { user } = usePrivy();
  const { initMfaEnrollment, submitMfaEnrollment } = useMfaEnrollment();

  const [pickMethod, setPickMethod] = useState<PickMethod>('totp');
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [secret, setSecret] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const started = !!secret || !!authUrl;

  const passkeyCredentialIds = describeLinkedAccounts(user)
    .filter((r) => r.provider === 'passkey')
    .map((r) => r.unlinkId);

  const reset = () => {
    setAuthUrl(undefined);
    setSecret(undefined);
    setCode('');
    setBusy(false);
    setPickMethod('totp');
  };
  const close = () => {
    reset();
    onClose();
  };

  // ── TOTP flow ────────────────────────────────────────────────────────────
  const begin = async () => {
    setBusy(true);
    try {
      const res = await initMfaEnrollment({ method: 'totp' });
      setSecret(res?.secret);
      setAuthUrl(res?.authUrl);
    } catch (e) {
      toast(`Could not start 2FA: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (c: string) => {
    setBusy(true);
    try {
      await submitMfaEnrollment({ method: 'totp', code: c });
      toast('Two-factor authentication enabled');
      reset();
      onDone();
    } catch (e) {
      toast(`Verification failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    await Clipboard.setStringAsync(secret);
    toast('Secret copied');
  };

  // ── Passkey flow ─────────────────────────────────────────────────────────
  const enrollPasskey = async () => {
    if (passkeyCredentialIds.length === 0) {
      toast('Add a passkey in Linked accounts first, then enable it as 2FA.');
      return;
    }
    setBusy(true);
    try {
      await initMfaEnrollment({ method: 'passkey' });
      await submitMfaEnrollment({ method: 'passkey', credentialIds: passkeyCredentialIds });
      toast('Passkey two-factor enabled');
      reset();
      onDone();
    } catch (e: unknown) {
      toast(`Could not enable passkey 2FA: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>
          Two-factor authentication
        </Text>

        {/* Method picker pills */}
        <View style={styles.pills}>
          {(['totp', 'passkey'] as PickMethod[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                setPickMethod(m);
                // Reset TOTP state when switching away
                if (m !== 'totp') {
                  setAuthUrl(undefined);
                  setSecret(undefined);
                  setCode('');
                }
              }}
              style={[styles.pill, pickMethod === m && styles.pillActive]}
            >
              <Text variant="body" color={pickMethod === m ? colors.onAccent : colors.text}>
                {m === 'totp' ? 'Authenticator app' : 'Passkey'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* TOTP flow */}
        {pickMethod === 'totp' && (
          <>
            {!started ? (
              <>
                <Text variant="caption" color={colors.textDim}>
                  Add a second factor with an authenticator app (Google Authenticator, 1Password, etc.).
                </Text>
                <Button label="Begin setup" loading={busy} onPress={begin} />
              </>
            ) : (
              <>
                <Text variant="caption" color={colors.textDim}>
                  Scan this in your authenticator app, or enter the key manually.
                </Text>
                {authUrl ? (
                  <View style={styles.qr}>
                    <QRCode value={authUrl} size={180} backgroundColor="white" />
                  </View>
                ) : null}
                {secret ? (
                  <View style={styles.secretBox}>
                    <Text variant="mono" color={colors.textHi}>
                      {otpauthSecretGroups(secret)}
                    </Text>
                    <Button label="Copy key" variant="secondary" onPress={copySecret} />
                  </View>
                ) : null}
                <Text
                  variant="caption"
                  color={colors.textDim}
                  style={{ marginTop: space.md }}
                >
                  Enter the 6-digit code from your app
                </Text>
                <OtpInput value={code} onChange={setCode} onComplete={confirm} />
                <View style={{ marginTop: space.lg }}>
                  <Button
                    label="Verify & enable"
                    loading={busy}
                    disabled={!isValidEnrollCode(code)}
                    onPress={() => confirm(code)}
                  />
                </View>
              </>
            )}
          </>
        )}

        {/* Passkey flow */}
        {pickMethod === 'passkey' && (
          <>
            <Text variant="caption" color={colors.textDim}>
              Use a passkey already linked to your account as a second factor. You must add a
              passkey in Linked accounts before enabling passkey 2FA.
            </Text>
            {passkeyCredentialIds.length === 0 && (
              <Text variant="caption" color={colors.textDim}>
                No passkeys linked yet. Go to Linked accounts to add one first.
              </Text>
            )}
            <Button
              label="Enable passkey 2FA"
              loading={busy}
              disabled={passkeyCredentialIds.length === 0 || busy}
              onPress={enrollPasskey}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  pills: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  qr: {
    alignSelf: 'center',
    padding: space.md,
    backgroundColor: 'white',
    borderRadius: radius.md,
  },
  secretBox: { gap: space.sm, alignItems: 'center' },
});
