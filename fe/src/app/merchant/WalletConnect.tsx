'use client';
import React, { useCallback, useState } from 'react';
import { BrowserProvider, type Eip1193Provider } from 'ethers';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { ErrorState } from '@/ui/ErrorState';
import { useToast } from '@/ui/Toast';
import { mapError } from '@/lib/mapError';
import { NavyApiError } from '@/lib/navyApi';
import type { MappedError } from '@/lib/mapError';
import { colors, space } from '@/ui/theme';

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

async function detailOf(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (typeof b.message === 'string') return b.message;
  }
  return undefined;
}

export default function WalletConnect() {
  const toast = useToast();
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<MappedError | null>(null);

  const connect = useCallback(async () => {
    if (!window.ethereum) { setErr(mapError(new Error('No EVM wallet found. Install MetaMask.'))); return; }
    setErr(null);
    setConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      setAddress(await signer.getAddress());
    } catch (e) {
      setErr(mapError(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const setPayout = useCallback(async () => {
    if (!window.ethereum) { setErr(mapError(new Error('Connect a wallet first'))); return; }
    setErr(null);
    setSaving(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);

      const prepRes = await fetch('/api/merchant/payout/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }),
      });
      const prep = await prepRes.json().catch(() => null);
      if (!prepRes.ok || !prep?.ok || !prep?.message) {
        throw new NavyApiError('challenge failed', prepRes.status, prep?.error ?? 'Could not get signing challenge');
      }
      const message: string = prep.message;

      const signature = await signer.signMessage(message);

      const res = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, message, signature }),
      });
      if (!res.ok) throw new NavyApiError('payout failed', res.status, await detailOf(res));
      toast('Payout wallet connected', 'success');
    } catch (e) {
      setErr(mapError(e));
    } finally {
      setSaving(false);
    }
  }, [toast]);

  return (
    <div style={{ display: 'grid', gap: space.md }}>
      {address
        ? <Text variant="body" color={colors.textHi}>Connected: {address}</Text>
        : <div style={{ maxWidth: 220 }}><Button label="Connect wallet" variant="secondary" loading={connecting} onPress={connect} /></div>}
      <div style={{ maxWidth: 220 }}>
        <Button label="Set payout address" loading={saving} disabled={!address} onPress={setPayout} />
      </div>
      {err && <ErrorState compact error={err} onRetry={() => setErr(null)} />}
    </div>
  );
}
