import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { parseUnits } from 'ethers';

import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { VaultClient, type VaultPosition, type VaultApy } from '@/lib/vault/vaultClient';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';
import { useAsync } from '@/lib/ui/useAsync';
import { mapSendError, MappedError } from '@/lib/wallet/sendErrors';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Gradient } from '@/ui/Gradient';
import { IconBadge, GlowIcon, Pill } from '@/ui/Bits';
import { ErrorState } from '@/ui/ErrorState';
import { StaleChip } from '@/ui/StaleChip';
import { useToast } from '@/ui/Toast';
import { colors, gradients, radius, space } from '@/ui/theme';

/** amount (decimal display string) → USDC base units (6dp) string. null if invalid / non-positive. */
function usdcAmountToBase(amount: string): string | null {
  const s = (amount ?? '').trim();
  if (!s) return null;
  try {
    const base = parseUnits(s, 6);
    return base > 0n ? base.toString() : null;
  } catch {
    return null;
  }
}

/** Convert an aprE18 (1e18-scaled) rate to a human APR percentage string. */
function aprE18ToPct(aprE18: string): string {
  try {
    const bps = (BigInt(aprE18) * 10000n) / 1_000_000_000_000_000_000n; // → basis points
    return (Number(bps) / 100).toFixed(2);
  } catch {
    return '—';
  }
}

