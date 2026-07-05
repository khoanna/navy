import { adminBackendFetch } from '@/lib/admin-api';
import DetailView, { MerchantDetailData } from './DetailView';

export default async function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await adminBackendFetch(`/admin/merchants/${id}`);
  const m: MerchantDetailData | null = res.ok ? await res.json() : null;
  if (!m) return <main style={{ padding: 32 }}><p>Merchant not found.</p></main>;

  return <DetailView m={m} />;
}
