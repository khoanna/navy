'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MerchantLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const url = mode === 'login' ? '/api/auth/merchant' : '/api/auth/merchant/signup';
    const body = mode === 'login' ? { email, password } : { email, password, businessName };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) router.replace('/merchant');
    else setError(mode === 'login' ? 'Invalid credentials' : 'Signup failed');
  }

  return (
    <main style={{ padding: 32, maxWidth: 360, fontFamily: 'sans-serif' }}>
      <h1>Merchant {mode === 'login' ? 'sign in' : 'sign up'}</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
        <input placeholder="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'signup' && (
          <input placeholder="business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        )}
        <button type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </form>
      <button style={{ marginTop: 12 }} onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </main>
  );
}
