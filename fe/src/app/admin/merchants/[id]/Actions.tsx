'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Actions({ id, canApprove }: { id: string; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function call(action: 'approve' | 'reject', reason?: string) {
    setBusy(true); setError('');
    const res = await fetch(`/api/admin/merchants/${id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? `Failed (${res.status})`);
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
      <button disabled={!canApprove || busy} onClick={() => call('approve')} title={canApprove ? '' : 'Merchant must set a payout address first'}>
        Approve
      </button>
      <button disabled={busy} onClick={() => call('reject', prompt('Rejection reason?') ?? undefined)}>Reject</button>
      {error && <span style={{ color: 'crimson' }}>{error}</span>}
    </div>
  );
}
