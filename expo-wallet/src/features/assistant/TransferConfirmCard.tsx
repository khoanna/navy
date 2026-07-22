import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { SlideToConfirm } from '@/ui/SlideToConfirm';
import { colors, space } from '@/ui/theme';
import { usdcBaseToDisplay, weiToEth } from '@/lib/wallet/balances';
import { short } from '@/lib/wallet/identicon';
import { mapSendError } from '@/lib/wallet/sendErrors';

type Phase = 'idle' | 'sending' | 'done' | 'error';

/**
 * Renders a `build_transfer` action result and lets the user slide to confirm.
 * `onConfirm` signs the returned typedData + submits (the authorization is
 * already persisted server-side — the assistant never moves funds).
 */
export function TransferConfirmCard({
  result,
  onConfirm,
}: {
  result: any;
  onConfirm: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [lastError, setLastError] = useState<unknown>(null);

  const recipient = result?.recipient ?? {};
  const address: string = recipient.address ?? '';
  const username: string | null = recipient.username ?? null;
  const label = username ? `@${username} · ${short(address)}` : short(address);

  const isEth = result?.asset === 'ETH';
  const amountText = isEth
    ? `${weiToEth(result?.amountWei ?? '0')}`
    : usdcBaseToDisplay(result?.amount ?? '0');
  const assetLabel = isEth ? 'ETH' : 'USDC';
  const feeText = isEth ? 'Network fee paid from your ETH' : 'gasless · $0.00 fee';

  const run = () => {
    if (phase === 'sending' || phase === 'done') return;
    setPhase('sending');
    onConfirm()
      .then(() => setPhase('done'))
      .catch((e) => {
        setLastError(e);
        setPhase('error');
      });
  };

  return (
    <Card glass compact style={styles.card}>
      <Text variant="label" upper color={colors.aqua}>
        Confirm transfer
      </Text>

      <View style={styles.row}>
        <Text variant="caption" muted>
          To
        </Text>
        <Text variant="bodyStrong" color={colors.textHi}>
          {label}
        </Text>
      </View>

      <View style={styles.amountRow}>
        <Text variant="h2" numeric color={colors.textHi}>
          {amountText}
        </Text>
        <Text variant="caption" muted>
          {assetLabel}
        </Text>
      </View>

      <Text variant="caption" color={colors.aqua} style={styles.fee}>
        {feeText}
      </Text>

      {phase === 'done' ? (
        <View style={styles.statusRow}>
          <Icon name="check" size={18} color={colors.success} />
          <Text variant="bodyStrong" color={colors.success}>
            Sent ✓
          </Text>
        </View>
      ) : phase === 'error' ? (
        <View style={styles.statusCol}>
          <View style={styles.statusRow}>
            <Icon name="x" size={18} color={colors.danger} />
            <Text variant="bodyStrong" color={colors.danger}>
              {mapSendError(lastError).title}
            </Text>
          </View>
          <Text variant="caption" muted>
            {mapSendError(lastError).detail}
          </Text>
          <SlideToConfirm label="Slide to retry" onConfirm={run} resetKey={phase} />
        </View>
      ) : (
        <SlideToConfirm
          label={phase === 'sending' ? 'Sending…' : 'Slide to send'}
          onConfirm={run}
          disabled={phase === 'sending'}
        />
      )}

      <Text variant="caption" muted center style={styles.reassure}>
        you sign — the assistant never moves funds
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.sm,
    gap: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  fee: {
    marginTop: -space.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  statusCol: {
    gap: space.md,
  },
  reassure: {
    marginTop: space.xs,
  },
});
