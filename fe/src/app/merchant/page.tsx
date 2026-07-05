'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { StatCard } from '@/ui/StatCard';
import { TrendChart } from '@/ui/TrendChart';
import { DataTable, Column } from '@/ui/DataTable';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { colors, space } from '@/ui/theme';
import { formatUsdc } from '@/lib/dashboard/stats';
import { statusTone } from '@/lib/dashboard/status';
import { MERCHANT_NAV } from '@/ui/nav';
import ApiKeyPanel from './ApiKeyPanel';
import WalletConnectClient from './WalletConnectClient';

interface Stats { totalRevenue: string; paidCount: number; awaitingCount: number; expiredCount: number; series: { date: string; amount: string }[]; }
interface Order { id: string; reference: string; amount: string; status: string; }

export default function MerchantOverview() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, o] = await Promise.all([
          fetch('/api/merchant/stats').then((r) => (r.ok ? r.json() : Promise.reject())),
          fetch('/api/merchant/orders?status=all&take=6').then((r) => (r.ok ? r.json() : [])),
        ]);
        if (!alive) return;
        setStats(s); setOrders(o);
      } catch { if (alive) setErr(true); }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/merchant/login'); };

  const cols: Column<Order>[] = [
    { key: 'ref', header: 'Reference', render: (o) => <Text variant="bodyStrong" color={colors.textHi}>{o.reference}</Text> },
    { key: 'amt', header: 'Amount', align: 'right', render: (o) => <Text variant="body" numeric>{formatUsdc(o.amount)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (o) => { const t = statusTone(o.status); return <Pill label={t.label} tone={t.tone} />; } },
  ];

  const series = (stats?.series ?? []).map((p) => ({ date: p.date, value: Number(p.amount) / 1_000_000 }));

  return (
    <AppShell items={MERCHANT_NAV} identity={{ title: 'Merchant', subtitle: 'Dashboard' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title="Overview" />
      {err && <div style={{ marginBottom: space.lg }}><Text variant="caption" color={colors.danger}>Couldn’t load metrics — showing what we have.</Text></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: space.lg, marginBottom: space.xl }}>
        <StatCard label="Total revenue" value={`${formatUsdc(stats?.totalRevenue ?? '0')} USDC`} icon="wallet" delta={stats ? `${stats.paidCount} paid` : null} />
        <StatCard label="Paid" value={String(stats?.paidCount ?? 0)} icon="check" />
        <StatCard label="Awaiting" value={String(stats?.awaitingCount ?? 0)} icon="clock" />
        <StatCard label="Expired" value={String(stats?.expiredCount ?? 0)} icon="bolt" />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <TrendChart title="Paid volume · last 30 days" series={series} />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.md }}>Recent orders</Text>
        <DataTable columns={cols} rows={orders} empty="No orders yet" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.lg }}>
        <ApiKeyPanel />
        <WalletConnectClient />
      </div>
    </AppShell>
  );
}
