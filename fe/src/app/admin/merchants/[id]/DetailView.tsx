'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/ui/AppShell';
import { TopBar } from '@/ui/TopBar';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Pill, Field, Divider } from '@/ui/Bits';
import { colors, space } from '@/ui/theme';
import { ADMIN_NAV } from '@/ui/nav';
import { statusTone } from '@/lib/dashboard/status';
import Actions from './Actions';

export interface MerchantDetailData {
  id: string;
  email: string;
  businessName: string;
  approvalStatus: string;
  payoutAddress: string | null;
  onchainRegisterTx: string | null;
  rejectionReason: string | null;
}

export default function DetailView({ m }: { m: MerchantDetailData }) {
  const router = useRouter();
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/admin/login');
  };
  const t = statusTone(m.approvalStatus);

  return (
    <AppShell items={ADMIN_NAV} identity={{ title: 'Admin', subtitle: 'Platform' }} onLogout={logout}>
      <TopBar eyebrow="Merchant" title={m.businessName} />
      <div style={{ marginBottom: space.lg }}>
        <Link href="/admin/merchants">
          <Text variant="caption" color={colors.accent}>← merchants</Text>
        </Link>
      </div>
      <div style={{ maxWidth: 640 }}>
        <Card>
          <Field label="Email" value={m.email} />
          <Divider />
          <div style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
            <Text variant="label" muted upper>Status</Text>
            <div style={{ marginTop: space.sm }}>
              <Pill label={t.label} tone={t.tone} />
            </div>
          </div>
          <Divider />
          <Field label="Payout address" value={m.payoutAddress ?? 'not set'} mono valueColor={m.payoutAddress ? undefined : colors.textDim} />
          <Divider />
          <div style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
            <Text variant="label" muted upper>On-chain tx</Text>
            <div style={{ marginTop: space.xs }}>
              {m.onchainRegisterTx ? (
                <a href={`https://sepolia.etherscan.io/tx/${m.onchainRegisterTx}`} target="_blank" rel="noreferrer">
                  <Text variant="mono" color={colors.accent}>{m.onchainRegisterTx.slice(0, 16)}…</Text>
                </a>
              ) : (
                <Text variant="h3" color={colors.textDim}>—</Text>
              )}
            </div>
          </div>
          {m.rejectionReason && (
            <>
              <Divider />
              <Field label="Rejection reason" value={m.rejectionReason} valueColor={colors.danger} />
            </>
          )}
          <Actions id={m.id} canApprove={!!m.payoutAddress} />
        </Card>
      </div>
    </AppShell>
  );
}
