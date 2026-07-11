import { useState } from 'react';
import { useFundSolanaWallet, PrivyUIError } from '@privy-io/expo/ui';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/Toast';

export function FundButton({
  address,
  variant = 'secondary',
}: {
  address?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const { fundWallet } = useFundSolanaWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (!address) return;
    setBusy(true);
    try {
      // Navy is devnet-only (see CLAUDE.md)
      await fundWallet({ address, cluster: { name: 'devnet' } });
    } catch (e: unknown) {
      // User cancelled the funding flow — no error toast needed
      if (e instanceof PrivyUIError && e.code === 'funding_flow_cancelled') return;
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
