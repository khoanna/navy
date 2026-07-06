import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useMfaEnrollment } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';
import { useToast } from '@/ui/Toast';
import { isValidEnrollCode, otpauthSecretGroups } from '@/lib/account/mfa';
import { colors, radius, space } from '@/ui/theme';

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
  const { initMfaEnrollment, submitMfaEnrollment } = useMfaEnrollment();
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [secret, setSecret] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const started = !!secret || !!authUrl;

  const reset = () => {
    setAuthUrl(undefined);
    setSecret(undefined);
    setCode('');
    setBusy(false);
  };
  const close = () => {
    reset();
    onClose();
  };

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

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>
          Two-factor authentication
        </Text>
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
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  qr: {
    alignSelf: 'center',
    padding: space.md,
    backgroundColor: 'white',
    borderRadius: radius.md,
  },
  secretBox: { gap: space.sm, alignItems: 'center' },
});
