'use client';
import React, { useMemo, useState, useCallback } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import '@solana/wallet-adapter-react-ui/styles.css';

function PayoutInner() {
  const { publicKey, signMessage, connected } = useWallet();
  const [status, setStatus] = useState('');

  const setPayout = useCallback(async () => {
    if (!publicKey || !signMessage) { setStatus('Connect a wallet first'); return; }
    setStatus('Requesting signature…');
    try {
      const address = publicKey.toBase58();
      const prep = await fetch('/api/merchant/payout/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }),
      }).then((r) => r.json());
      const message: string = prep.message;
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, message, signature }),
      });
      setStatus(res.ok ? `Payout address set: ${address}` : 'Backend rejected the payout binding');
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    }
  }, [publicKey, signMessage]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <WalletMultiButton />
      {status && <p>{status}</p>}
    </div>
  );
}

export default function WalletConnect() {
  const endpoint = useMemo(() => clusterApiUrl('devnet'), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <PayoutInner />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
