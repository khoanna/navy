import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useHeadlessDelegatedActions } from '@privy-io/expo';

import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { FarmingClient } from '@/lib/farming/farmingClient';
import { delegationUiState } from '@/lib/account/delegationStatus';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { useToast } from '@/ui/Toast';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { IconBadge } from '@/ui/Bits';
import { colors, space } from '@/ui/theme';

export function AutoFarmToggle() {
  const { session } = useNavySession();
  const token = session?.tokens.accessToken;
  const client = new FarmingClient(getEnv().navyApiUrl);

  const { address } = useMobileSigner();
  const { delegateWallet, revokeWallets } = useHeadlessDelegatedActions();
  const toast = useToast();

  const [state, setState] = useState<'unavailable' | 'off' | 'on' | 'loading'>('loading');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!token) { setState('unavailable'); return; }
    try {
      setState(delegationUiState(await client.getDelegation(token)));
    } catch {
      setState('unavailable');
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const enable = async () => {
    if (!address || !token) return;
    setBusy(true);
    try {
      await delegateWallet({ address, chainType: 'solana' });
      await client.enableDelegation(token);
      const funded = await client.fundNow(token);
      toast('skipped' in funded ? `Auto-farm on (${funded.skipped})` : 'Auto-farm on — funded');
      await refresh();
    } catch (e: unknown) {
      toast(`Could not enable auto-farm: ${e instanceof Error ? e.message : 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await client.disableDelegation(token);
      await revokeWallets();
      toast('Auto-farm off');
      await refresh();
    } catch (e: unknown) {
      toast(`Could not disable: ${e instanceof Error ? e.message : 'try again'}`);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'unavailable' || state === 'loading') return null;

  return (
    <Card glass compact style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <IconBadge name="sprout" color={colors.textDim} />
        <View style={{ flex: 1 }}>
          <Text variant="body" color={colors.textHi}>Auto-farm</Text>
          <Text variant="caption" color={colors.textDim}>
            Let Navy top up your farming wallet automatically from your balance.
          </Text>
        </View>
      </View>
      {state === 'on'
        ? <Button label="Turn off auto-farm" variant="danger" onPress={disable} loading={busy} />
        : <Button label="Enable auto-farm" onPress={enable} loading={busy} disabled={!address} />}
    </Card>
  );
}
