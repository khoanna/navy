import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { useLinkEmail } from '@privy-io/expo';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';
import { useToast } from '@/ui/Toast';
import { isValidEnrollCode } from '@/lib/account/mfa';
import { colors, radius, space } from '@/ui/theme';

export function LinkEmailSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { sendCode, linkWithCode } = useLinkEmail();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => { setEmail(''); setCode(''); setSent(false); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const send = async () => {
    setBusy(true);
    try { await sendCode({ email }); setSent(true); }
    catch (e) { toast(`Could not send code: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const verify = async (c: string) => {
    setBusy(true);
    try { await linkWithCode({ code: c }); toast('Email linked'); reset(); onDone(); }
    catch (e) { toast(`Link failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={styles.wrap}>
        <Text variant="h3" color={colors.textHi}>Link email</Text>
        {!sent ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Button label="Send code" loading={busy} disabled={!email} onPress={send} />
          </>
        ) : (
          <>
            <Text variant="caption" color={colors.textDim} style={{ marginBottom: space.md }}>
              Enter the code sent to {email}
            </Text>
            <OtpInput value={code} onChange={setCode} onComplete={verify} />
            <View style={{ marginTop: space.lg }}>
              <Button label="Verify & link" loading={busy} disabled={!isValidEnrollCode(code)} onPress={() => verify(code)} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  input: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    color: colors.textHi,
    fontSize: 16,
  },
});
