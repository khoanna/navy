'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { DataTable, Column } from '@/ui/DataTable';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { colors, space, radius } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';

interface Order { id: string; reference: string; amount: string; status: string; createdAt: string; }

const FILTERS = ['all', 'awaiting_payment', 'paid', 'expired'] as const;

export default function Orders() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('all');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/merchant/orders?status=${status}`);
      if (active && res.ok) setOrders(await res.json());
    };
    load();
    const t = setInterval(load, 4000);
    return () => { active = false; clearInterval(t); };
  }, [status]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/merchant/login');
  };

  const cols: Column<Order>[] = [
    { key: 'ref', header: 'Reference', render: (o) => <Text variant="bodyStrong" color={colors.textHi}>{o.reference}</Text> },
    { key: 'amt', header: 'Amount', align: 'right', render: (o) => <Text variant="body" numeric>{formatUsdc(o.amount)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (o) => { const t = statusTone(o.status); return <Pill label={t.label} tone={t.tone} />; } },
    { key: 'view', header: 'View', align: 'right', render: (o) => <Link href={`/merchant/orders/${o.id}`}><Text variant="bodyStrong" color={colors.accent}>View →</Text></Link> },
  ];

  return (
    <AppShell
      items={MERCHANT_NAV}
      identity={{ title: 'Merchant', subtitle: 'Dashboard' }}
      onLogout={logout}
    >
      <TopBar
        eyebrow="Merchant"
        title="Orders"
        right={
          <div style={{ minWidth: 160 }}>
            <Button label="New invoice" icon="plus" full onPress={() => router.push('/merchant/orders/new')} />
          </div>
        }
      />
      <nav style={{ display: 'flex', gap: space.sm, marginBottom: space.xl }}>
        {FILTERS.map((s) => {
          const active = s === status;
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              style={{
                padding: `${space.sm}px ${space.lg}px`,
                borderRadius: radius.pill,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? 'rgba(79,140,255,0.14)' : colors.glassFill,
              }}
            >
              <Text variant="label" upper color={active ? colors.accent : colors.textDim}>
                {statusTone(s).label}
              </Text>
            </button>
          );
        })}
      </nav>
      <DataTable columns={cols} rows={orders} empty="No orders." />
    </AppShell>
  );
}
