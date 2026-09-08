import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { JsonRpcProvider, parseUnits } from 'ethers';

import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { VaultClient } from '@/lib/vault/vaultClient';
import type { VaultPosition, VaultApy, StrategyAllocation, HarvestsResponse, TransactionProposal } from '@/lib/vault/types';
import { makeProposalBroadcaster } from '@/lib/vault/broadcaster';
import { preflightDepositGas, preflightProposalGas, sendProposals } from '@/lib/vault/proposals';
import { GasShortfallError, weiToEthCeil } from '@/lib/vault/gas';
import { describeFarmingActionError } from '@/lib/vault/actionError';
import { sharesBaseToDisplay } from '@/lib/vault/amounts';
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
import { Skeleton } from '@/ui/Skeleton';
import { colors, gradients, radius, space } from '@/ui/theme';
import { StrategySection } from '@/features/farming/StrategySection';
import { HarvestHistoryList } from '@/features/farming/HarvestHistoryList';

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

/** Convert apyBps (basis points) to a human APR percentage string.
 * Displays real APY including high-utilization markets (which can exceed 30%).
 * High utilization = high yield opportunity.
 */
function apyBpsToPct(apyBps: number): string {
  return (apyBps / 100).toFixed(2);
}

/** Chain facts the gas precheck needs. ETH balance and gas price are both wei. */
interface GasContext {
  ethBalanceWei: bigint;
  gasPriceWei: bigint;
}

