'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Pill, Field, Divider } from '@/ui/Bits';
import { colors, space } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';

interface Order { id: string; reference: string; amount: string; status: string; payer: string | null; txSignature: string | null; }
const TERMINAL = ['paid', 'expired', 'failed'];

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    let active = true;
    const t = setInterval(load, 4000);
    async function load() {
      const res = await fetch(`/api/merchant/orders/${id}`);
      if (!active) return;
      if (res.ok) {
        const o: Order = await res.json();
        setOrder(o);
        if (TERMINAL.includes(o.status)) clearInterval(t);
      }
    }
    load();
    return () => { active = false; clearInterval(t); };
  }, [id]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/merchant/login');
  };

  const t = order ? statusTone(order.status) : null;

  return (
    <AppShell
      items={MERCHANT_NAV}
      identity={{ title: 'Merchant', subtitle: 'Dashboard' }}
      onLogout={logout}
    >
      <TopBar eyebrow="Order" title={order ? order.reference : 'Loading…'} />
      <div style={{ marginBottom: space.lg }}>
        <Link href="/merchant/orders">
          <Text variant="caption" color={colors.accent}>← orders</Text>
        </Link>
      </div>
      {!order ? (
        <Text variant="body" dim>Loading…</Text>
      ) : (
        <div style={{ maxWidth: 560 }}>
          <Card>
            <Field label="Amount (USDC)" value={`${formatUsdc(order.amount)} USDC`} numeric />
            <Divider />
            <div style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
              <Text variant="label" muted upper>Status</Text>
              <div style={{ marginTop: space.sm }}>
                {t && <Pill label={t.label} tone={t.tone} />}
              </div>
            </div>
            <Divider />
            <Field label="Payer" value={order.payer ?? '—'} mono valueColor={order.payer ? undefined : colors.textDim} />
            <Divider />
            <div style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
              <Text variant="label" muted upper>Tx</Text>
              <div style={{ marginTop: space.xs }}>
                {order.txSignature ? (
                  <a href={`https://explorer.solana.com/tx/${order.txSignature}?cluster=devnet`} target="_blank" rel="noreferrer">
                    <Text variant="mono" color={colors.accent}>{order.txSignature.slice(0, 16)}…</Text>
                  </a>
                ) : (
                  <Text variant="h3" color={colors.textDim}>—</Text>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
