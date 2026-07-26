'use client';
import { useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { IconBadge, Field } from '@/ui/Bits';
import { useToast } from '@/ui/Toast';
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';
import { colors, space } from '@/ui/theme';

export default function ApiKeyPanel() {
  const toast = useToast();
  const [issued, setIssued] = useState<{ apiKey: string; apiSecret: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/merchant/api-keys', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new NavyApiError('api key failed', res.status,
          (body && typeof body.error === 'string' ? body.error : undefined) ?? 'Failed (is your merchant account approved?)');
      }
      setIssued({ apiKey: body.apiKey, apiSecret: body.apiSecret });
      toast('API key generated', 'success');
    } catch (e) {
      setError(mapError(e).detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card glass compact>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.lg }}>
        <IconBadge name="key" color={colors.textDim} size={38} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text variant="label" upper dim style={{ display: 'block' }}>API credentials</Text>
          <Text variant="caption" dim style={{ display: 'block' }}>Server-to-server key for the payments API</Text>
        </div>
      </div>
      <Button label="Generate API key" variant="secondary" icon="key" loading={busy} onPress={create} />
      {error && (
        <Text variant="caption" color={colors.danger} style={{ marginTop: space.md }}>{error}</Text>
      )}
      {issued && (
        <div style={{ marginTop: space.lg, display: 'flex', flexDirection: 'column', gap: space.md }}>
          <Field label="API key" value={issued.apiKey} mono />
          <Field label="API secret (shown once)" value={issued.apiSecret} mono />
        </div>
      )}
    </Card>
  );
}
