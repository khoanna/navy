'use client';
import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import { useSignTransaction, useSolanaWallets } from '@privy-io/react-auth/solana';
import { getEnv } from '@/lib/config/env';

/**
 * Adapts Privy web Solana signing to the payFlow / farming signer shape.
 *
 * Verified against @privy-io/react-auth@2.25.0:
 *  - useSolanaWallets() -> { ready, wallets: ConnectedSolanaWallet[], ... }; ConnectedSolanaWallet.address: string
 *  - useSignTransaction() -> { signTransaction: (o: { transaction: Transaction | VersionedTransaction;
 *      connection: Connection; address?: string }) => Promise<Transaction | VersionedTransaction> }
 *
 * The embedded wallet is pinned by `walletClientType === 'privy' | 'privy-v2'` — per the
 * @privy-io/react-auth@2.25.0 types (types-B_DvyjIb.d.ts: "Only applies to embedded wallets
 * (`walletClientType === 'privy'` or `walletClientType === 'privy-v2'`)"). This avoids signing
 * with an unexpected `wallets[0]` if an external wallet is ever connected.
 *
 * The returned `sign` satisfies payFlow's `signTransaction: (tx: Transaction) => Promise<Transaction>`.
 */
const EMBEDDED_CLIENT_TYPES = new Set(['privy', 'privy-v2']);

export function useWebSigner() {
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const embedded = wallets?.find((w) => EMBEDDED_CLIENT_TYPES.has(w.walletClientType));
  const address = embedded?.address as string | undefined;

  const sign = async (tx: Transaction): Promise<Transaction> => {
    const wallet = wallets?.find((w) => EMBEDDED_CLIENT_TYPES.has(w.walletClientType));
    if (!wallet) throw new Error('No Solana embedded wallet available');
    const connection = new Connection(getEnv().solanaRpc);
    const signed = await signTransaction({ transaction: tx, connection, address: wallet.address });
    // Privy returns a legacy Transaction for the legacy Transaction we pass in.
    if (signed instanceof Transaction) return signed;
    // Defensive fallback: rebuild a legacy Transaction from serialized bytes via Uint8Array (browser-safe).
    return Transaction.from(Uint8Array.from((signed as VersionedTransaction).serialize()));
  };

  return { address, sign, wallets };
}
