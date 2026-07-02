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
 * The returned `sign` satisfies payFlow's `signTransaction: (tx: Transaction) => Promise<Transaction>`.
 */
export function useWebSigner() {
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const address = wallets?.[0]?.address as string | undefined;

  const sign = async (tx: Transaction): Promise<Transaction> => {
    const wallet = wallets[0];
    if (!wallet) throw new Error('No Solana embedded wallet available');
    const connection = new Connection(getEnv().solanaRpc);
    const signed = await signTransaction({ transaction: tx, connection, address: wallet.address });
    if (signed instanceof Transaction) return signed;
    // Fallback: rebuild a legacy Transaction from serialized bytes if a non-legacy tx is returned.
    if (signed instanceof VersionedTransaction) {
      return Transaction.from(Buffer.from(signed.serialize()));
    }
    return Transaction.from((signed as { signedTransaction: Uint8Array }).signedTransaction);
  };

  return { address, sign, wallets };
}
