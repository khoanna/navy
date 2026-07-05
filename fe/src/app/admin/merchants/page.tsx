import { adminBackendFetch } from '@/lib/admin-api';
import MerchantsView, { Merchant } from './MerchantsView';

export default async function MerchantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? 'pending';
  const res = await adminBackendFetch(`/admin/merchants?status=${encodeURIComponent(status)}`);
  const merchants: Merchant[] = res.ok ? await res.json() : [];

  return <MerchantsView merchants={merchants} status={status} />;
}
