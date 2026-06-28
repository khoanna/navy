import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Pressable } from 'react-native';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import * as Clipboard from 'expo-clipboard';
import { useNavySession } from '../../src/auth/SessionContext';
import { getEnv } from '../../src/config/env';
import { FarmingClient, formatSol, Position } from '../../src/farming/farmingClient';
import { Screen } from '../../src/ui/Screen';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Gradient } from '../../src/ui/Gradient';
import { Icon } from '../../src/ui/Icon';
import { IconBadge, Pill, Divider } from '../../src/ui/Bits';
import { colors, gradients, radius, space, shadow } from '../../src/ui/theme';

const FUND_LAMPORTS = 100_000_000; // 0.1 SOL

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-6)}`;
}

export default function Farming() {
  const { session } = useNavySession();
  const solana = useEmbeddedSolanaWallet();
  const token = session?.tokens.accessToken;
  const client = new FarmingClient(getEnv().navyApiUrl);

  const [pos, setPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setPos(await client.getPosition(token));
    } catch {
      setPos(null);
    }
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
      Alert.alert(label, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () => guard(() => client.createSubwallet(token!).then(() => {}), 'Could not start farming');

  const fund = () =>
    guard(async () => {
      if (!pos) return;
      const env = getEnv();
      const connection = new Connection(env.solanaRpc, 'confirmed');
      const wallet = (solana as any)?.wallets?.[0];
      const from = new PublicKey(wallet.address);
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(pos.address), lamports: FUND_LAMPORTS }),
      );
      tx.feePayer = from;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const provider = await wallet.getProvider();
      const { signedTransaction } = await provider.signTransaction({ transaction: tx.serialize({ requireAllSignatures: false }) });
      await connection.sendRawTransaction(signedTransaction);
      Alert.alert('Funded', 'Sent 0.1 SOL to your farming subwallet.');
    }, 'Funding failed');

  const withdraw = () =>
    guard(async () => {
      const r = await client.withdraw(token!, 'all');
      Alert.alert('Withdrawn', `Tx ${r.txSignature.slice(0, 16)}…`);
    }, 'Withdraw failed');

  const principal = pos ? Number(formatSol(pos.principalLamports)) : 0;
  const current = pos ? Number(formatSol(pos.currentValueLamports)) : 0;
  const gain = current - principal;
  const gainPct = principal > 0 ? (gain / principal) * 100 : 0;

  return (
    <Screen scroll tabSafe onRefresh={pull} refreshing={refreshing}>
      <View style={styles.head}>
        <Text variant="label" muted upper>
          Earn
        </Text>
        <Text variant="h1" color={colors.textHi} style={{ marginTop: 2 }}>
          Grow your SOL
        </Text>
        <Text variant="caption" dim style={{ marginTop: space.xs }}>
          Idle SOL earns yield on Save (Solend) — withdraw anytime.
        </Text>
      </View>

      {!pos ? (
        <Card elevated style={{ marginTop: space.xl, alignItems: 'center', paddingVertical: space.xxxl }}>
          <IconBadge name="sprout" color={colors.aqua} size={76} />
          <Text variant="h2" color={colors.textHi} center style={{ marginTop: space.lg }}>
            Start earning
          </Text>
          <Text dim center style={{ marginTop: space.sm, marginBottom: space.xl, paddingHorizontal: space.sm }}>
            Navy creates a secure, encrypted subwallet that auto-deposits into the yield reserve. Your keys never leave Navy's signer.
          </Text>
          <Button label="Create farming wallet" icon="plus" loading={busy} onPress={start} />
        </Card>
      ) : (
        <>
          {/* Value hero */}
          <Gradient colors={gradients.aquaGlow} glow style={[styles.hero, shadow.accentGlow]}>
            <Text variant="label" color="rgba(4,17,31,0.65)" upper>
              Current value
            </Text>
            <View style={styles.amtRow}>
              <Text variant="display" numeric color={colors.onAccent}>
                {current.toFixed(4)}
              </Text>
              <Text variant="h2" color="rgba(4,17,31,0.6)" style={{ marginBottom: 6 }}>
                SOL
              </Text>
            </View>
            <View style={styles.gainChip}>
              <Icon name="trend" size={14} color={colors.onAccent} strokeWidth={2.4} />
              <Text variant="caption" color={colors.onAccent}>
                {gain >= 0 ? '+' : ''}
                {gain.toFixed(4)} SOL ({gainPct >= 0 ? '+' : ''}
                {gainPct.toFixed(2)}%)
              </Text>
            </View>
          </Gradient>

          {/* Details */}
          <Card style={{ marginTop: space.lg }}>
            <View style={styles.detailRow}>
              <Text variant="caption" dim>
                Principal deposited
              </Text>
              <Text variant="bodyStrong" numeric color={colors.textHi}>
                {principal.toFixed(4)} SOL
              </Text>
            </View>
            <Divider style={{ marginVertical: space.md }} />
            <View style={styles.detailRow}>
              <Text variant="caption" dim>
                Yield earned
              </Text>
              <Text variant="bodyStrong" numeric color={gain >= 0 ? colors.success : colors.danger}>
                {gain >= 0 ? '+' : ''}
                {gain.toFixed(4)} SOL
              </Text>
            </View>
            <Divider style={{ marginVertical: space.md }} />
            <View style={styles.detailRow}>
              <Text variant="caption" dim>
                Subwallet
              </Text>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(pos.address);
                  Alert.alert('Copied', 'Subwallet address copied.');
                }}
                style={styles.copyRow}
              >
                <Text variant="mono" color={colors.text}>
                  {short(pos.address)}
                </Text>
                <Icon name="copy" size={14} color={colors.textDim} />
              </Pressable>
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
            <View style={{ flex: 1 }}>
              <Button label="Fund 0.1 SOL" icon="plus" variant="secondary" loading={busy} onPress={fund} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Withdraw all" icon="down" variant="ghost" loading={busy} onPress={withdraw} />
            </View>
          </View>

          <View style={styles.noteRow}>
            <Pill label="Devnet" tone="warning" />
            <Text variant="caption" muted style={{ flex: 1 }}>
              Funding signs a transfer from your main wallet. Withdraw returns principal + yield to your wallet.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: space.md },
  hero: { borderRadius: radius.xxl, padding: space.xxl, marginTop: space.xl },
  amtRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.md },
  gainChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(4,17,31,0.16)',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginTop: space.lg,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl },
});
