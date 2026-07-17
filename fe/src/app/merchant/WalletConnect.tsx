'use client';
import React, { useCallback, useState } from 'react';
import { BrowserProvider, type Eip1193Provider } from 'ethers';

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export default function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const connect = useCallback(async () => {
    if (!window.ethereum) { setStatus('No EVM wallet found. Install MetaMask.'); return; }
    setStatus('Connecting…');
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      setAddress(await signer.getAddress());
      setStatus('');
    } catch (e) {
      setStatus(`Failed to connect: ${(e as Error).message}`);
    }
  }, []);

  const setPayout = useCallback(async () => {
    if (!window.ethereum) { setStatus('Connect a wallet first'); return; }
    setStatus('Requesting signature…');
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);

      const prep = await fetch('/api/merchant/payout/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }),
      }).then((r) => r.json());
      const message: string = prep.message;

      const signature = await signer.signMessage(message);

      const res = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, message, signature }),
      });
      setStatus(res.ok ? `Payout address set: ${addr}` : 'Backend rejected the payout binding');
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    }
  }, []);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {address
        ? <p>Connected: {address}</p>
        : <button onClick={connect}>Connect wallet</button>}
      <button onClick={setPayout} disabled={!address}>Set payout address</button>
      {status && <p>{status}</p>}
    </div>
  );
}
