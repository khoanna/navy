'use client';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getEnv } from '@/lib/config/env';
import { NavyPayClient } from '@/lib/pay/navyPayClient';
import { payInvoice } from '@/lib/pay/payFlow';
import { isUuid } from '@/lib/pay/payUrl';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
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

type Order = { amount: string; reference: string; status: string };

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  awaiting_payment: 'warning',
  paid: 'success',
  expired: 'danger',
  cancelled: 'danger',
};

export default function PayScreen() {
  const router = useRouter();
  const { orderId } = useParams<{ orderId: string }>();
  const { address, sign } = useWebSigner();
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
      // expectedSigner asserts the server-built tx (payer derived from our token) is one
      // this embedded wallet can sign — refuses a tx built for a different payer.
      const res = await payInvoice({ orderId, navyAccessToken: token, client, signTransaction: sign, expectedSigner: address });
      toast(`Payment sent: ${res.txSignature.slice(0, 16)}…`);
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
    if (window.history.length > 1) {
      router.back();
    } else {
      router.replace('/home');
    }
  };

  if (notFound) {
    return (
      <Screen>
        <div className="navy-fade-in" style={styles.center}>
          <IconBadge name="shield" color={colors.danger} size={72} />
          <Text variant="h2" color={colors.textHi} center style={{ marginTop: `${space.lg}px` }}>
            Invoice not found
          </Text>
          <Text dim center style={{ marginTop: `${space.sm}px`, marginBottom: `${space.xl}px` }}>
            This Navy invoice is invalid or has expired.
          </Text>
          <Button label="Back to wallet" onPress={close} full={false} />
        </div>
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen>
        <div className="navy-fade-in" style={styles.center}>
          <div style={styles.spinner} />
          <Text dim style={{ marginTop: `${space.md}px` }}>
            Loading invoice…
          </Text>
        </div>
      </Screen>
    );
  }

  const amountText = usdcBaseToDisplay(order.amount);
  const succeeded = paid || order.status === 'paid';

  if (succeeded) {
    return (
      <Screen>
        <div className="navy-fade-in" style={styles.center}>
          <SuccessCheck />
          <Text variant="h2" color={colors.textHi} center style={{ marginTop: `${space.lg}px` }}>
            Paid {amountText} USDC
          </Text>
          <Card glass style={{ width: '100%', marginTop: `${space.xl}px`, marginBottom: `${space.xl}px` }}>
            <Field label="Status" value="Confirmed on-chain" valueColor={colors.aqua} />
            <Field label="Fee paid by you" value="$0.00" />
          </Card>
          <Button label="Done" onPress={() => router.push('/home')} />
        </div>
      </Screen>
    );
  }

  const payable = order.status === 'awaiting_payment';
  const tone = STATUS_TONE[order.status] ?? 'neutral';

  return (
    <Screen>
      <div className="navy-fade-in">
        {/* Top row */}
        <div style={styles.topRow}>
          <Text variant="label" muted upper>
            Confirm payment
          </Text>
          <button onClick={close} style={styles.closeBtn}>
            <div style={{ transform: 'rotate(45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={20} color={colors.textDim} strokeWidth={2} />
            </div>
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Amount focal point */}
          <Gradient colors={gradients.ocean} glow style={styles.amountCard}>
            <Text variant="label" color="rgba(4,17,31,0.65)" upper>
              You pay
            </Text>
            <div style={styles.amtRow}>
              <Text variant="display" numeric color={colors.onAccent}>
                {usdcBaseToDisplay(order.amount)}
              </Text>
              <Text variant="h2" color="rgba(4,17,31,0.6)" style={{ marginBottom: '6px' }}>
                USDC
              </Text>
            </div>
            <div style={styles.gaslessChip}>
              <Icon name="bolt" size={13} color={colors.onAccent} />
              <Text variant="label" color={colors.onAccent}>
                Navy pays the network fee
              </Text>
            </div>
          </Gradient>

          <Card style={{ marginTop: `${space.lg}px` }}>
            <div style={styles.metaRow}>
              <Text variant="caption" dim>
                Reference
              </Text>
              <Text
                variant="bodyStrong"
                color={colors.textHi}
                style={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {order.reference}
              </Text>
            </div>
            <Divider style={{ marginTop: `${space.md}px`, marginBottom: `${space.md}px` }} />
            <div style={styles.metaRow}>
              <Text variant="caption" dim>
                Status
              </Text>
              <Pill label={order.status.replace(/_/g, ' ')} tone={tone} />
            </div>
          </Card>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          {!payable && (
            <Text variant="caption" muted center style={{ marginBottom: `${space.md}px` }}>
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
          <Button label="Cancel" variant="ghost" onPress={close} style={{ marginTop: `${space.md}px` }} />
        </div>
      </div>

      {/* Confirm sheet — the slide invokes the same pay() build→sign→submit handler */}
      <Sheet open={confirming} onClose={() => setConfirming(false)}>
        <div style={styles.confirmHead}>
          <IconBadge name="shield" color={colors.aqua} size={48} />
          <Text variant="bodyStrong" color={colors.textHi} style={{ maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.reference}
          </Text>
        </div>
        <div style={styles.confirmAmt}>
          <Text variant="display" numeric color={colors.textHi}>
            {amountText}
          </Text>
          <Text variant="h2" color={colors.textDim} style={{ marginBottom: '6px' }}>
            USDC
          </Text>
        </div>
        <Card glass compact style={{ marginBottom: `${space.lg}px` }}>
          <Field label="Network fee" value="Sponsored · Gasless" valueColor={colors.aqua} />
          <Field label="You pay" value={`${amountText} USDC`} />
        </Card>
        <SlideToConfirm label="Slide to pay" onConfirm={pay} disabled={busy} resetKey={slideReset} />
      </Sheet>
    </Screen>
  );
}

const styles = {
  center: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: `${space.xl}px`,
    paddingRight: `${space.xl}px`,
    minHeight: '60vh',
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: `3px solid ${colors.border}`,
    borderTopColor: colors.aqua,
    animation: 'spin 0.7s linear infinite',
  } as React.CSSProperties,
  topRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: `${space.sm}px`,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: `${radius.md}px`,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  } as React.CSSProperties,
  body: {
    marginTop: `${space.xxl}px`,
    marginBottom: `${space.xxl}px`,
  },
  amountCard: {
    borderRadius: `${radius.xxl}px`,
    padding: `${space.xxl}px`,
  } as React.CSSProperties,
  amtRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'flex-end',
    gap: `${space.sm}px`,
    marginTop: `${space.md}px`,
  },
  gaslessChip: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '5px',
    alignSelf: 'flex-start' as const,
    backgroundColor: 'rgba(4,17,31,0.16)',
    paddingLeft: `${space.md}px`,
    paddingRight: `${space.md}px`,
    paddingTop: '6px',
    paddingBottom: '6px',
    borderRadius: `${radius.pill}px`,
    marginTop: `${space.lg}px`,
  },
  metaRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footer: {
    paddingBottom: `${space.sm}px`,
  },
  confirmHead: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.md}px`,
    marginBottom: `${space.lg}px`,
  },
  confirmAmt: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'flex-end',
    gap: `${space.sm}px`,
    marginBottom: `${space.lg}px`,
  },
} satisfies Record<string, React.CSSProperties>;
