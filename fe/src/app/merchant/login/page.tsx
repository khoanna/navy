'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { colors, space, radius } from '@/ui/theme';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { AuthCard } from '@/ui/AuthCard';
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md,
  color: colors.text,
  padding: '12px 14px',
  outline: 'none',
  width: '100%',
};

export default function MerchantLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Recover a session whose access token expired but whose refresh token is
  // still valid — silently restore it and skip straight to the dashboard.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/refresh', { method: 'POST' })
      .then((r) => { if (alive && r.ok) router.replace('/merchant'); })
      .catch(() => {});
    return () => { alive = false; };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setError('');
      const url = mode === 'login' ? '/api/auth/merchant' : '/api/auth/merchant/signup';
      const body = mode === 'login' ? { email, password } : { email, password, businessName };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        router.replace('/merchant');
        return;
      }
      // Surface the backend's reason (e.g. "password must be longer than or
      // equal to 8 characters") instead of a generic label.
      const data = await res.json().catch(() => null);
      const detail = data && typeof data.error === 'string' ? data.error : undefined;
      const fallback = mode === 'login' ? 'Invalid credentials' : 'Signup failed';
      setError(res.status === 401 && !detail ? fallback : mapError(new NavyApiError('auth failed', res.status, detail)).detail);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthCard title={mode === 'login' ? 'Sign in' : 'Create merchant account'} subtitle="Payments back-office">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <input style={inputStyle} placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={inputStyle} placeholder={mode === 'signup' ? 'Password (min 8 characters)' : 'Password'} type="password" minLength={8} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'signup' && (
          <input style={inputStyle} placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        )}
        <Button label={mode === 'login' ? 'Sign in' : 'Create account'} loading={busy} />
        {error && <Text variant="caption" color={colors.danger} center>{error}</Text>}
      </form>
      <button
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, alignSelf: 'center' }}
      >
        <Text variant="caption" color={colors.accent}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </Text>
      </button>
    </AuthCard>
  );
}
