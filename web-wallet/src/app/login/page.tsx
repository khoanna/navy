'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLoginWithOAuth, useLoginWithEmail, useLoginWithPasskey } from '@privy-io/react-auth';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useToast } from '@/ui/Toast';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { OtpInput } from '@/ui/OtpInput';
import { isComplete } from '@/lib/ui/otp';
import { colors, gradients, radius, space } from '@/ui/theme';

export default function Login() {
  const router = useRouter();
  const toast = useToast();
  const { establishFromPrivy } = useNavySession();
  const { initOAuth } = useLoginWithOAuth();
  const email = useLoginWithEmail();
  const { loginWithPasskey } = useLoginWithPasskey();

  const [emailAddr, setEmailAddr] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, label: string) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(`${label}: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const finish = async () => { await establishFromPrivy(); router.replace('/home'); };
  const passkey = () => run(async () => { await loginWithPasskey(); await finish(); }, 'Passkey login failed');
  const social = (provider: 'google' | 'apple') => run(async () => { await initOAuth({ provider }); }, 'Social login failed');
  const sendCode = () => run(async () => { await email.sendCode({ email: emailAddr }); setSent(true); }, 'Could not send code');
  const verify = (c: string) => run(async () => { await email.loginWithCode({ code: c }); await finish(); }, 'Verification failed');

  const inputStyle: React.CSSProperties = {
    background: colors.bgElevated,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: `${radius.md}px`,
    padding: `${space.lg}px`,
    color: colors.textHi,
    fontSize: 16,
    marginTop: `${space.sm}px`,
    width: '100%',
    outline: 'none',
  };

  return (
    <Screen scroll>
      {/* Brand */}
      <div style={{ marginTop: `${space.huge}px` }}>
        <Gradient colors={gradients.ocean} glow style={{ width: 64, height: 64, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="wallet" size={30} color={colors.onAccent} strokeWidth={2} />
        </Gradient>
        <div style={{ marginTop: `${space.xxl}px` }}>
          <Text variant="display" color={colors.textHi}>Navy</Text>
          <Text variant="h3" dim style={{ marginTop: `${space.xs}px`, display: 'block' }}>
            Your wallet for the open ocean.
          </Text>
        </div>
      </div>

      {!sent ? (
        <>
          <div style={{ marginTop: `${space.huge}px` }}>
            <Text variant="label" muted upper>Sign in with</Text>
            <input style={inputStyle} placeholder="you@example.com" autoCapitalize="none" type="email"
              value={emailAddr} onChange={(e) => setEmailAddr(e.target.value)} />
            <div style={{ marginTop: `${space.md}px` }}>
              <Button label="Send code" icon="send" loading={busy} disabled={!emailAddr} onPress={sendCode} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: `${space.md}px`, margin: `${space.xxl}px 0` }}>
            <div style={{ flex: 1, height: 1, background: colors.border }} />
            <Text variant="label" muted upper>or</Text>
            <div style={{ flex: 1, height: 1, background: colors.border }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: `${space.md}px` }}>
            <Button label="Continue with passkey" icon="shield" variant="secondary" onPress={passkey} />
            <Button label="Continue with Google" icon="shield" variant="secondary" onPress={() => social('google')} />
            <Button label="Continue with Apple" icon="shield" variant="secondary" onPress={() => social('apple')} />
          </div>

          <Text variant="caption" muted center style={{ display: 'block', marginTop: `${space.xxl}px` }}>
            Secured by Privy · non-custodial
          </Text>
        </>
      ) : (
        <div style={{ marginTop: `${space.huge}px` }}>
          <Text variant="h2" color={colors.textHi}>Enter your code</Text>
          <Text variant="caption" dim style={{ display: 'block', marginTop: `${space.xs}px` }}>
            Sent to {emailAddr} ·{' '}
            <span style={{ color: colors.aqua, cursor: 'pointer' }} onClick={() => { setSent(false); setCode(''); }}>Change</span>
          </Text>
          <div style={{ marginTop: `${space.xxl}px` }}>
            <OtpInput value={code} onChange={setCode} onComplete={verify} />
          </div>
          <div style={{ marginTop: `${space.xxl}px` }}>
            <Button label="Verify & sign in" icon="check" loading={busy} disabled={!isComplete(code, 6)} onPress={() => verify(code)} />
          </div>
          <Text variant="caption" color={colors.aqua} center style={{ display: 'block', marginTop: `${space.xl}px`, cursor: 'pointer' }} onClick={sendCode}>
            Resend code
          </Text>
        </div>
      )}
    </Screen>
  );
}
