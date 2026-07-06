import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useLoginWithEmail, useLoginWithOAuth } from '@privy-io/expo';
import { useLoginWithPasskey } from '@privy-io/expo/passkey';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useToast } from '@/ui/Toast';
import { Splash } from '@/ui/Splash';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { OtpInput } from '@/ui/OtpInput';
import { isComplete } from '@/lib/ui/otp';
import { RELYING_PARTY } from '@/lib/config/privy';
import { colors, gradients, radius, space } from '@/ui/theme';

export default function Login() {
  const router = useRouter();
  const toast = useToast();
  const { session, initializing, establishFromPrivy } = useNavySession();

  // useLoginWithOAuth: { login(input: { provider: OAuthProviderID, ... }) → Promise<User|undefined>, state }
  const { login: loginWithOAuth } = useLoginWithOAuth();
  // useLoginWithEmail: { sendCode({ email }) → Promise<...>, loginWithCode({ code, email? }) → Promise<User|undefined>, state }
  const email = useLoginWithEmail();
  // useLoginWithPasskey: { loginWithPasskey({ relyingParty }) → Promise<User|undefined>, state }
  const { loginWithPasskey } = useLoginWithPasskey();

  const [emailAddr, setEmailAddr] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Already signed in (incl. returning from an OAuth flow that auto-established
  // the session): never show the login form — go straight home.
  useEffect(() => {
    if (!initializing && session) router.replace('/home');
  }, [initializing, session, router]);

  const finish = async () => {
    await establishFromPrivy();
    router.replace('/home');
  };

  // Passkey: loginWithPasskey requires a relyingParty (the app's associated domain).
  // On Expo this triggers the native passkey sheet.
  const passkey = () =>
    run(async () => {
      await loginWithPasskey({ relyingParty: RELYING_PARTY });
      await finish();
    }, 'Passkey login failed');

  // OAuth on Expo: login({ provider }) opens an in-app browser via expo-web-browser.
  // The promise resolves inline (not redirect-based), so we call finish() after.
  const social = (provider: 'google' | 'apple') =>
    run(async () => {
      await loginWithOAuth({ provider });
      await finish();
    }, 'Social login failed');

  const sendCode = () =>
    run(async () => {
      await email.sendCode({ email: emailAddr });
      setSent(true);
    }, 'Could not send code');

  const verify = (c: string) =>
    run(async () => {
      await email.loginWithCode({ code: c });
      await finish();
    }, 'Verification failed');

  // Hold the splash while the redirect above fires, so the form never flashes.
  if (initializing || session) return <Splash />;

  return (
    <Screen scroll>
      {/* Brand header */}
      <View style={styles.brand}>
        <Gradient
          colors={gradients.ocean}
          glow
          style={styles.logoContainer}
        >
          <Icon name="wallet" size={30} color={colors.onAccent} strokeWidth={2} />
        </Gradient>
        <View style={styles.brandText}>
          <Text variant="display" color={colors.textHi}>Navy</Text>
          <Text variant="h3" dim style={styles.tagline}>
            Your wallet for the open ocean.
          </Text>
        </View>
      </View>

      {!sent ? (
        <>
          {/* Email + send code block */}
          <View style={styles.emailBlock}>
            <Text variant="label" muted upper>Sign in with</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMute}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              value={emailAddr}
              onChangeText={setEmailAddr}
            />
            <View style={styles.sendBtn}>
              <Button
                label="Send code"
                icon="send"
                loading={busy}
                disabled={!emailAddr}
                onPress={sendCode}
              />
            </View>
          </View>

          {/* "or" divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text variant="label" muted upper>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Social / passkey buttons */}
          <View style={styles.altButtons}>
            <Button
              label="Continue with passkey"
              icon="shield"
              variant="secondary"
              onPress={passkey}
            />
            <Button
              label="Continue with Google"
              icon="shield"
              variant="secondary"
              onPress={() => social('google')}
            />
            <Button
              label="Continue with Apple"
              icon="shield"
              variant="secondary"
              onPress={() => social('apple')}
            />
          </View>

          <Text variant="caption" muted center style={styles.caption}>
            Secured by Privy · non-custodial
          </Text>
        </>
      ) : (
        /* OTP verification step */
        <View style={styles.otpBlock}>
          <Text variant="h2" color={colors.textHi}>Enter your code</Text>
          <View style={styles.otpSubtitleRow}>
            <Text variant="caption" dim>Sent to {emailAddr} · </Text>
            <Pressable onPress={() => { setSent(false); setCode(''); }}>
              <Text variant="caption" color={colors.aqua}>Change</Text>
            </Pressable>
          </View>
          <View style={styles.otpInputWrap}>
            <OtpInput value={code} onChange={setCode} onComplete={verify} />
          </View>
          <View style={styles.verifyBtn}>
            <Button
              label="Verify & sign in"
              icon="check"
              loading={busy}
              disabled={!isComplete(code, 6)}
              onPress={() => verify(code)}
            />
          </View>
          <Pressable onPress={sendCode} style={styles.resendWrap}>
            <Text variant="caption" color={colors.aqua} center>
              Resend code
            </Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    marginTop: space.huge,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    marginTop: space.xxl,
  },
  tagline: {
    marginTop: space.xs,
  },
  emailBlock: {
    marginTop: space.huge,
  },
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
  sendBtn: {
    marginTop: space.md,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginVertical: space.xxl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  altButtons: {
    gap: space.md,
  },
  caption: {
    marginTop: space.xxl,
  },
  otpBlock: {
    marginTop: space.huge,
  },
  otpSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xs,
  },
  otpInputWrap: {
    marginTop: space.xxl,
  },
  verifyBtn: {
    marginTop: space.xxl,
  },
  resendWrap: {
    marginTop: space.xl,
  },
});
