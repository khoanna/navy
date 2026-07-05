'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { ADMIN_NAV } from '@/ui/nav';

interface AdminStats {
  merchantsTotal: number; pending: number; approved: number; rejected: number; onchainRegistered: number;
  ordersTotal: number; volumeTotal: string; series: { date: string; amount: string }[];
  recentPending: { id: string; businessName: string; createdAt: string }[];
  recentPayments: { id: string; reference: string; amount: string; status: string }[];
}

export default function AdminOverview() {
  const router = useRouter();
  const [s, setS] = useState<AdminStats | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await fetch('/api/admin/stats').then((r) => (r.ok ? r.json() : Promise.reject()));
        if (alive) setS(data);
      } catch { if (alive) setErr(true); }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/admin/login'); };

  const pendingCols: Column<{ id: string; businessName: string }>[] = [
    { key: 'name', header: 'Business', render: (m) => <Text variant="bodyStrong" color={colors.textHi}>{m.businessName}</Text> },
    { key: 'act', header: 'Review', align: 'right', render: (m) => <Link href={`/admin/merchants/${m.id}`}><Text variant="bodyStrong" color={colors.accent}>Review →</Text></Link> },
  ];
  const payCols: Column<{ reference: string; amount: string; status: string }>[] = [
    { key: 'ref', header: 'Reference', render: (o) => <Text variant="bodyStrong" color={colors.textHi}>{o.reference}</Text> },
    { key: 'amt', header: 'Amount', align: 'right', render: (o) => <Text variant="body" numeric>{formatUsdc(o.amount)} USDC</Text> },
    { key: 'st', header: 'Status', align: 'right', render: (o) => { const t = statusTone(o.status); return <Pill label={t.label} tone={t.tone} />; } },
  ];

  const series = (s?.series ?? []).map((p) => ({ date: p.date, value: Number(p.amount) / 1_000_000 }));

  return (
    <AppShell items={ADMIN_NAV} identity={{ title: 'Admin', subtitle: 'Platform' }} onLogout={logout}>
      <TopBar eyebrow="Admin" title="Overview" />
      {err && <div style={{ marginBottom: space.lg }}><Text variant="caption" color={colors.danger}>Couldn’t load metrics.</Text></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: space.lg, marginBottom: space.xl }}>
        <StatCard label="Merchants" value={String(s?.merchantsTotal ?? 0)} icon="store" />
        <StatCard label="Pending" value={String(s?.pending ?? 0)} icon="clock" onClick={() => router.push('/admin/merchants?status=pending')} />
        <StatCard label="Approved / on-chain" value={`${s?.approved ?? 0} / ${s?.onchainRegistered ?? 0}`} icon="shield" />
        <StatCard label="Total volume" value={`${formatUsdc(s?.volumeTotal ?? '0')} USDC`} icon="chart" delta={s ? `${s.ordersTotal} orders` : null} />
      </div>
      <div style={{ marginBottom: space.xl }}>
        <TrendChart title="Platform volume · last 30 days" series={series} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.lg }}>
        <div>
          <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.md }}>Pending review</Text>
          <DataTable columns={pendingCols} rows={s?.recentPending ?? []} empty="No pending merchants" />
        </div>
        <div>
          <Text variant="h3" color={colors.textHi} style={{ display: 'block', marginBottom: space.md }}>Recent payments</Text>
          <DataTable columns={payCols} rows={s?.recentPayments ?? []} empty="No payments yet" />
        </div>
      </div>
    </AppShell>
  );
}
