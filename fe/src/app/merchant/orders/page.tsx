'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { DataTable, Column } from '@/ui/DataTable';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { Modal } from '@/ui/Modal';
import { ErrorState } from '@/ui/ErrorState';
import { SkeletonList } from '@/ui/SkeletonList';
import { colors, space, radius } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';
import { NewInvoiceForm } from './NewInvoiceForm';
import { useAsync } from '@/lib/useAsync';
import { NavyApiError } from '@/lib/navyApi';
import { detailOf } from '@/lib/httpError';

interface Order { id: string; reference: string; amount: string; status: string; createdAt: string; }

const FILTERS = ['all', 'awaiting_payment', 'paid', 'expired'] as const;

export default function Orders() {
  const router = useRouter();
  const [status, setStatus] = useState('all');
  const [showNew, setShowNew] = useState(false);

  const { data: orders, loading, error, staleError, retry } = useAsync<Order[]>(async () => {
    const res = await fetch(`/api/merchant/orders?status=${status}`);
    if (res.status === 401) { router.replace('/merchant/login'); throw new NavyApiError('unauthorized', 401); }
    if (!res.ok) throw new NavyApiError('orders failed', res.status, await detailOf(res));
    return res.json();
  }, { poll: 4000, deps: [status] });

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
            <Button label="New invoice" icon="plus" full onPress={() => setShowNew(true)} />
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
      {loading && !orders ? (
        <SkeletonList rows={5} height={56} />
      ) : error && !orders ? (
        <ErrorState error={error} onRetry={retry} />
      ) : (
        <>
          {staleError && (
            <button onClick={retry} style={{ marginBottom: space.md, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <Text variant="caption" color={colors.warning}>Couldn’t refresh · Retry</Text>
            </button>
          )}
          <DataTable columns={cols} rows={orders ?? []} empty="No orders." />
        </>
      )}
      <Modal open={showNew} title="New invoice" subtitle="Create a payment request and share its QR." onClose={() => setShowNew(false)}>
        <NewInvoiceForm onCreated={retry} />
      </Modal>
    </AppShell>
  );
}
