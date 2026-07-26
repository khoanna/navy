'use client';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { StatCard } from '@/ui/StatCard';
import { TrendChart } from '@/ui/TrendChart';
import { DataTable, Column } from '@/ui/DataTable';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { ErrorState } from '@/ui/ErrorState';
import { SkeletonList } from '@/ui/SkeletonList';
import { colors, space } from '@/ui/theme';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';
import { MERCHANT_NAV } from '@/ui/nav';
import { useAsync } from '@/lib/useAsync';
import { NavyApiError } from '@/lib/navyApi';

interface Stats { totalRevenue: string; paidCount: number; awaitingCount: number; expiredCount: number; series: { date: string; amount: string }[]; }
interface Order { id: string; reference: string; amount: string; status: string; }

async function detailOf(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (typeof b.message === 'string') return b.message;
  }
  return undefined;
}

export default function MerchantOverview() {
  const router = useRouter();
  const { data, loading, error, staleError, retry } = useAsync<{ stats: Stats; orders: Order[] }>(async () => {
    const [statsRes, ordersRes] = await Promise.all([
      fetch('/api/merchant/stats'),
      fetch('/api/merchant/orders?status=all&take=6'),
    ]);
    if (statsRes.status === 401 || ordersRes.status === 401) { router.replace('/merchant/login'); throw new NavyApiError('unauthorized', 401); }
    if (!statsRes.ok) throw new NavyApiError('stats failed', statsRes.status, await detailOf(statsRes));
    const [stats, orders] = await Promise.all([statsRes.json(), ordersRes.ok ? ordersRes.json() : []]);
    return { stats, orders };
  }, { poll: 4000 });

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/merchant/login'); };

  const cols: Column<Order>[] = [
    { key: 'ref', header: 'Reference', render: (o) => <Text variant="bodyStrong" color={colors.textHi}>{o.reference}</Text> },
    { key: 'amt', header: 'Amount', align: 'right', render: (o) => <Text variant="body" numeric>{formatUsdc(o.amount)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (o) => { const t = statusTone(o.status); return <Pill label={t.label} tone={t.tone} />; } },
  ];

  const stats = data?.stats;
  const orders = data?.orders ?? [];
  const series = (stats?.series ?? []).map((p) => ({ date: p.date, value: Number(p.amount) / 1_000_000 }));

  return (
    <AppShell items={MERCHANT_NAV} identity={{ title: 'Merchant', subtitle: 'Dashboard' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title="Overview" />
      {loading && !data ? (
        <div style={{ display: 'grid', gap: space.lg }}>
          <SkeletonList rows={1} height={96} />
          <SkeletonList rows={1} height={220} />
          <SkeletonList rows={4} height={48} />
        </div>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={retry} />
      ) : data ? (
        <>
          {staleError && (
            <button onClick={retry} style={{ marginBottom: space.lg, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <Text variant="caption" color={colors.warning}>Couldn’t refresh · Retry</Text>
            </button>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: space.lg, marginBottom: space.xl }}>
            <StatCard label="Total revenue" value={`${formatUsdc(stats!.totalRevenue)} USDC`} icon="wallet" delta={`${stats!.paidCount} paid`} />
            <StatCard label="Paid" value={String(stats!.paidCount)} icon="check" />
            <StatCard label="Awaiting" value={String(stats!.awaitingCount)} icon="clock" />
            <StatCard label="Expired" value={String(stats!.expiredCount)} icon="bolt" />
          </div>
          <div style={{ marginBottom: space.xl }}>
            <TrendChart title="Paid volume · last 30 days" series={series} />
          </div>
          <div style={{ marginBottom: space.xl }}>
            <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.md }}>Recent orders</Text>
            <DataTable columns={cols} rows={orders} empty="No orders yet" />
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
