'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { colors, space, radius } from '@/ui/theme';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { AuthCard } from '@/ui/AuthCard';

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md,
  color: colors.text,
  padding: '12px 14px',
  outline: 'none',
  width: '100%',
};

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Recover a session whose access token expired but whose refresh token is
  // still valid — silently restore it and skip straight to the dashboard.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/refresh', { method: 'POST' })
      .then((r) => { if (alive && r.ok) router.replace('/admin'); })
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
      const res = await fetch('/api/auth/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totp }),
      });
      if (res.ok) router.replace('/admin');
      else setError('Invalid credentials or TOTP');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Admin sign in" subtitle="Payments back-office">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <input style={inputStyle} placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={inputStyle} placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input style={inputStyle} placeholder="TOTP code" value={totp} onChange={(e) => setTotp(e.target.value)} />
        <Button label="Sign in" loading={busy} />
        {error && <Text variant="caption" color={colors.danger} center>{error}</Text>}
      </form>
    </AuthCard>
  );
}
