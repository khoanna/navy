'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useLoginWithOAuth,
  useLoginWithEmail,
  useLoginWithSms,
  useLoginWithPasskey,
} from '@privy-io/react-auth';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useToast } from '@/ui/Toast';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { colors, gradients, radius, space } from '@/ui/theme';

type Channel = 'email' | 'phone';

export default function Login() {
  const router = useRouter();
  const toast = useToast();
  const { establishFromPrivy } = useNavySession();
  const { initOAuth } = useLoginWithOAuth();
  const email = useLoginWithEmail();
  const sms = useLoginWithSms();
  const { loginWithPasskey } = useLoginWithPasskey();

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
      toast(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await establishFromPrivy();
    router.replace('/home');
  };

  const passkey = () =>
    run(async () => {
      await loginWithPasskey();
      await finish();
    }, 'Passkey login failed');

  const social = (provider: 'google' | 'apple') =>
    // Web OAuth is a full-page redirect; on return, SessionContext establishes.
    run(async () => {
      await initOAuth({ provider });
    }, 'Social login failed');

  const sendCode = () =>
    run(async () => {
      if (channel === 'email') await email.sendCode({ email: emailAddr });
      else await sms.sendCode({ phoneNumber: phone });
      setSent(true);
    }, 'Could not send code');

  const verify = () =>
    run(async () => {
      if (channel === 'email') await email.loginWithCode({ code });
      else await sms.loginWithCode({ code });
      await finish();
    }, 'Verification failed');

  const inputStyle: React.CSSProperties = {
    background: colors.bgElevated,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: `${radius.md}px`,
    padding: `${space.lg}px ${space.lg}px`,
    color: colors.textHi,
    fontSize: 16,
    marginTop: `${space.sm}px`,
    width: '100%',
    outline: 'none',
  };

  return (
    <Screen scroll>
      <div>
        {/* Brand mark */}
        <div style={{ marginTop: `${space.huge}px` }}>
          <Gradient
            colors={gradients.ocean}
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="wallet" size={30} color={colors.onAccent} strokeWidth={2} />
          </Gradient>
          <div style={{ marginTop: `${space.xxl}px` }}>
            <Text variant="display" color={colors.textHi}>
              Navy
            </Text>
            <Text variant="h3" dim style={{ marginTop: `${space.xs}px`, display: 'block' }}>
              Your wallet for the open ocean.
            </Text>
          </div>
        </div>

        {/* Auth options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: `${space.md}px`, marginTop: `${space.huge}px` }}>
          <Button label="Continue with passkey" icon="shield" onPress={passkey} />
          <Button label="Continue with Google" icon="shield" variant="secondary" onPress={() => social('google')} />
          <Button label="Continue with Apple" icon="shield" variant="secondary" onPress={() => social('apple')} />
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: `${space.md}px`, margin: `${space.xxl}px 0` }}>
          <div style={{ flex: 1, height: 1, background: colors.border }} />
          <Text variant="label" muted upper>
            or
          </Text>
          <div style={{ flex: 1, height: 1, background: colors.border }} />
        </div>

        {/* Channel switch */}
        <div
          style={{
            display: 'flex',
            background: colors.bgElevated,
            borderRadius: `${radius.md}px`,
            border: `1px solid ${colors.border}`,
            padding: 4,
            marginBottom: `${space.md}px`,
          }}
        >
          {(['email', 'phone'] as Channel[]).map((c) => (
            <div
              key={c}
              onClick={() => {
                setChannel(c);
                setSent(false);
                setCode('');
              }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: `${space.md}px`,
                paddingBottom: `${space.md}px`,
                borderRadius: `${radius.sm}px`,
                cursor: 'pointer',
                ...(channel === c ? { background: colors.surfaceHi } : null),
              }}
            >
              <Text variant="bodyStrong" color={channel === c ? colors.textHi : colors.textMute}>
                {c === 'email' ? 'Email' : 'Phone'}
              </Text>
            </div>
          ))}
        </div>

        {channel === 'email' ? (
          <input
            style={inputStyle}
            placeholder="you@example.com"
            autoCapitalize="none"
            type="email"
            value={emailAddr}
            onChange={(e) => setEmailAddr(e.target.value)}
          />
        ) : (
          <input
            style={inputStyle}
            placeholder="+1 555 123 4567"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}

        {sent && (
          <input
            style={{ ...inputStyle, textAlign: 'center', letterSpacing: '8px', fontSize: 22, fontWeight: 700 }}
            placeholder="• • • • • •"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
          />
        )}

        <div style={{ marginTop: `${space.lg}px` }}>
          {!sent ? (
            <Button label="Send code" icon="send" loading={busy} onPress={sendCode} />
          ) : (
            <Button label="Verify & sign in" icon="check" loading={busy} onPress={verify} />
          )}
        </div>

        {sent && (
          <div
            onClick={sendCode}
            style={{ marginTop: `${space.lg}px`, display: 'flex', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Text variant="caption" color={colors.accent}>
              Resend code
            </Text>
          </div>
        )}
      </div>
    </Screen>
  );
}
