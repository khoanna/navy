'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function NewOrder() {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [expiresInSec, setExpiresInSec] = useState('900');
  const [result, setResult] = useState<{ orderId: string; qr: string; payUrl: string } | null>(null);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setResult(null);
    const baseUnits = BigInt(Math.round(parseFloat(amount || '0') * 1_000_000)).toString();
    if (baseUnits === '0') { setError('Enter an amount greater than 0'); return; }
    const res = await fetch('/api/merchant/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: baseUnits, reference, expiresInSec: parseInt(expiresInSec, 10) }),
    });
    const body = await res.json();
    if (res.ok) setResult({ orderId: body.orderId, qr: body.qr, payUrl: body.payUrl });
    else setError(body.error ?? (res.status === 409 ? 'Your account is not approved yet' : `Failed (${res.status})`));
  }

  return (
    <main style={{ padding: 32, maxWidth: 480, fontFamily: 'sans-serif' }}>
      <p><Link href="/merchant/orders">← orders</Link></p>
      <h1>New invoice</h1>
      {!result && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
          <input placeholder="amount (USDC)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input placeholder="reference / order id" value={reference} onChange={(e) => setReference(e.target.value)} />
          <input placeholder="expires in seconds" value={expiresInSec} onChange={(e) => setExpiresInSec(e.target.value)} />
          <button type="submit">Create invoice</button>
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
        </form>
      )}
      {result && (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          <p>Invoice <code>{result.orderId}</code> created. Show this QR to your customer:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.qr} alt="payment QR" width={220} height={220} />
          <p style={{ wordBreak: 'break-all' }}><code>{result.payUrl}</code></p>
          <Link href={`/merchant/orders/${result.orderId}`}>Track this order →</Link>
        </div>
      )}
    </main>
  );
}
