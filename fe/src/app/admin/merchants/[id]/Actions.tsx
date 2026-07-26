'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { Modal } from '@/ui/Modal';
import { useToast } from '@/ui/Toast';
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';
import { colors, space, radius } from '@/ui/theme';

async function detailOf(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (typeof b.message === 'string') return b.message;
  }
  return undefined;
}

export default function Actions({ id, canApprove }: { id: string; canApprove: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  async function call(action: 'approve' | 'reject', rejectReason?: string) {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/admin/merchants/${id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({ reason: rejectReason }) : undefined,
      });
      if (!res.ok) throw new NavyApiError(`${action} failed`, res.status, await detailOf(res));
      toast(action === 'approve' ? 'Merchant approved' : 'Merchant rejected', 'success');
      router.refresh();
    } catch (e) {
      setError(mapError(e).detail);
    } finally {
      setBusy(false);
    }
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
