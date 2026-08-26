'use client';
import { useState } from 'react';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { IconBadge, Field } from '@/ui/Bits';
import { useToast } from '@/ui/Toast';
type ToastFn = ReturnType<typeof useToast>;
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';
import { colors, space, radius } from '@/ui/theme';

/** Mask a string showing only first 4 and last 4 chars. */
function mask(s: string): string {
  if (s.length <= 12) return '••••••••••••';
  return `${s.slice(0, 6)}••••${s.slice(-4)}`;
}

const codeStyle: React.CSSProperties = {
  background: colors.bg,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: `${space.sm}px ${space.md}px`,
  fontFamily: 'monospace',
  fontSize: 12,
  color: colors.text,
  overflowX: 'auto',
  whiteSpace: 'pre' as const,
  lineHeight: 1.7,
};

async function copy(text: string, toast: ToastFn) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success');
  } catch {
    toast('Copy failed', 'error');
  }
}

interface IssuedKey {
  apiKey: string;
  apiSecret: string;
}

export default function ApiKeyPanel() {
  const toast = useToast();
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
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

  // Build the cURL example using the issued key so the placeholder is concrete.
  const curlExample = issued
    ? `curl -X POST https://api.navy.finance/v1/orders \\
  -H "X-Navy-Key: ${issued.apiKey}" \\
  -H "X-Navy-Signature: <HMAC-SHA256(secret, body)>" \\
  -H "Content-Type: application/json" \\
  -d '{"items": [{"productId": "uuid", "quantity": 1}], "callbackUrl": "https://your-site.com/webhook"}'`
    : `curl -X POST https://api.navy.finance/v1/orders \\
  -H "X-Navy-Key: <your-api-key>" \\
  -H "X-Navy-Signature: <HMAC-SHA256(secret, body)>" \\
  -H "Content-Type: application/json" \\
  -d '{"items": [{"productId": "uuid", "quantity": 1}], "callbackUrl": "https://your-site.com/webhook"}'`;

  return (
    <Card glass compact>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.lg }}>
        <IconBadge name="key" color={colors.textDim} size={38} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text variant="label" upper dim style={{ display: 'block' }}>API credentials</Text>
          <Text variant="caption" dim style={{ display: 'block' }}>
            Server-to-server key for the payments API. Requires an approved payout wallet.
          </Text>
        </div>
      </div>

      {!issued ? (
        <Button label="Generate API key" variant="secondary" icon="key" loading={busy} onPress={create} />
      ) : (
        <>
          {/* API Key row */}
          <div style={{ marginBottom: space.md }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs }}>
              <Text variant="label" muted upper>API key</Text>
              <div style={{ display: 'flex', gap: space.sm }}>
                <Button
                  label={showKey ? 'Hide' : 'Show'}
                  variant="ghost"
                  full={false}
                  onPress={() => setShowKey((v) => !v)}
                  style={{ height: 32, paddingLeft: 10, paddingRight: 10 }}
                />
                <Button
                  label="Copy"
                  variant="ghost"
                  full={false}
                  onPress={() => copy(issued.apiKey, toast)}
                  style={{ height: 32, paddingLeft: 10, paddingRight: 10 }}
                />
              </div>
            </div>
            <div style={codeStyle}>{showKey ? issued.apiKey : mask(issued.apiKey)}</div>
          </div>

          {/* API Secret row */}
          <div style={{ marginBottom: space.lg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs }}>
              <Text variant="label" muted upper>API secret (shown once)</Text>
              <div style={{ display: 'flex', gap: space.sm }}>
                <Button
                  label={showSecret ? 'Hide' : 'Show'}
                  variant="ghost"
                  full={false}
                  onPress={() => setShowSecret((v) => !v)}
                  style={{ height: 32, paddingLeft: 10, paddingRight: 10 }}
                />
                <Button
                  label="Copy"
                  variant="ghost"
                  full={false}
                  onPress={() => copy(issued.apiSecret, toast)}
                  style={{ height: 32, paddingLeft: 10, paddingRight: 10 }}
                />
              </div>
            </div>
            <div style={codeStyle}>{showSecret ? issued.apiSecret : mask(issued.apiSecret)}</div>
          </div>

          {/* How to use */}
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: space.lg }}>
            <Text variant="h3" color={colors.textHi} style={{ marginBottom: space.xs }}>
              How to use
            </Text>
            <Text variant="caption" dim style={{ marginBottom: space.md }}>
              Sign every request with HMAC-SHA256 using your API secret as the key. The signature covers the raw request body.
            </Text>

            <Text variant="label" muted upper style={{ marginBottom: space.sm }}>
              cURL example — create an order
            </Text>
            <div style={{ position: 'relative' }}>
              <pre style={{ ...codeStyle, marginBottom: space.sm }}>{curlExample}</pre>
              <Button
                label="Copy cURL"
                variant="ghost"
                full={false}
                onPress={() => copy(curlExample, toast)}
                style={{ position: 'absolute', top: space.sm, right: space.sm, height: 32, paddingLeft: 10, paddingRight: 10 }}
              />
            </div>

            {/* Webhook URL info */}
            <div
              style={{
                marginTop: space.lg,
                padding: space.md,
                background: colors.glassFill,
                borderRadius: radius.md,
                border: `1px solid ${colors.border}`,
              }}
            >
              <Text variant="bodyStrong" color={colors.textHi} style={{ marginBottom: space.xs }}>
                Webhook notifications
              </Text>
              <Text variant="caption" dim style={{ marginBottom: space.sm }}>
                Pass <code style={{ fontFamily: 'monospace', fontSize: 12 }}>callbackUrl</code> in the order body to receive HTTPS notifications when a payment is confirmed.
                The webhook fires a POST to your URL with the order status and transaction details, signed with an HMAC-SHA256 secret.
              </Text>
              <Text variant="caption" dim>
                You can set a default webhook URL in your server configuration, or pass it per-order in the <code style={{ fontFamily: 'monospace', fontSize: 12 }}>callbackUrl</code> field.
              </Text>
            </div>

            {/* Regenerate hint */}
            <Text variant="caption" dim style={{ marginTop: space.md }}>
              Generate a new key to rotate. The old key is invalidated immediately.
            </Text>
            <div style={{ marginTop: space.md }}>
              <Button
                label="Regenerate key"
                variant="ghost"
                full={false}
                loading={busy}
                onPress={() => { setIssued(null); create(); }}
                style={{ height: 32, paddingLeft: 10, paddingRight: 10 }}
              />
            </div>
          </div>
        </>
      )}

      {error && (
        <Text variant="caption" color={colors.danger} style={{ marginTop: space.md }}>{error}</Text>
      )}
    </Card>
  );
}