export default function Farming() {
  const { session, authedFetch } = useNavySession();
  // Paper 2.1: farming has no relayer. The user signs and PAYS FOR every leg,
  // so this screen needs a transaction sender, not a typed-data signer.
  const { address, sendTransaction } = useMobileSigner();
  const toast = useToast();
  const token = session?.tokens.accessToken;

  const vault = useMemo(
    () => (authedFetch ? new VaultClient(getEnv().navyApiUrl, authedFetch) : null),
    [authedFetch],
  );

  // One provider for the whole screen: gas reads and receipt waits.
  const provider = useMemo(() => new JsonRpcProvider(getEnv().baseRpc), []);

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
  } = useAsync<{ pos: VaultPosition; apys: VaultApy[]; gas: GasContext } | null>(
    async () => {
      if (!vault || !token) return null;
      const [pos, apyResponse, ethBalanceWei, feeData] = await Promise.all([
        vault.getPosition(),
        vault.getApys().catch(() => ({ adapters: [] })),
        // Own-gas reads: a failure here must not blank the screen, so both
        // degrade to 0 — `preflightProposalGas` reports gasPriceWei 0 as
        // "unknown" and declines to block the flow on our own read failure.
        address ? provider.getBalance(address).catch(() => 0n) : Promise.resolve(0n),
        provider.getFeeData().catch(() => ({ maxFeePerGas: null, gasPrice: null })),
      ]);
      const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
      return { pos, apys: apyResponse.adapters, gas: { ethBalanceWei, gasPriceWei } };
    },
    { deps: [token, vault, address, provider] },
  );

  const { data: strategy } = useAsync<StrategyAllocation>(
    () => (vault && token ? vault.getStrategy() : Promise.reject()),
    { deps: [token, vault] },
  );

  const { data: harvests } = useAsync<HarvestsResponse>(
    () => (vault && token ? vault.getHarvests({ limit: '10' }) : Promise.reject()),
    { deps: [token, vault] },
  );

  const pos = data?.pos ?? null;
  const apys = data?.apys ?? [];
  const gas: GasContext = data?.gas ?? { ethBalanceWei: 0n, gasPriceWei: 0n };

  // Headline APR: the best (highest) apyBps currently in the vault, if any.
  const bestApyBps = apys.reduce<number>((max, a) => (a.apyBps > max ? a.apyBps : max), 0);

  const guard = async (fn: () => Promise<void>, action: () => void) => {
    if (!vault || !token) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await retry();
    } catch (e) {
      // Prefer the explicit, quantified reasons (ETH for gas; the backend's
      // USDC / maxRedeem refusals) over the generic chain-error mapper.
      setActionError(describeFarmingActionError(e) ?? mapSendError(e));
      setLastAction(() => action);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ask `be` for the unsigned legs, refuse up-front if the wallet cannot pay
   * the gas, then sign and broadcast each leg in order from the embedded
   * wallet. Returns the hash of the final leg.
   *
   * The gas precheck is the point of this whole path: without it the user pays
   * for a transaction that cannot succeed and sees only an opaque revert.
   */
  const runProposals = async (legs: TransactionProposal[]): Promise<string> => {
    if (legs.length === 0) throw new Error('Nothing to do');

    const preflight = preflightProposalGas(legs, gas);
    if (!preflight.ok) throw new GasShortfallError(preflight.shortfallWei);

    const broadcaster = makeProposalBroadcaster(sendTransaction, provider);
    const hashes = await sendProposals(broadcaster, legs);
    return hashes[hashes.length - 1] ?? '';
  };

  const deposit = () =>
    guard(async () => {
      const base = usdcAmountToBase(amount);
      if (!base) {
        toast('Enter a valid USDC amount.', 'error');
        throw new Error('Invalid amount');
      }
      // `be` refuses here if the USDC balance is short — before any gas is spent.
      const legs = await vault!.buildDeposit(base);
      const hash = await runProposals(legs);
      setAmount('');
      toast(`Deposited — Tx ${hash.slice(0, 16)}…`, 'success');
    }, deposit);

  // Redeem the full share balance back to the user's wallet.
  const withdrawAll = () =>
    guard(async () => {
      if (!pos || BigInt(pos.sharesBase || '0') <= 0n) {
        toast('Nothing to withdraw.', 'error');
        throw new Error('No position');
      }
      // `be` refuses here if the vault cannot pay out that many shares synchronously.
      const legs = await vault!.buildRedeem(pos.sharesBase);
      const hash = await runProposals(legs);
      toast(`Withdrawn — Tx ${hash.slice(0, 16)}…`, 'success');
    }, withdrawAll);

  const current = pos ? Number(usdcBaseToDisplay(pos.assetsBase)) : 0;
  const hasPosition = pos ? BigInt(pos.sharesBase || '0') > 0n : false;

  // Proactive gas warning: budgeted worst case (approve + one vault call).
  // `unknown` (gas price unreadable) stays silent rather than crying wolf.
  const gasPreview = preflightDepositGas(gas);
  const gasShortfallWei = !gasPreview.unknown && !gasPreview.ok ? gasPreview.shortfallWei : null;

  return (
    <Screen scroll tabSafe onRefresh={retry} refreshing={refreshing}>
      {/* Header */}
      <View style={styles.head}>
        <Text variant="h2" color={colors.textHi}>
          Earn
        </Text>
        <Text variant="caption" dim>
          Navy vault · Base
          {bestApyBps > 0 ? `  ·  ${apyBpsToPct(bestApyBps)}% APY` : ''}
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
          <View style={styles.heroSkeletonContent}>
            <Skeleton width={140} height={44} />
            <Skeleton width={80} height={16} style={{ marginTop: space.sm }} />
          </View>
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
                {sharesBaseToDisplay(pos.sharesBase)} shares
              </Text>
            )}
          </Gradient>

          {/* You pay your own Base gas now (paper 2.1) — say so BEFORE they try. */}
          {gasShortfallWei !== null && (
            <Card glass compact style={styles.gasCard}>
              <Text variant="label" upper color={colors.danger}>
                You need ETH on Base for gas
              </Text>
              <Text variant="caption" color={colors.text}>
                Farming transactions are signed and paid for by you — Navy does not
                relay them. Add about {weiToEthCeil(gasShortfallWei)} ETH on Base to
                cover the approve + deposit fees.
              </Text>
            </Card>
          )}

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
                Deposit USDC into the Navy vault to start earning. You sign and
                broadcast each transaction yourself and pay the Base network fee —
                Navy holds no keys and never moves your funds.
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
              principal plus yield to your wallet. You sign and pay the Base
              network fee for each step, so keep a little ETH on Base.
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
                    {sharesBaseToDisplay(pos.sharesBase)} shares
                  </Text>
                </View>
                <Text variant="bodyStrong" numeric color={colors.textHi}>
                  {current.toFixed(4)} USDC
                </Text>
              </View>
            </Card>
          )}

          {/* Strategy allocation */}
          <StrategySection strategy={strategy} apys={apys} />

          {/* Harvest history */}
          <HarvestHistoryList harvests={harvests} />

          {/* Network note */}
          <View style={styles.noteRow}>
            <Pill label="Base" />
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
  heroSkeletonContent: {
    marginTop: space.md,
    alignItems: 'center',
    gap: space.sm,
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
  gasCard: {
    marginTop: space.lg,
    gap: space.sm,
    borderColor: colors.danger,
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
