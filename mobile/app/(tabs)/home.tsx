import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Connection, PublicKey } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import * as Clipboard from 'expo-clipboard';
import { getEnv } from '../../src/config/env';
import { useNavySession } from '../../src/auth/SessionContext';
import { fetchBalances, lamportsToSol, usdcBaseToDisplay } from '../../src/wallet/balances';
import { NavyPayClient, Payment } from '../../src/pay/navyPayClient';
import { Screen } from '../../src/ui/Screen';
import { Text } from '../../src/ui/Text';
import { Gradient } from '../../src/ui/Gradient';
import { Card } from '../../src/ui/Card';
import { Icon, IconName } from '../../src/ui/Icon';
import { IconBadge, PressRow } from '../../src/ui/Bits';
import { colors, gradients, radius, space, shadow } from '../../src/ui/theme';

function short(addr?: string) {
  return addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : 'provisioning…';
}

export default function Home() {
  const router = useRouter();
  const { signOut, session } = useNavySession();
  const solana = useEmbeddedSolanaWallet();
  const address = solana?.wallets?.[0]?.address;
  const token = session?.tokens.accessToken;

  const [sol, setSol] = useState('—');
  const [usdc, setUsdc] = useState('—');
  const [recent, setRecent] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const env = getEnv();
    if (address) {
      try {
        const connection = new Connection(env.solanaRpc, 'confirmed');
        const b = await fetchBalances(connection, new PublicKey(address), new PublicKey(env.usdcMint));
        setSol(lamportsToSol(b.solLamports));
        setUsdc(usdcBaseToDisplay(b.usdcBase));
      } catch {
        setSol('0');
        setUsdc('0');
      }
    }
    if (token) {
      try {
        const list = await new NavyPayClient(env.navyApiUrl).getUserPayments(token);
        setRecent(list.slice(0, 3));
      } catch {
        setRecent([]);
      }
    }
  }, [address, token]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const copy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    Alert.alert('Copied', 'Wallet address copied to clipboard.');
  };

  return (
    <Screen scroll tabSafe onRefresh={refresh} refreshing={refreshing}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text variant="label" muted upper>
            Navy Wallet
          </Text>
          <Text variant="h2" color={colors.textHi} style={{ marginTop: 2 }}>
            Good to see you
          </Text>
        </View>
        <Pressable onPress={() => Alert.alert('Sign out', 'End your session?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])} style={styles.iconBtn}>
          <Icon name="logout" size={20} color={colors.textDim} />
        </Pressable>
      </View>

      {/* Balance hero */}
      <Gradient colors={gradients.ocean} glow style={[styles.hero, shadow.accentGlow]}>
        <View style={styles.heroTop}>
          <Text variant="label" color="rgba(4,17,31,0.65)" upper>
            USDC Balance
          </Text>
          <View style={styles.chip}>
            <Icon name="bolt" size={13} color={colors.onAccent} />
            <Text variant="label" color={colors.onAccent}>
              Gasless
            </Text>
          </View>
        </View>

        <View style={styles.amountRow}>
          <Text variant="display" numeric color={colors.onAccent}>
            {usdc}
          </Text>
          <Text variant="h2" color="rgba(4,17,31,0.6)" style={{ marginBottom: 6 }}>
            USDC
          </Text>
        </View>

        <View style={styles.heroFoot}>
          <View style={styles.solChip}>
            <Icon name="trend" size={14} color={colors.onAccent} strokeWidth={2.2} />
            <Text variant="caption" color={colors.onAccent}>
              {sol} SOL
            </Text>
          </View>
          <Pressable onPress={copy} style={styles.addrChip}>
            <Text variant="mono" color="rgba(4,17,31,0.75)">
              {short(address)}
            </Text>
            <Icon name="copy" size={14} color="rgba(4,17,31,0.75)" />
          </Pressable>
        </View>
      </Gradient>

      {/* Quick actions */}
      <View style={styles.actions}>
        <Action icon="scan" label="Scan & Pay" onPress={() => router.push('/scan')} accent={colors.accent} />
        <Action icon="receive" label="Receive" onPress={copy} accent={colors.aqua} />
        <Action icon="sprout" label="Earn" onPress={() => router.push('/farming')} accent={colors.warning} />
      </View>

      {/* Recent activity */}
      <View style={styles.sectionHead}>
        <Text variant="h3" color={colors.textHi}>
          Recent activity
        </Text>
        <Pressable onPress={() => router.push('/history')}>
          <Text variant="caption" color={colors.accent}>
            See all
          </Text>
        </Pressable>
      </View>

      <Card compact>
        {recent.length === 0 ? (
          <View style={styles.empty}>
            <IconBadge name="clock" color={colors.textMute} size={48} />
            <Text variant="caption" muted center style={{ marginTop: space.md }}>
              No payments yet. Scan a Navy QR to make your first payment.
            </Text>
          </View>
        ) : (
          recent.map((p, i) => (
            <View key={p.orderId}>
              {i > 0 && <View style={styles.rowDiv} />}
              <View style={styles.txRow}>
                <IconBadge name="arrowUpRight" color={colors.accent} size={40} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color={colors.textHi} numberOfLines={1}>
                    {p.merchant ?? p.reference ?? 'Payment'}
                  </Text>
                  <Text variant="caption" muted>
                    {p.status}
                  </Text>
                </View>
                <Text variant="bodyStrong" numeric color={colors.textHi}>
                  -{(Number(p.amount) / 1_000_000).toFixed(2)}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

function Action({ icon, label, onPress, accent }: { icon: IconName; label: string; onPress: () => void; accent: string }) {
  return (
    <PressRow onPress={onPress} style={styles.actionWrap}>
      <View style={styles.actionCard}>
        <IconBadge name={icon} color={accent} size={46} />
        <Text variant="caption" color={colors.text} style={{ marginTop: space.sm }}>
          {label}
        </Text>
      </View>
    </PressRow>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xxl },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { borderRadius: radius.xxl, padding: space.xxl },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(4,17,31,0.14)',
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.lg },
  heroFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xl },
  solChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(4,17,31,0.14)', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  addrChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(4,17,31,0.14)', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
  actionWrap: { flex: 1 },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xxxl, marginBottom: space.md },
  empty: { alignItems: 'center', paddingVertical: space.xl },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  rowDiv: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },
});
