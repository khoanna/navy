import React, { useState } from 'react';
import {
  View,
  Text as RNText,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { JsonRpcProvider } from 'ethers';

import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { fetchBalances, weiToEth, usdcBaseToDisplay, makeUsdcReader } from '@/lib/wallet/balances';
import { NavyPayClient, Payment } from '@/lib/pay/navyPayClient';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { short, avatarColors } from '@/lib/wallet/identicon';
import { earnTip } from '@/lib/wallet/tips';
import { MarketClient } from '@/lib/market/marketClient';
import { useAsync } from '@/lib/ui/useAsync';

import { Text } from '@/ui/Text';
import { Gradient } from '@/ui/Gradient';
import { Card } from '@/ui/Card';
import { Icon, IconName } from '@/ui/Icon';
import { IconBadge, GlowIcon, PressRow } from '@/ui/Bits';
import { ErrorState } from '@/ui/ErrorState';
import { StaleChip } from '@/ui/StaleChip';
import { Skeleton } from '@/ui/Skeleton';
import { colors, gradients, radius, space } from '@/ui/theme';
import { FundButton } from '@/features/wallet/FundButton';

interface HomeData {
  eth: string;
  usdc: string;
  ethUsd: number | null;
  recent: Payment[];
}

export default function Home() {
  const router = useRouter();
  const { session, authedFetch } = useNavySession();
  const { address } = useMobileSigner();
  const token = session?.tokens.accessToken;

  const [copied, setCopied] = useState(false);

  const { data, loading, refreshing, error, staleError, retry } = useAsync<HomeData>(
    async () => {
      const env = getEnv();

      // Balances are the primary, blocking data. A failure here surfaces as an error.
      let eth = '0';
      let usdc = '0';
      if (address) {
        const provider = new JsonRpcProvider(env.baseRpc);
        const usdcReader = makeUsdcReader(provider, env.usdcAddress);
        const b = await fetchBalances(provider, address, usdcReader);
        eth = weiToEth(b.ethWei);
        usdc = usdcBaseToDisplay(b.usdcBase);
      }

      // Prices are best-effort: a null ethUsd is a valid, non-blocking state.
      let ethUsd: number | null = null;
      if (authedFetch) {
        try {
          const prices = await new MarketClient(env.navyApiUrl, authedFetch).getPrices(['ethereum']);
          ethUsd = prices.ethereum?.priceUsd ?? null;
        } catch {
          ethUsd = null;
        }
      }

      // Recent payments are best-effort too — the full list lives on the History tab.
      let recent: Payment[] = [];
      if (token) {
        try {
          const list = await new NavyPayClient(
            env.navyApiUrl,
            undefined,
            authedFetch ?? undefined,
          ).getUserPayments(token);
          recent = list.slice(0, 3);
        } catch {
          recent = [];
        }
      }

      return { eth, usdc, ethUsd, recent };
    },
    { deps: [address, token, authedFetch] },
  );

  const refresh = retry;
  const eth = data?.eth ?? '—';
  const usdc = data?.usdc ?? '—';
  const ethUsd = data?.ethUsd ?? null;
  const recent = data?.recent ?? [];

  const copyAddress = async () => {
    if (!address) return;
    try {
      await Clipboard.setStringAsync(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  // Tip: nudge idle USDC into the Earn vault
  const usdcNumeric = usdc === '—' ? 0 : Number(usdc.replace(/,/g, '')) || 0;
  const tip = earnTip(usdcNumeric, 100);
  const [avA, avB] = avatarColors(address);

  // Portfolio total in USD (USDC ≈ $1) once we have an ETH price.
  const usdcNum = usdc === '—' ? 0 : Number(usdc.replace(/,/g, '')) || 0;
  const ethNum = eth === '—' ? 0 : Number(eth) || 0;
  const totalUsd = ethUsd != null ? usdcNum + ethNum * ethUsd : null;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.aqua}
            colors={[colors.aqua]}
          />
        }
      >
        {/* Hero: wallet identity + balance, on a deep-ocean gradient */}
        <Gradient colors={gradients.oceanDeep} glow style={styles.hero}>
          {/* Hero top row: avatar + address / gasless pill */}
          <View style={styles.heroTop}>
            <View style={styles.idRow}>
              {/* Avatar disc — gradient approximated with two solid stops */}
              {loading || !address ? (
                <>
                  <Skeleton circle height={46} width={46} />
                  <View style={styles.idText}>
                    <Skeleton width={60} height={12} />
                    <Skeleton width={100} height={16} round style={styles.addrPillSkeleton} />
                  </View>
                </>
              ) : (
                <>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: avA },
                    ]}
                  />
                  <View style={styles.idText}>
                    <Text variant="caption" color="rgba(255,255,255,0.72)">
                      Welcome back
                    </Text>
                    <Pressable
                      onPress={copyAddress}
                      style={styles.addrPill}
                      accessibilityLabel="Copy wallet address"
                    >
                      <Text variant="bodyStrong" numeric color={colors.textHi}>
                        {short(address)}
                      </Text>
                      <Icon name={copied ? 'check' : 'copy'} size={13} color="rgba(255,255,255,0.9)" />
                    </Pressable>
                  </View>
                </>
              )}
            </View>

            {/* Gasless badge */}
            <View style={styles.gasless}>
              <View style={styles.gaslessDot} />
              <Text variant="label" color={colors.textHi} style={styles.gaslessLabel}>
                GASLESS
              </Text>
            </View>
          </View>

          {/* Balance block */}
          <View style={styles.balanceBlock}>
            <Text variant="label" upper color="rgba(255,255,255,0.6)">
              Total balance
            </Text>
            {error ? (
              <View style={styles.heroError}>
                <ErrorState compact error={error} onRetry={retry} />
              </View>
            ) : loading || usdc === '—' ? (
              <View style={styles.balanceSkeletonWrap}>
                <Skeleton width={160} height={44} style={styles.balSkeleton} />
                <Skeleton width={200} height={14} style={styles.subtextSkeleton} />
              </View>
            ) : totalUsd != null ? (
              <>
                <View style={styles.balRow}>
                  <Text variant="display" numeric color={colors.textHi}>
                    ${totalUsd.toFixed(2)}
                  </Text>
                </View>
                <Text variant="caption" numeric color="rgba(255,255,255,0.72)" style={styles.solLine}>
                  {usdc} USDC · {eth} ETH (${(ethNum * (ethUsd ?? 0)).toFixed(2)})
                </Text>
              </>
            ) : (
              <>
                <View style={styles.balRow}>
                  <Text variant="display" numeric color={colors.textHi}>
                    {usdc}
                  </Text>
                  <Text variant="h3" color="rgba(255,255,255,0.62)">
                    USDC
                  </Text>
                </View>
                <Text variant="caption" numeric color="rgba(255,255,255,0.72)" style={styles.solLine}>
                  ≈ {eth} ETH
                </Text>
              </>
            )}
          </View>

          <View style={{ marginTop: space.lg }}>
            <FundButton address={address} variant="ghost" />
          </View>
        </Gradient>

        {/* Non-blocking refresh failure — last-good balances stay visible above */}
        {staleError && (
          <View style={styles.staleWrap}>
            <StaleChip onRetry={retry} />
          </View>
        )}

        {/* Quick actions row: Receive · Send · Pay · Earn */}
        <View style={styles.actions}>
          <Action icon="receive" label="Receive" onPress={() => router.push('/receive')} />
          <Action icon="arrowUpRight" label="Send" onPress={() => router.push('/send')} />
          <Action icon="scan" label="Pay" onPress={() => router.push('/scan')} primary />
          <Action icon="sprout" label="Earn" onPress={() => router.push('/farming')} />
        </View>

        {/* Earn tip card (only when eligible) */}
        {tip.show && (
          <Card
            glass
            style={[styles.tipCard, { borderLeftColor: colors.aqua, borderLeftWidth: 3 }]}
          >
            <Text variant="bodyStrong" color={colors.textHi}>
              Idle USDC could earn 4.2%
            </Text>
            <PressRow onPress={() => router.push('/farming')} style={styles.tipRow}>
              <Text variant="caption" color={colors.aqua}>
                Move to the Earn vault →
              </Text>
            </PressRow>
          </Card>
        )}

        {/* Recent activity section */}
        <View style={styles.sectionHead}>
          <Text variant="h3" color={colors.textHi}>
            Recent activity
          </Text>
          <Pressable onPress={() => router.push('/history')}>
            <Text variant="caption" color={colors.aqua}>
              See all
            </Text>
          </Pressable>
        </View>

        <Card glass compact>
          {loading ? (
            // Skeleton loading for recent activity
            <View style={styles.recentSkeleton}>
              {[1, 2, 3].map((i) => (
                <View key={i}>
                  {i > 1 && <View style={styles.rowDiv} />}
                  <View style={styles.txRow}>
                    <Skeleton circle height={40} width={40} />
                    <View style={styles.txMid}>
                      <Skeleton width="70%" height={14} />
                      <Skeleton width="40%" height={12} style={{ marginTop: 4 }} />
                    </View>
                    <Skeleton width={60} height={16} />
                  </View>
                </View>
              ))}
            </View>
          ) : recent.length === 0 ? (
            <View style={styles.empty}>
              <GlowIcon name="clock" color={colors.textDim} size={72} />
              <Text
                variant="caption"
                muted
                center
                style={styles.emptyText}
              >
                No payments yet. Scan a Navy QR to make your first payment.
              </Text>
            </View>
          ) : (
            recent.map((p, i) => (
              <View key={p.orderId}>
                {i > 0 && <View style={styles.rowDiv} />}
                <View style={styles.txRow}>
                  <IconBadge name="arrowUpRight" color={colors.textDim} size={40} />
                  <View style={styles.txMid}>
                    <RNText
                    numberOfLines={1}
                    style={[
                      txBodyStrongStyle,
                      { color: colors.textHi },
                    ]}
                  >
                    {p.merchant ?? p.reference ?? 'Payment'}
                  </RNText>
                    <Text variant="caption" muted>
                      {p.status}
                    </Text>
                  </View>
                  <Text variant="bodyStrong" numeric color={colors.textHi}>
                    -{usdcBaseToDisplay(p.amount)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Quick-action tile
// ---------------------------------------------------------------------------

/** A quick-action tile. Primary (Pay) gets the ocean gradient; others are flat. */
function Action({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <PressRow onPress={onPress} style={styles.actionWrap}>
      <View style={primary ? styles.actionPrimary : styles.actionCard}>
        <Icon
          name={icon}
          size={24}
          color={primary ? colors.textHi : colors.text}
          strokeWidth={1.9}
        />
        <Text
          variant="caption"
          color={primary ? colors.textHi : colors.textDim}
          style={styles.actionLabel}
        >
          {label}
        </Text>
      </View>
    </PressRow>
  );
}

// ---------------------------------------------------------------------------
// Inline style for the truncated merchant name (RNText with numberOfLines)
// ---------------------------------------------------------------------------

const txBodyStrongStyle = {
  fontSize: 15,
  fontWeight: '700' as const,
  letterSpacing: 0,
  lineHeight: 21,
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: space.lg,
    paddingBottom: 96 + space.lg, // tabSafe
    paddingHorizontal: space.xl,
  },

  // Hero
  hero: {
    borderRadius: radius.xl,
    padding: space.xl,
    // Shadow approximation (iOS)
    shadowColor: '#040A18',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 42,
    elevation: 14, // Android
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flex: 1,
    minWidth: 0,
  },
  idText: {
    minWidth: 0,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  addrPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  addrPillSkeleton: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  gasless: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  gaslessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.aqua,
  },
  gaslessLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
  },

  // Balance
  balanceBlock: {
    marginTop: space.xxl,
  },
  balRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    marginTop: 4,
  },
  balSkeleton: {
    marginTop: space.sm,
  },
  balanceSkeletonWrap: {
    marginTop: space.sm,
  },
  subtextSkeleton: {
    marginTop: space.sm,
  },
  heroError: {
    marginTop: space.sm,
    alignSelf: 'stretch',
  },
  staleWrap: {
    marginTop: space.md,
  },
  solLine: {
    marginTop: 2,
  },

  // Actions
  actions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
  },
  actionWrap: {
    flex: 1,
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    alignItems: 'center',
  },
  actionPrimary: {
    flex: 1,
    borderRadius: radius.lg,
    // LinearGradient not available inline in RN; use the accent color as solid fill
    // to approximate the ocean gradient tile
    backgroundColor: colors.accent,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    alignItems: 'center',
    // iOS glow shadow
    shadowColor: colors.aqua,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
  },
  actionLabel: {
    marginTop: space.sm,
  },

  // Tip card
  tipCard: {
    marginTop: space.xl,
  },
  tipRow: {
    marginTop: space.sm,
  },

  // Section head
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.xxxl,
    marginBottom: space.md,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingTop: space.xl,
    paddingBottom: space.xl,
  },
  emptyText: {
    marginTop: space.md,
    textAlign: 'center',
  },

  // Transaction row
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  txMid: {
    flex: 1,
    minWidth: 0,
  },
  rowDiv: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: space.xs,
  },
  recentSkeleton: {
    paddingVertical: space.sm,
  },
});
