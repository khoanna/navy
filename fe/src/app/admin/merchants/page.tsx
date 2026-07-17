import { redirect } from 'next/navigation';
import { adminBackendFetch } from '@/lib/admin-api';
import MerchantsView, { Merchant } from './MerchantsView';

export default async function MerchantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? 'pending';
  let merchants: Merchant[] = [];
  try {
    const res = await adminBackendFetch(`/admin/merchants?status=${encodeURIComponent(status)}`);
    if (res.status === 401 || res.status === 403) redirect('/admin/login');
    merchants = res.ok ? await res.json() : [];
  } catch (e: unknown) {
    // Re-throw Next.js redirect control-flow errors; redirect everything else to login.
    if (e instanceof Error && 'digest' in e && typeof (e as { digest?: string }).digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')) throw e;
    redirect('/admin/login');
  }

  return <MerchantsView merchants={merchants} status={status} />;
}