export default function Farming() {
  const { session, authedFetch } = useNavySession();
  const { signTypedData } = useMobileSigner();
  const toast = useToast();
  const token = session?.tokens.accessToken;

  const vault = useMemo(
    () => (authedFetch ? new VaultClient(getEnv().navyApiUrl, authedFetch, signTypedData) : null),
    [authedFetch, signTypedData],
  );

  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<MappedError | null>(null);
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);

  const {
    data,
    loading,
    refreshing,
    error,
    staleError,
    retry,
  } = useAsync<{ pos: VaultPosition; apys: VaultApy[] } | null>(
    async () => {
      if (!vault || !token) return null;
      const [pos, apys] = await Promise.all([vault.getPosition(), vault.getApys().catch(() => [])]);
      return { pos, apys };
    },
    { deps: [token, vault] },
  );

  const pos = data?.pos ?? null;
  const apys = data?.apys ?? [];

  // Headline APR: the best (highest) adapter APR currently in the vault, if any.
  const bestApr = apys.reduce<bigint>((max, a) => {
    try {
      const v = BigInt(a.aprE18);
      return v > max ? v : max;
    } catch {
      return max;
    }
  }, 0n);

  const guard = async (fn: () => Promise<void>, action: () => void) => {
    if (!vault || !token) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await retry();
    } catch (e) {
      setActionError(mapSendError(e));
      setLastAction(() => action);
    } finally {
      setBusy(false);
    }
  };

  const deposit = () =>
    guard(async () => {
      const base = usdcAmountToBase(amount);
      if (!base) {
        toast('Enter a valid USDC amount.', 'error');
        throw new Error('Invalid amount');
      }
      const r = await vault!.deposit(base);
      setAmount('');
      toast(`Deposited — Tx ${r.txHash.slice(0, 16)}…`, 'success');
    }, deposit);

  // Redeem the full share balance back to the user's wallet.
  const withdrawAll = () =>
    guard(async () => {
      if (!pos || BigInt(pos.sharesBase || '0') <= 0n) {
        toast('Nothing to withdraw.', 'error');
        throw new Error('No position');
      }
      const r = await vault!.redeemShares(pos.sharesBase);
      toast(`Withdrawn — Tx ${r.txHash.slice(0, 16)}…`, 'success');
    }, withdrawAll);

  const current = pos ? Number(usdcBaseToDisplay(pos.assetsBase)) : 0;
  const hasPosition = pos ? BigInt(pos.sharesBase || '0') > 0n : false;

  return (
    <Screen scroll tabSafe onRefresh={retry} refreshing={refreshing}>
      {/* Header */}
      <View style={styles.head}>
        <Text variant="h2" color={colors.textHi}>
          Earn
        </Text>
        <Text variant="caption" dim>
          Navy vault · Sepolia
          {bestApr > 0n ? `  ·  ${aprE18ToPct(bestApr.toString())}% APR` : ''}
        </Text>
      </View>

      {staleError && !error && (
        <View style={styles.staleWrap}>
          <StaleChip onRetry={retry} />
        </View>
      )}

      {loading ? (
        <Gradient colors={gradients.oceanDeep} glow style={styles.hero}>
          <Text variant="label" upper center color="rgba(255,255,255,0.6)">
            Deposited · earning
          </Text>
          <View style={styles.heroSkeleton} />
        </Gradient>
      ) : error ? (
        <View style={styles.loadErrorWrap}>
          <ErrorState error={error} onRetry={retry} />
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
            {hasPosition && pos && (
              <Text variant="caption" color="rgba(255,255,255,0.82)">
                {usdcBaseToDisplay(pos.sharesBase)} shares
              </Text>
            )}
          </Gradient>

          {/* Deposit input */}
          <Card glass compact style={styles.depositCard}>
            <Text variant="label" upper color={colors.aqua}>
              Deposit USDC
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={colors.textDim}
                keyboardType="decimal-pad"
                style={styles.input}
                editable={!busy}
              />
              <Text variant="bodyStrong" muted>
                USDC
              </Text>
            </View>
            <Button
              label="Deposit"
              icon="plus"
              loading={busy}
              disabled={!usdcAmountToBase(amount)}
              onPress={deposit}
            />
          </Card>

          {hasPosition && (
            <View style={styles.withdrawRow}>
              <Button
                label="Withdraw all"
                icon="down"
                variant="secondary"
                loading={busy}
                onPress={withdrawAll}
              />
            </View>
          )}

          {/* Persistent, actionable error (not just a toast) */}
          {actionError && (
            <View style={styles.actionErrorWrap}>
              <ErrorState compact error={actionError} onRetry={lastAction ?? undefined} />
            </View>
          )}

          {!hasPosition && !actionError && (
            <View style={styles.emptyInner}>
              <GlowIcon name="sprout" color={colors.aqua} size={72} />
              <Text dim center style={styles.emptyBody}>
                Deposit USDC into the Navy vault to start earning. You sign a
                gasless authorization — Navy relays it and holds no keys.
              </Text>
            </View>
          )}

          {/* How it works */}
          <Text variant="h3" color={colors.textHi} style={styles.howTitle}>
            How it works
          </Text>
          <Card glass compact style={styles.howCard}>
            <Text variant="caption" color={colors.text}>
              Your USDC joins a shared, rebalancing vault that supplies to the
              best-yielding adapter. You hold vault shares; withdraw returns your
              principal plus yield to your wallet. Deposits and withdrawals are
              gasless — you sign, Navy relays.
            </Text>
          </Card>

          {/* Position card */}
          {hasPosition && pos && (
            <Card glass compact style={styles.posCard}>
              <View style={styles.posRow}>
                <IconBadge name="sprout" color={colors.aqua} />
                <View style={styles.posMid}>
                  <Text variant="bodyStrong" color={colors.textHi}>
                    Navy vault
                  </Text>
                  <Text variant="caption" color={colors.textDim}>
                    {usdcBaseToDisplay(pos.sharesBase)} shares
                  </Text>
                </View>
                <Text variant="bodyStrong" numeric color={colors.textHi}>
                  {current.toFixed(4)} USDC
                </Text>
              </View>
            </Card>
          )}

          {/* Devnet note */}
          <View style={styles.noteRow}>
            <Pill label="Sepolia" />
            <Text variant="caption" muted style={styles.noteText}>
              Deposits mint vault shares; withdraw redeems them back to USDC in
              your wallet.
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
  depositCard: {
    marginTop: space.lg,
    gap: space.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glassFill,
    paddingHorizontal: space.lg,
  },
  input: {
    flex: 1,
    paddingVertical: space.md,
    color: colors.textHi,
    fontSize: 20,
  },
  withdrawRow: {
    marginTop: space.md,
  },
  emptyInner: {
    alignItems: 'center',
    maxWidth: 320,
    marginTop: space.xl,
    alignSelf: 'center',
  },
  emptyBody: {
    marginTop: space.md,
    textAlign: 'center',
  },
  staleWrap: {
    marginTop: space.md,
  },
  loadErrorWrap: {
    marginTop: space.xl,
  },
  actionErrorWrap: {
    marginTop: space.md,
    alignSelf: 'stretch',
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
