import { useState } from 'react';
import { useFundWallet, PrivyUIError } from '@privy-io/expo/ui';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';

export function FundButton({
  address,
  variant = 'secondary',
}: {
  address?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  // EVM funding hook (was Solana `useFundSolanaWallet`). `chain` defaults to the app's
  // configured chain (Base); we leave it unset to avoid importing a viem Chain object.
  const { fundWallet } = useFundWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (!address) return;
    setBusy(true);
    try {
      // Navy runs on Base (mainnet or Anvil fork) — on-ramps (MoonPay/Coinbase) operate
      // on mainnet so funding should work; chain_not_supported surfaces for testnets.
      await fundWallet({ address });
    } catch (e: unknown) {
      // User cancelled the funding flow — no error toast needed
      if (e instanceof PrivyUIError && e.code === 'funding_flow_cancelled') return;
      // On testnet, MoonPay/Coinbase etc. don't operate — Privy throws chain_not_supported
      // or asset_not_supported instead of opening the on-ramp sheet.
      if (e instanceof PrivyUIError && (e.code === 'chain_not_supported' || e.code === 'asset_not_supported')) {
        toast('On-ramp funding isn\'t available on testnet');
        return;
      }
      toast(`Could not open funding: ${e instanceof Error ? e.message : 'unavailable'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      label="Add funds"
      icon="plus"
      variant={variant}
      onPress={onPress}
      loading={busy}
      disabled={!address}
    />
  );
}
