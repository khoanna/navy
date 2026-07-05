'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Modal } from '@/ui/Modal';
import { colors, space, radius } from '@/ui/theme';

export default function Actions({ id, canApprove }: { id: string; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  async function call(action: 'approve' | 'reject', rejectReason?: string) {
    setBusy(true); setError('');
    const res = await fetch(`/api/admin/merchants/${id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: action === 'reject' ? JSON.stringify({ reason: rejectReason }) : undefined,
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json().catch(() => ({})))?.error ?? `Failed (${res.status})`);
  }

  function closeReject() {
    setRejecting(false);
    setReason('');
  }

  function confirmReject() {
    const trimmed = reason.trim();
    closeReject();
    call('reject', trimmed.length ? trimmed : undefined);
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
            onPress={() => setRejecting(true)}
          />
        </div>
      </div>
      {!canApprove && (
        <Text variant="caption" dim>Merchant must set a payout address first.</Text>
      )}
      {error && <Text variant="caption" color={colors.danger}>{error}</Text>}

      <Modal
        open={rejecting}
        title="Reject merchant"
        subtitle="Optionally note why — the merchant will see this reason."
        onClose={closeReject}
      >
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmReject(); }}
          placeholder="Rejection reason (optional)"
          style={{
            width: '100%',
            background: colors.bgElevated,
            border: `1px solid ${colors.borderStrong}`,
            borderRadius: radius.md,
            color: colors.text,
            padding: '12px 14px',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: space.md }}>
          <div style={{ minWidth: 120 }}>
            <Button label="Cancel" variant="ghost" onPress={closeReject} />
          </div>
          <div style={{ minWidth: 120 }}>
            <Button label="Reject" variant="danger" onPress={confirmReject} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
