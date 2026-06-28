import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Transaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { getEnv } from '../../src/config/env';
import { NavyPayClient } from '../../src/pay/navyPayClient';
import { payInvoice } from '../../src/pay/payFlow';
import { Screen } from '../../src/ui/Screen';
import { Text } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Gradient } from '../../src/ui/Gradient';
import { Icon } from '../../src/ui/Icon';
import { IconBadge, Pill, Divider } from '../../src/ui/Bits';
import { colors, gradients, radius, space } from '../../src/ui/theme';

type Order = { amount: string; reference: string; status: string };

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  awaiting_payment: 'warning',
  paid: 'success',
  expired: 'danger',
  cancelled: 'danger',
};

export default function PayScreen() {
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const solana = useEmbeddedSolanaWallet();
  const address = solana?.wallets?.[0]?.address;
  const client = new NavyPayClient(getEnv().navyApiUrl);

  const [order, setOrder] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (orderId) client.getOrder(orderId).then(setOrder).catch(() => setNotFound(true));
  }, [orderId]);

  async function pay() {
    if (!address || !orderId) return;
    setBusy(true);
    try {
      const wallet = (solana as any)?.wallets?.[0];
      const provider = await wallet.getProvider();
      const signTransaction = async (tx: Transaction): Promise<Transaction> => {
        const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        const { signedTransaction } = await provider.signTransaction({ transaction: serialized });
        return Transaction.from(signedTransaction);
      };
      const res = await payInvoice({ orderId, payer: address, client, signTransaction });
      Alert.alert('Payment sent', `Submitted: ${res.txSignature.slice(0, 16)}…`);
      router.replace('/home');
    } catch (e) {
      Alert.alert('Payment failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  if (notFound) {
    return (
      <Screen>
        <View style={styles.center}>
          <IconBadge name="shield" color={colors.danger} size={72} />
          <Text variant="h2" color={colors.textHi} center style={{ marginTop: space.lg }}>
            Invoice not found
          </Text>
          <Text dim center style={{ marginTop: space.sm, marginBottom: space.xl }}>
            This Navy invoice is invalid or has expired.
          </Text>
          <Button label="Back to wallet" onPress={close} full={false} />
        </View>
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.aqua} />
          <Text dim style={{ marginTop: space.md }}>
            Loading invoice…
          </Text>
        </View>
      </Screen>
    );
  }

  const payable = order.status === 'awaiting_payment';
  const tone = STATUS_TONE[order.status] ?? 'neutral';

  return (
    <Screen>
      <View style={styles.topRow}>
        <Text variant="label" muted upper>
          Confirm payment
        </Text>
        <Pressable onPress={close} style={styles.closeBtn}>
          <Icon name="plus" size={20} color={colors.textDim} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Amount focal point */}
        <Gradient colors={gradients.ocean} glow style={styles.amountCard}>
          <Text variant="label" color="rgba(4,17,31,0.65)" upper>
            You pay
          </Text>
          <View style={styles.amtRow}>
            <Text variant="display" numeric color={colors.onAccent}>
              {(Number(order.amount) / 1_000_000).toFixed(2)}
            </Text>
            <Text variant="h2" color="rgba(4,17,31,0.6)" style={{ marginBottom: 6 }}>
              USDC
            </Text>
          </View>
          <View style={styles.gaslessChip}>
            <Icon name="bolt" size={13} color={colors.onAccent} />
            <Text variant="label" color={colors.onAccent}>
              Navy pays the network fee
            </Text>
          </View>
        </Gradient>

        <Card style={{ marginTop: space.lg }}>
          <View style={styles.metaRow}>
            <Text variant="caption" dim>
              Reference
            </Text>
            <Text variant="bodyStrong" color={colors.textHi} numberOfLines={1} style={{ maxWidth: '60%' }}>
              {order.reference}
            </Text>
          </View>
          <Divider style={{ marginVertical: space.md }} />
          <View style={styles.metaRow}>
            <Text variant="caption" dim>
              Status
            </Text>
            <Pill label={order.status.replace(/_/g, ' ')} tone={tone} />
          </View>
        </Card>
      </View>

      <View style={styles.footer}>
        {!payable && (
          <Text variant="caption" muted center style={{ marginBottom: space.md }}>
            This invoice can no longer be paid.
          </Text>
        )}
        <Button
          label={payable ? `Pay ${(Number(order.amount) / 1_000_000).toFixed(2)} USDC` : 'Unavailable'}
          icon={payable ? 'check' : undefined}
          loading={busy}
          disabled={!payable}
          onPress={pay}
        />
        <Button label="Cancel" variant="ghost" onPress={close} style={{ marginTop: space.md }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: space.sm },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  body: { flex: 1, justifyContent: 'center' },
  amountCard: { borderRadius: radius.xxl, padding: space.xxl },
  amtRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.md },
  gaslessChip: {
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
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: { paddingBottom: space.sm },
});
