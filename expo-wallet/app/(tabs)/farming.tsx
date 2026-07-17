import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { FarmingClient, formatUsdc, Position } from '@/lib/farming/farmingClient';
import { AutoFarmToggle } from '@/features/farming/AutoFarmToggle';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { IconBadge, GlowIcon, Pill, PressRow } from '@/ui/Bits';
import { Skeleton } from '@/ui/Skeleton';
import { useToast } from '@/ui/Toast';
import { colors, gradients, radius, space } from '@/ui/theme';

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-6)}`;
}

export default function Farming() {
  const { session } = useNavySession();
  const { address } = useMobileSigner();
  const toast = useToast();
  const token = session?.tokens.accessToken;
  const client = new FarmingClient(getEnv().navyApiUrl);

  const [pos, setPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setPos(await client.getPosition(token));
    } catch {
      setPos(null);
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pull = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const guard = async (fn: () => Promise<void>, label: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    guard(
      () => client.createSubwallet(token!).then(() => {}),
      'Could not start farming',
    );

  const fund = () =>
    guard(async () => {
      if (!pos) return;
      // On EVM, moving USDC main→subwallet is done server-side via delegated signing
      // (the Privy authorization key) — the embedded wallet only signs EIP-712 payment
      // authorizations, not arbitrary transfers. `fund-now` computes the spare balance
      // and tops up the subwallet (or skips when there's nothing to move).
      const r = await client.fundNow(token!);
      toast('skipped' in r ? `Nothing to fund (${r.skipped})` : 'Funded your farming subwallet.');
    }, 'Funding failed');

  const withdraw = () =>
    guard(async () => {
      const r = await client.withdraw(token!, 'all');
      toast(`Withdrawn: Tx ${r.txSignature.slice(0, 16)}…`);
    }, 'Withdraw failed');

  const copySubwallet = async () => {
    if (!pos) return;
    try {
      await Clipboard.setStringAsync(pos.address);
      toast('Subwallet address copied.');
    } catch {
      toast('Could not copy address.');
    }
  };

  const principal = pos ? Number(formatUsdc(pos.principalLamports)) : 0;
  const current = pos ? Number(formatUsdc(pos.currentValueLamports)) : 0;
  const gain = current - principal;
  const gainPct = principal > 0 ? (gain / principal) * 100 : 0;

  const loading = !loaded;

  return (
    <Screen scroll tabSafe onRefresh={pull} refreshing={refreshing}>
      {/* Header */}
      <View style={styles.head}>
        <Text variant="h2" color={colors.textHi}>
          Earn
        </Text>
        <Text variant="caption" dim>
          Aave · Sepolia
        </Text>
      </View>

      <AutoFarmToggle />

      {loading ? (
        /* Loading hero */
        <Gradient colors={gradients.oceanDeep} glow style={styles.hero}>
          <Text variant="label" upper center color="rgba(255,255,255,0.6)">
            Deposited · earning
          </Text>
          <View style={styles.heroSkeleton} />
        </Gradient>
      ) : !pos ? (
        /* Empty state — start farming */
        <View style={styles.emptyInner}>
          <GlowIcon name="sprout" color={colors.aqua} size={96} />
          <Text
            variant="h2"
            color={colors.textHi}
            center
            style={styles.emptyTitle}
          >
            Start earning
          </Text>
          <Text dim center style={styles.emptyBody}>
            Navy creates a secure, encrypted subwallet that auto-deposits into
            the yield reserve. Your keys never leave Navy's signer.
          </Text>
          <Button
            label="Create farming wallet"
            icon="plus"
            loading={busy}
            onPress={start}
            style={styles.emptyBtn}
          />
        </View>
      ) : (
        <>
          {/* Position hero */}
          <Gradient colors={gradients.oceanDeep} glow style={styles.hero}>
            <Text variant="label" upper center color="rgba(255,255,255,0.6)">
              Deposited · earning
            </Text>
            <View style={styles.heroAmt}>
              <Text variant="display" numeric color={colors.textHi}>
                {current.toFixed(4)}
              </Text>
              <Text variant="h3" color="rgba(255,255,255,0.62)" style={styles.heroUnit}>
                USDC
              </Text>
            </View>
            <Text variant="caption" color="rgba(255,255,255,0.82)">
              {gain >= 0 ? '+' : ''}
              {gain.toFixed(4)} USDC earned ({gainPct >= 0 ? '+' : ''}
              {gainPct.toFixed(2)}%)
            </Text>
          </Gradient>

          {/* Deposit / Withdraw actions */}
          <View style={styles.btnRow}>
            <View style={styles.btnItem}>
              <Button
                label="Fund from wallet"
                icon="plus"
                loading={busy}
                onPress={fund}
              />
            </View>
            <View style={styles.btnItem}>
              <Button
                label="Withdraw all"
                icon="down"
                variant="secondary"
                loading={busy}
                onPress={withdraw}
              />
            </View>
          </View>

          {/* How it works */}
          <Text variant="h3" color={colors.textHi} style={styles.howTitle}>
            How it works
          </Text>
          <Card glass compact style={styles.howCard}>
            <Text variant="caption" color={colors.text}>
              Your USDC is supplied to Aave's USDC reserve via a Navy-secured
              subwallet. Keys stay encrypted — the agent can never move funds
              off-policy.
            </Text>
          </Card>

          {/* Positions list */}
          <Card glass compact style={styles.posCard}>
            <View style={styles.posRow}>
              <IconBadge name="sprout" color={colors.aqua} />
              <View style={styles.posMid}>
                <Text variant="bodyStrong" color={colors.textHi}>
                  USDC reserve
                </Text>
                <PressRow onPress={copySubwallet} style={styles.copyRow}>
                  <Text variant="mono" color={colors.textDim}>
                    {short(pos.address)}
                  </Text>
                  <Icon name="copy" size={12} color={colors.textDim} />
                </PressRow>
              </View>
              <Text variant="bodyStrong" numeric color={colors.textHi}>
                {current.toFixed(4)} USDC
              </Text>
            </View>
          </Card>

          {/* Devnet note */}
          <View style={styles.noteRow}>
            <Pill label="Sepolia" />
            <Text variant="caption" muted style={styles.noteText}>
              Funding moves USDC from your main wallet into the subwallet.
              Withdraw returns principal + yield to your wallet.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: space.md,
  },
  hero: {
    borderRadius: radius.xl,
    padding: space.xl,
    marginTop: space.xl,
    alignItems: 'center',
    gap: space.xs,
    // iOS shadow
    shadowColor: '#04121A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 42,
    elevation: 14,
  },
  heroSkeleton: {
    width: 170,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginTop: 6,
    marginBottom: 2,
  },
  heroAmt: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: 2,
    marginBottom: 2,
  },
  heroUnit: {
    marginLeft: 6,
  },
  emptyInner: {
    alignItems: 'center',
    maxWidth: 320,
    marginTop: 72,
    alignSelf: 'center',
  },
  emptyTitle: {
    marginTop: space.lg,
  },
  emptyBody: {
    marginTop: space.sm,
    marginBottom: space.xl,
    textAlign: 'center',
  },
  emptyBtn: {
    alignSelf: 'stretch',
  },
  btnRow: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.lg,
  },
  btnItem: {
    flex: 1,
  },
  howTitle: {
    marginTop: space.xl,
    marginBottom: space.md,
  },
  howCard: {},
  posCard: {
    marginTop: space.md,
  },
  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  posMid: {
    flex: 1,
    minWidth: 0,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xl,
  },
  noteText: {
    flex: 1,
  },
});
