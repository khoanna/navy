'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usdcInputToBaseUnits } from '@/lib/money';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, space, radius } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md,
  color: colors.text,
  padding: '12px 14px',
  outline: 'none',
  width: '100%',
};

export default function NewOrder() {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [expiresInSec, setExpiresInSec] = useState('900');
  const [result, setResult] = useState<{ orderId: string; qr: string; payUrl: string } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(''); setResult(null);
    let baseUnits: string;
    try {
      baseUnits = usdcInputToBaseUnits(amount);
    } catch (err) {
      setError((err as Error).message); return;
    }
    if (baseUnits === '0') { setError('Enter an amount greater than 0'); return; }
    const ttl = parseInt(expiresInSec, 10);
    if (!Number.isFinite(ttl) || ttl <= 0) { setError('Enter a valid expiry in seconds'); return; }
    setSubmitting(true);
    const res = await fetch('/api/merchant/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: baseUnits, reference, expiresInSec: ttl }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (res.ok) setResult({ orderId: body.orderId, qr: body.qr, payUrl: body.payUrl });
    else setError(body.error ?? (res.status === 409 ? 'Your account is not approved yet' : `Failed (${res.status})`));
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/merchant/login');
  };

  return (
    <AppShell
      items={MERCHANT_NAV}
      identity={{ title: 'Merchant', subtitle: 'Dashboard' }}
      onLogout={logout}
    >
      <TopBar eyebrow="Merchant" title="New invoice" />
      <div style={{ marginBottom: space.lg }}>
        <Link href="/merchant/orders">
          <Text variant="caption" color={colors.accent}>← orders</Text>
        </Link>
      </div>
      <div style={{ maxWidth: 480 }}>
        {!result && (
          <Card>
            <form onSubmit={submit} style={{ display: 'grid', gap: space.md }}>
              <div style={{ display: 'grid', gap: space.xs }}>
                <Text variant="label" muted upper>Amount (USDC)</Text>
                <input placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gap: space.xs }}>
                <Text variant="label" muted upper>Reference / order id</Text>
                <input placeholder="e.g. INV-1024" value={reference} onChange={(e) => setReference(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gap: space.xs }}>
                <Text variant="label" muted upper>Expires in seconds</Text>
                <input placeholder="900" value={expiresInSec} onChange={(e) => setExpiresInSec(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ marginTop: space.sm }}>
                <Button label="Create invoice" loading={submitting} onPress={() => submit()} />
              </div>
              {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
            </form>
          </Card>
        )}
        {result && (
          <Card>
            <div style={{ display: 'grid', gap: space.md, justifyItems: 'start' }}>
              <Text variant="body" dim>
                Invoice <Text variant="mono" color={colors.textHi}>{result.orderId}</Text> created. Show this QR to your customer:
              </Text>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.qr} alt="payment QR" width={220} height={220} style={{ borderRadius: radius.md, background: '#fff', padding: space.sm }} />
              <div style={{ wordBreak: 'break-all' }}>
                <Text variant="mono" color={colors.text}>{result.payUrl}</Text>
              </div>
              <Link href={`/merchant/orders/${result.orderId}`}>
                <Text variant="bodyStrong" color={colors.accent}>Track this order →</Text>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
