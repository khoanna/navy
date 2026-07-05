'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { DataTable, Column } from '@/ui/DataTable';
import { Text } from '@/ui/Text';
import { Pill } from '@/ui/Bits';
import { colors, space, radius } from '@/ui/theme';
import { ADMIN_NAV } from '@/ui/nav';
import { statusTone } from '@/lib/dashboard/status';

export interface Merchant {
  id: string;
  email: string;
  businessName: string;
  approvalStatus: string;
  payoutAddress: string | null;
  onchainRegisteredAt: string | null;
}

const FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;

export default function MerchantsView({ merchants, status }: { merchants: Merchant[]; status: string }) {
  const router = useRouter();
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  const cols: Column<Merchant>[] = [
    { key: 'biz', header: 'Business', render: (m) => <Text variant="bodyStrong" color={colors.textHi}>{m.businessName}</Text> },
    { key: 'email', header: 'Email', render: (m) => <Text variant="body" dim>{m.email}</Text> },
    {
      key: 'status',
      header: 'Status',
      render: (m) => {
        const t = statusTone(m.approvalStatus);
        return <Pill label={t.label} tone={t.tone} />;
      },
    },
    {
      key: 'payout',
      header: 'Payout',
      render: (m) =>
        m.payoutAddress ? (
          <Text variant="body" color={colors.success}>✓ registered</Text>
        ) : (
          <Text variant="body" dim>—</Text>
        ),
    },
    {
      key: 'act',
      header: 'Review',
      align: 'right',
      render: (m) => (
        <Link href={`/admin/merchants/${m.id}`}>
          <Text variant="bodyStrong" color={colors.accent}>Review →</Text>
        </Link>
      ),
    },
  ];

  return (
    <AppShell items={ADMIN_NAV} identity={{ title: 'Admin', subtitle: 'Platform' }} onLogout={logout}>
      <TopBar eyebrow="Admin" title="Merchants" />
      <nav style={{ display: 'flex', gap: space.sm, marginBottom: space.xl }}>
        {FILTERS.map((s) => {
          const active = s === status;
          return (
            <Link
              key={s}
              href={`/admin/merchants?status=${s}`}
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
            </Link>
          );
        })}
      </nav>
      <DataTable columns={cols} rows={merchants} empty="No merchants." />
    </AppShell>
  );
}
