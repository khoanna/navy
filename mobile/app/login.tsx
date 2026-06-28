import React, { useState } from 'react';
import { View, TextInput, Alert, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useLoginWithOAuth, useLoginWithEmail, useLoginWithSMS } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';
import { Screen } from '../src/ui/Screen';
import { Text } from '../src/ui/Text';
import { Button } from '../src/ui/Button';
import { Gradient } from '../src/ui/Gradient';
import { Icon } from '../src/ui/Icon';
import { colors, gradients, radius, space } from '../src/ui/theme';

type Channel = 'email' | 'phone';

export default function Login() {
  const router = useRouter();
  const { establishFromPrivy } = useNavySession();
  const { login: loginOAuth } = useLoginWithOAuth();
  const email = useLoginWithEmail();
  const sms = useLoginWithSMS();

  const [channel, setChannel] = useState<Channel>('email');
  const [emailAddr, setEmailAddr] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert(label, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await establishFromPrivy();
    router.replace('/home');
  };

  const social = (provider: 'google' | 'apple') =>
    run(async () => {
      await loginOAuth({ provider });
      await finish();
    }, 'Social login failed');

  const sendCode = () =>
    run(async () => {
      if (channel === 'email') await email.sendCode({ email: emailAddr });
      else await sms.sendCode({ phone });
      setSent(true);
    }, 'Could not send code');

  const verify = () =>
    run(async () => {
      if (channel === 'email') await email.loginWithCode({ code, email: emailAddr });
      else await sms.loginWithCode({ code, phone });
      await finish();
    }, 'Verification failed');

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Brand mark */}
        <View style={styles.brand}>
          <Gradient colors={gradients.ocean} style={styles.logo}>
            <Icon name="wallet" size={30} color={colors.onAccent} strokeWidth={2} />
          </Gradient>
          <View style={{ marginTop: space.xxl }}>
            <Text variant="display" color={colors.textHi}>
              Navy
            </Text>
            <Text variant="h3" dim style={{ marginTop: space.xs }}>
              Your wallet for the open ocean.
            </Text>
          </View>
        </View>

        {/* Social */}
        <View style={{ gap: space.md, marginTop: space.huge }}>
          <Button label="Continue with Google" icon="shield" variant="secondary" onPress={() => social('google')} />
          <Button label="Continue with Apple" icon="shield" variant="secondary" onPress={() => social('apple')} />
        </View>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text variant="label" muted upper>
            or
          </Text>
          <View style={styles.line} />
        </View>

        {/* Channel switch */}
        <View style={styles.segment}>
          {(['email', 'phone'] as Channel[]).map((c) => (
            <Pressable
              key={c}
              onPress={() => {
                setChannel(c);
                setSent(false);
                setCode('');
              }}
              style={[styles.segItem, channel === c && styles.segActive]}
            >
              <Text variant="bodyStrong" color={channel === c ? colors.textHi : colors.textMute}>
                {c === 'email' ? 'Email' : 'Phone'}
              </Text>
            </Pressable>
          ))}
        </View>

        {channel === 'email' ? (
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMute}
            autoCapitalize="none"
            keyboardType="email-address"
            value={emailAddr}
            onChangeText={setEmailAddr}
          />
        ) : (
          <TextInput
            style={styles.input}
            placeholder="+1 555 123 4567"
            placeholderTextColor={colors.textMute}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
        )}

        {sent && (
          <TextInput
            style={[styles.input, styles.code]}
            placeholder="• • • • • •"
            placeholderTextColor={colors.textMute}
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
            maxLength={6}
          />
        )}

        <View style={{ marginTop: space.lg }}>
          {!sent ? (
            <Button label="Send code" icon="send" loading={busy} onPress={sendCode} />
          ) : (
            <Button label="Verify & sign in" icon="check" loading={busy} onPress={verify} />
          )}
        </View>

        {sent && (
          <Pressable onPress={sendCode} style={{ marginTop: space.lg, alignSelf: 'center' }}>
            <Text variant="caption" color={colors.accent}>
              Resend code
            </Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { marginTop: space.huge },
  logo: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.xxl },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    marginBottom: space.md,
  },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: space.md, borderRadius: radius.sm },
  segActive: { backgroundColor: colors.surfaceHi },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    color: colors.textHi,
    fontSize: 16,
    marginTop: space.sm,
  },
  code: { textAlign: 'center', letterSpacing: 8, fontSize: 22, fontWeight: '700' },
});
