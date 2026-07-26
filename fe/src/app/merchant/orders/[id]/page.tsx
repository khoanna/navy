'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Pill, Field, Divider } from '@/ui/Bits';
import { ErrorState } from '@/ui/ErrorState';
import { SkeletonList } from '@/ui/SkeletonList';
import { colors, space } from '@/ui/theme';
import { MERCHANT_NAV } from '@/ui/nav';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';
import { useAsync } from '@/lib/useAsync';
import { NavyApiError } from '@/lib/navyApi';

interface OrderItemRow { name: string; unitPrice: string; quantity: number; }
interface OrderChargeRow { name: string; mode: string; value: number; amount: string; }
interface Order { id: string; reference: string; amount: string; status: string; payer: string | null; txSignature: string | null; subtotal: string | null; description: string | null; items: OrderItemRow[]; charges: OrderChargeRow[]; }
const TERMINAL = ['paid', 'expired', 'failed'];

async function detailOf(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (typeof b.message === 'string') return b.message;
  }
  return undefined;
}

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  // Once the order reaches a terminal state, drop the 4s poll (nothing changes).
  const [terminal, setTerminal] = useState(false);

  const { data: order, loading, error, staleError, retry } = useAsync<Order>(async () => {
    const res = await fetch(`/api/merchant/orders/${id}`);
    if (res.status === 401) { router.replace('/merchant/login'); throw new NavyApiError('unauthorized', 401); }
    if (!res.ok) throw new NavyApiError('order failed', res.status, await detailOf(res));
    const o: Order = await res.json();
    if (TERMINAL.includes(o.status)) setTerminal(true);
    return o;
  }, { poll: terminal ? undefined : 4000, deps: [id] });

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
      <TopBar eyebrow="Order" title={order ? order.reference : 'Order'} />
      <div style={{ marginBottom: space.lg }}>
        <Link href="/merchant/orders">
          <Text variant="caption" color={colors.accent}>← orders</Text>
        </Link>
      </div>
      {loading && !order ? (
        <div style={{ maxWidth: 560 }}><SkeletonList rows={5} height={48} /></div>
      ) : error && !order ? (
        <ErrorState error={error} onRetry={retry} />
      ) : order ? (
        <div style={{ maxWidth: 560 }}>
          {staleError && (
            <button onClick={retry} style={{ marginBottom: space.md, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <Text variant="caption" color={colors.warning}>Couldn’t refresh · Retry</Text>
            </button>
          )}
          <Card>
            <Field label="Amount" value={`${formatUsdc(order.amount)} USDC`} numeric />
            {order.description && (
              <>
                <Divider />
                <Field label="Description" value={order.description} />
              </>
            )}
            {((order.items ?? []).length > 0 || (order.charges ?? []).length > 0) && (
              <>
                <Divider />
                <div style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
                  <Text variant="label" muted upper>Breakdown</Text>
                  <div style={{ marginTop: space.sm }}>
                    {(order.items ?? []).map((it, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: space.xs }}>
                        <Text variant="body">{it.name} &times; {it.quantity}</Text>
                        <Text variant="body" numeric>{formatUsdc((BigInt(it.unitPrice) * BigInt(it.quantity)).toString())} USDC</Text>
                      </div>
                    ))}
                    {(order.charges ?? []).length > 0 && (order.items ?? []).length > 0 && (
                      <div style={{ height: space.xs }} />
                    )}
                    {(order.charges ?? []).map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: space.xs }}>
                        <Text variant="body" dim>{c.name}</Text>
                        <Text variant="body" numeric>{formatUsdc(c.amount)} USDC</Text>
                      </div>
                    ))}
                    {order.subtotal && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: space.sm, borderTop: `1px solid ${colors.border}` , paddingTop: space.sm }}>
                        <Text variant="label" muted upper>Subtotal</Text>
                        <Text variant="body" numeric>{formatUsdc(order.subtotal)} USDC</Text>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
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
                  <a href={`https://sepolia.etherscan.io/tx/${order.txSignature}`} target="_blank" rel="noreferrer">
                    <Text variant="mono" color={colors.accent}>{order.txSignature.slice(0, 16)}…</Text>
                  </a>
                ) : (
                  <Text variant="h3" color={colors.textDim}>—</Text>
                )}
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
