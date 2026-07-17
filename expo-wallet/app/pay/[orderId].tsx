import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getEnv } from '@/lib/config/env';
import { NavyPayClient } from '@/lib/pay/navyPayClient';
import { payInvoice } from '@/lib/pay/payFlow';
import { isUuid } from '@/lib/pay/payUrl';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { IconBadge, Pill, Divider, Field } from '@/ui/Bits';
import { Sheet } from '@/ui/Sheet';
import { SlideToConfirm } from '@/ui/SlideToConfirm';
import { SuccessCheck } from '@/ui/SuccessCheck';
import { useToast } from '@/ui/Toast';
import { colors, gradients, radius, space } from '@/ui/theme';

type OrderItem = { name: string; unitPrice: string; quantity: number };
type OrderCharge = { name: string; amount: string };
type Order = {
  amount: string;
  reference: string;
  status: string;
  subtotal?: string | null;
  description?: string | null;
  items?: OrderItem[];
  charges?: OrderCharge[];
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  awaiting_payment: 'warning',
  paid: 'success',
  expired: 'danger',
  cancelled: 'danger',
};

export default function PayScreen() {
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { address, signTypedData } = useMobileSigner();
  const { session } = useNavySession();
  const toast = useToast();
  const client = new NavyPayClient(getEnv().navyApiUrl);

  // Guard hand-typed /pay/<x> URLs: the QR path validates, a typed URL does not.
  const validId = Boolean(orderId) && isUuid(orderId);

  const [order, setOrder] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [paid, setPaid] = useState(false);
  const [slideReset, setSlideReset] = useState(0);

  useEffect(() => {
    if (!validId) { setNotFound(true); return; }
    client.getOrder(orderId).then(setOrder).catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, validId]);

  async function pay() {
    if (!validId) return;
    const token = session?.tokens.accessToken;
    if (!token) { toast('Payment failed: not signed in'); return; }
    if (!address) { toast('Payment failed: no wallet available'); return; }
    setBusy(true);
    try {
      // expectedSigner asserts the server-built authorization (payer derived from our token)
      // is one this embedded wallet can sign — refuses typed data built for a different payer.
      const res = await payInvoice({
        orderId,
        navyAccessToken: token,
        client,
        signTypedData,
        expectedSigner: address,
      });
      toast(`Payment sent: ${res.txHash.slice(0, 16)}…`);
      setConfirming(false);
      setPaid(true);
    } catch (e) {
      toast(`Payment failed: ${(e as Error).message}`);
      setSlideReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home');
    }
  };

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
          <ActivityIndicator size="large" color={colors.aqua} />
          <Text dim style={{ marginTop: space.md }}>
            Loading invoice…
          </Text>
        </View>
      </Screen>
    );
  }

  const amountText = usdcBaseToDisplay(order.amount);
  const succeeded = paid || order.status === 'paid';

  if (succeeded) {
    return (
      <Screen scroll>
        <View style={styles.center}>
          <SuccessCheck />
          <Text variant="h2" color={colors.textHi} center style={{ marginTop: space.lg }}>
            Paid {amountText} USDC
          </Text>
          <Card glass style={styles.successCard}>
            <Field label="Status" value="Confirmed on-chain" valueColor={colors.aqua} />
            <Field label="Fee paid by you" value="$0.00" />
          </Card>
          <Button label="Done" onPress={() => router.replace('/home')} />
        </View>
      </Screen>
    );
  }

  const payable = order.status === 'awaiting_payment';
  const tone = STATUS_TONE[order.status] ?? 'neutral';

  return (
    <Screen scroll>
      {/* Top row */}
      <View style={styles.topRow}>
        <Text variant="label" muted upper>
          Confirm payment
        </Text>
        <TouchableOpacity onPress={close} style={styles.closeBtn} activeOpacity={0.7}>
          <View style={styles.closeBtnInner}>
            <Icon name="plus" size={20} color={colors.textDim} strokeWidth={2} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {/* Itemized breakdown */}
        {(order.items?.length ?? 0) > 0 && (
          <View style={styles.breakdownBlock}>
            {order.items?.map((it, i) => (
              <View key={`item-${i}`} style={styles.breakdownRow}>
                <Text dim>{it.name} × {it.quantity}</Text>
                <Text numeric>{usdcBaseToDisplay(it.unitPrice)} USDC each</Text>
              </View>
            ))}
            {order.charges?.map((c, i) => (
              <View key={`charge-${i}`} style={styles.breakdownRow}>
                <Text dim>{c.name}</Text>
                <Text numeric>{usdcBaseToDisplay(c.amount)} USDC</Text>
              </View>
            ))}
          </View>
        )}

        {order.description ? (
          <Text dim center style={styles.description}>
            {order.description}
          </Text>
        ) : null}

        {/* Amount focal point */}
        <Gradient colors={gradients.ocean} glow style={styles.amountCard}>
          <Text variant="label" color="rgba(4,17,31,0.65)" upper>
            You pay
          </Text>
          <View style={styles.amtRow}>
            <Text variant="display" numeric color={colors.onAccent}>
              {usdcBaseToDisplay(order.amount)}
            </Text>
            <Text variant="h2" color="rgba(4,17,31,0.6)" style={styles.usdcLabel}>
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

        <Card style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Text variant="caption" dim>
              Reference
            </Text>
            <Text
              variant="bodyStrong"
              color={colors.textHi}
              style={styles.referenceText}
            >
              {order.reference}
            </Text>
          </View>
          <Divider style={styles.divider} />
          <View style={styles.metaRow}>
            <Text variant="caption" dim>
              Status
            </Text>
            <Pill label={order.status.replace(/_/g, ' ')} tone={tone} />
          </View>
        </Card>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        {!payable && (
          <Text variant="caption" muted center style={styles.unavailableText}>
            This invoice can no longer be paid.
          </Text>
        )}
        <Button
          label={payable ? `Pay ${amountText} USDC` : 'Unavailable'}
          icon={payable ? 'check' : undefined}
          loading={busy}
          disabled={!payable}
          onPress={() => setConfirming(true)}
        />
        <Button
          label="Cancel"
          variant="ghost"
          onPress={close}
          style={styles.cancelBtn}
        />
      </View>

      {/* Confirm sheet — the slide invokes the same pay() build→sign→submit handler */}
      <Sheet open={confirming} onClose={() => setConfirming(false)}>
        <View style={styles.confirmHead}>
          <IconBadge name="shield" color={colors.aqua} size={48} />
          <Text
            variant="bodyStrong"
            color={colors.textHi}
            style={styles.confirmRef}
          >
            {order.reference}
          </Text>
        </View>
        <View style={styles.confirmAmt}>
          <Text variant="display" numeric color={colors.textHi}>
            {amountText}
          </Text>
          <Text variant="h2" color={colors.textDim} style={styles.confirmUsdcLabel}>
            USDC
          </Text>
        </View>
        <Card glass compact style={styles.confirmCard}>
          <Field label="Network fee" value="Sponsored · Gasless" valueColor={colors.aqua} />
          <Field label="You pay" value={`${amountText} USDC`} />
        </Card>
        <SlideToConfirm label="Slide to pay" onConfirm={pay} disabled={busy} resetKey={slideReset} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  successCard: {
    width: '100%',
    marginTop: space.xl,
    marginBottom: space.xl,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.sm,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnInner: {
    transform: [{ rotate: '45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    marginTop: space.xxl,
    marginBottom: space.xxl,
  },
  breakdownBlock: {
    width: '100%',
    marginBottom: space.lg,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  description: {
    marginBottom: space.md,
  },
  amountCard: {
    borderRadius: radius.xxl,
    padding: space.xxl,
  },
  amtRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    marginTop: space.md,
  },
  usdcLabel: {
    marginBottom: 6,
  },
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
  metaCard: {
    marginTop: space.lg,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  referenceText: {
    maxWidth: '60%',
  },
  divider: {
    marginTop: space.md,
    marginBottom: space.md,
  },
  footer: {
    paddingBottom: space.sm,
  },
  unavailableText: {
    marginBottom: space.md,
  },
  cancelBtn: {
    marginTop: space.md,
  },
  confirmHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  confirmRef: {
    flex: 1,
  },
  confirmAmt: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    marginBottom: space.lg,
  },
  confirmUsdcLabel: {
    marginBottom: 6,
  },
  confirmCard: {
    marginBottom: space.lg,
  },
});
