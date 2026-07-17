import { useEmbeddedEthereumWallet, usePrivy } from '@privy-io/expo';
import { useEffect, useRef } from 'react';
import type { Eip712TypedData } from '@/lib/pay/navyPayClient';

/**
 * Adapts Privy Expo embedded-Ethereum signing to the payFlow / farming signer shape:
 * { address, signTypedData, wallets, ready }.
 *
 * Verified against @privy-io/expo@0.70.0 (js-sdk-core@0.68.0):
 *  - usePrivy() -> { user, isReady, ... } (no `authenticated`; derive it from `user != null`).
 *  - useEmbeddedEthereumWallet() -> UseEmbeddedEthereumWallet:
 *      { wallets: ConnectedEthereumWallet[]; create: (opts?) => Promise<{ user }> }.
 *    (Unlike the Solana hook this is a plain object — `wallets`/`create` are always present.)
 *  - ConnectedEthereumWallet: { address, walletIndex, chainType: 'ethereum', getProvider() }.
 *  - getProvider() => Promise<PrivyEmbeddedWalletProvider> (an EIP-1193 EmbeddedWalletProvider
 *    with `request({ method, params? }): Promise<any>`).
 *  - EIP-712 signing: provider.request({ method: 'eth_signTypedData_v4',
 *      params: [address, JSON.stringify(typedData)] }) => 0x-prefixed 65-byte signature string.
 */
export function useMobileSigner() {
  const { isReady, user } = usePrivy();
  const authenticated = !!user;
  const eth = useEmbeddedEthereumWallet();
  const wallets = eth?.wallets ?? [];
  const wallet = wallets[0];
  const address = wallet?.address as string | undefined;

  // Fallback provisioning (mirrors the prior Solana signer): `createOnLogin` covers fresh
  // logins, but a user authenticated before that config existed (or whose creation was
  // interrupted) can be authenticated with no embedded EVM wallet. Once Privy is ready and
  // there's still no wallet, create one. Latched per mount so we never double-create or hot-loop.
  const creatingRef = useRef(false);
  useEffect(() => {
    const create = eth?.create;
    if (isReady && authenticated && !wallet && !creatingRef.current && typeof create === 'function') {
      creatingRef.current = true;
      Promise.resolve(create()).catch(() => {
        // Swallow: e.g. "already has an embedded wallet" (a race with createOnLogin) —
        // the wallets list will populate on the next render.
      });
    }
  }, [isReady, authenticated, eth, wallet]);

  const signTypedData = async (typedData: Eip712TypedData): Promise<string> => {
    if (!wallet) throw new Error('No embedded Ethereum wallet available');
    const provider = await wallet.getProvider();
    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [wallet.address, JSON.stringify(typedData)],
    });
    return signature as string;
  };

  return { address, signTypedData, wallets, ready: !!isReady };
}
