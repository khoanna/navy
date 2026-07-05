import Link from 'next/link';
import { adminBackendFetch } from '@/lib/admin-api';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';
import DetailView, { MerchantDetailData } from './DetailView';

export default async function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await adminBackendFetch(`/admin/merchants/${id}`);
  const m: MerchantDetailData | null = res.ok ? await res.json() : null;
  if (!m) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: space.xl }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space.md }}>
          <Text variant="h3" color={colors.textHi}>Merchant not found</Text>
          <Link href="/admin/merchants"><Text variant="bodyStrong" color={colors.accent}>← Back to merchants</Text></Link>
        </div>
      </main>
    );
  }

  return <DetailView m={m} />;
}
