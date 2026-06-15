import Link from 'next/link';
import { adminBackendFetch } from '@/lib/admin-api';
import Actions from './Actions';

export default async function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await adminBackendFetch(`/admin/merchants/${id}`);
  const m = res.ok ? await res.json() : null;
  if (!m) return <main style={{ padding: 32 }}><p>Merchant not found.</p></main>;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 640 }}>
      <p><Link href="/admin/merchants">← merchants</Link></p>
      <h1>{m.businessName}</h1>
      <dl>
        <dt>Email</dt><dd>{m.email}</dd>
        <dt>Status</dt><dd><b>{m.approvalStatus}</b></dd>
        <dt>Payout address</dt><dd>{m.payoutAddress ?? <i>not set</i>}</dd>
        <dt>On-chain tx</dt><dd>{m.onchainRegisterTx ? <a href={`https://explorer.solana.com/tx/${m.onchainRegisterTx}?cluster=devnet`} target="_blank">{m.onchainRegisterTx.slice(0, 16)}…</a> : '—'}</dd>
        {m.rejectionReason && (<><dt>Rejection reason</dt><dd>{m.rejectionReason}</dd></>)}
      </dl>
      <Actions id={m.id} canApprove={!!m.payoutAddress} />
    </main>
  );
}
