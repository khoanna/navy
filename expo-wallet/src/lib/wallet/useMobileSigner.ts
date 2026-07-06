import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { useEffect, useRef } from 'react';

/**
 * Adapts Privy Expo Solana signing to the payFlow / farming signer shape.
 * Same contract as web-wallet's useWebSigner: { address, sign, wallets, ready }.
 *
 * Verified against @privy-io/expo@0.70.0 (js-sdk-core@0.68.0):
 *  - usePrivy() -> { user, isReady, error, logout, getAccessToken } (no `authenticated`;
 *    derive it from `user != null`).
 *  - useEmbeddedSolanaWallet() -> EmbeddedSolanaWalletState (a discriminated union). The
 *    `wallets` array and `create()` action are present in every status EXCEPT `disconnected`
 *    (there they're `Partial`), so both are accessed optionally.
 *  - ConnectedEmbeddedSolanaWallet: { address, publicKey, walletIndex, getProvider() }.
 *    These are all embedded wallets (no external `walletClientType`), so no client-type
 *    pinning is needed — wallets[0] is the embedded wallet.
 *  - create: (opts?) => Promise<PrivyEmbeddedSolanaWalletProvider | null>  (NOT `createWallet`).
 *  - provider.request({ method: 'signTransaction', params: { transaction } }) => { signedTransaction }
 *    (EmbeddedSolanaWalletProvider; T defaults to legacy Transaction, so a Transaction in → Transaction out).
 */
export function useMobileSigner() {
  const { isReady, user } = usePrivy();
  const authenticated = !!user;
  const solana = useEmbeddedSolanaWallet();
  const wallets = solana?.wallets ?? [];
  const wallet = wallets[0];
  const address = wallet?.address as string | undefined;

  // Fallback provisioning (mirrors useWebSigner): `embedded.solana.createOnLogin` covers
  // fresh logins, but a user authenticated before that config existed (or whose creation
  // was interrupted) can be authenticated with no Solana wallet. Once Privy is ready and
  // there's still no wallet, create one. Latched per mount so we never double-create
  // (which throws) or hot-loop.
  const creatingRef = useRef(false);
  useEffect(() => {
    const create = solana?.create;
    if (isReady && authenticated && !wallet && !creatingRef.current && typeof create === 'function') {
      creatingRef.current = true;
      Promise.resolve(create()).catch(() => {
        // Swallow: e.g. "already has an embedded wallet" (a race with createOnLogin) —
        // the wallets list will populate on the next render.
      });
    }
  }, [isReady, authenticated, solana, wallet]);

  const sign = async (tx: Transaction): Promise<Transaction> => {
    if (!wallet) throw new Error('No Solana embedded wallet available');
    const provider = await wallet.getProvider();
    const { signedTransaction } = await provider.request({
      method: 'signTransaction',
      params: { transaction: tx },
    });
    // Privy returns a legacy Transaction for the legacy Transaction we pass in.
    if (signedTransaction instanceof Transaction) return signedTransaction;
    // Defensive fallback: rebuild a legacy Transaction from serialized bytes.
    return Transaction.from(Uint8Array.from((signedTransaction as VersionedTransaction).serialize()));
  };

  return { address, sign, wallets, ready: !!isReady };
}
