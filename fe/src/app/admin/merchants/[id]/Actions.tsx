'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, marginTop: space.xl }}>
      <div style={{ display: 'flex', gap: space.md, alignItems: 'center' }}>
        <div style={{ minWidth: 180 }}>
          <Button
            label="Approve"
            variant="primary"
            loading={busy}
            disabled={!canApprove || busy}
            onPress={() => call('approve')}
          />
        </div>
        <div style={{ minWidth: 180 }}>
          <Button
            label="Reject"
            variant="danger"
            disabled={busy}
            onPress={() => call('reject', prompt('Rejection reason?') ?? undefined)}
          />
        </div>
      </div>
      {!canApprove && (
        <Text variant="caption" dim>Merchant must set a payout address first.</Text>
      )}
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}
    </div>
  );
}
