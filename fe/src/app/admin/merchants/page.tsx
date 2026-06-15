import Link from 'next/link';
import { adminBackendFetch } from '@/lib/admin-api';

interface Merchant { id: string; email: string; businessName: string; approvalStatus: string; payoutAddress: string | null; onchainRegisteredAt: string | null; }

export default async function MerchantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? 'pending';
  const res = await adminBackendFetch(`/admin/merchants?status=${encodeURIComponent(status)}`);
  const merchants: Merchant[] = res.ok ? await res.json() : [];

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Merchants</h1>
      <nav style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <Link key={s} href={`/admin/merchants?status=${s}`} style={{ fontWeight: s === status ? 700 : 400 }}>{s}</Link>
        ))}
      </nav>
      <table cellPadding={8} style={{ borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Business</th><th align="left">Email</th><th align="left">Status</th><th align="left">Payout</th><th /></tr></thead>
        <tbody>
          {merchants.map((m) => (
            <tr key={m.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{m.businessName}</td><td>{m.email}</td><td>{m.approvalStatus}</td>
              <td>{m.payoutAddress ? '✓' : '—'}</td>
              <td><Link href={`/admin/merchants/${m.id}`}>review</Link></td>
            </tr>
          ))}
          {merchants.length === 0 && <tr><td colSpan={5}>No merchants.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
