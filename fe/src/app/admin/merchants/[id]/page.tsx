import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminBackendFetch } from '@/lib/admin-api';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';
import DetailView, { MerchantDetailData } from './DetailView';

export default async function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let m: MerchantDetailData | null = null;
  try {
    const res = await adminBackendFetch(`/admin/merchants/${id}`);
    if (res.status === 401 || res.status === 403) redirect('/admin/login');
    m = res.ok ? await res.json() : null;
  } catch (e: unknown) {
    // Re-throw Next.js redirect control-flow errors; redirect everything else to login.
    if (e instanceof Error && 'digest' in e && typeof (e as { digest?: string }).digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')) throw e;
    redirect('/admin/login');
  }

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
