'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, totp }),
    });
    if (res.ok) router.replace('/admin');
    else setError('Invalid credentials or TOTP');
  }

  return (
    <main style={{ padding: 32, maxWidth: 360, fontFamily: 'sans-serif' }}>
      <h1>Admin sign in</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
        <input placeholder="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input placeholder="TOTP code" value={totp} onChange={(e) => setTotp(e.target.value)} />
        <button type="submit">Sign in</button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </form>
    </main>
  );
}
