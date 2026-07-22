import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { SlideToConfirm } from '@/ui/SlideToConfirm';
import { colors, space } from '@/ui/theme';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';

type Phase = 'idle' | 'sending' | 'done' | 'error';

/**
 * Renders a `build_farming_deposit` (`amountBase`) or `build_farming_withdraw`
 * (`amount`, may be the literal 'all') action result. Slide-to-confirm runs
 * `onConfirm` (the caller wires the FarmingClient deposit/withdraw call).
 */
export function FarmingConfirmCard({
  result,
  onConfirm,
}: {
  result: any;
  onConfirm: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');

  const action: string = result?.display?.action ?? '';
  const isWithdraw = action === 'farming_withdraw';
  const rawAmount: string = isWithdraw ? result?.amount : result?.amountBase;
  const isAll = isWithdraw && rawAmount === 'all';
  const amountDisplay = isAll ? 'All' : usdcBaseToDisplay(rawAmount ?? '0');
  const verb = isWithdraw ? 'Withdraw' : 'Deposit';

  const run = () => {
    if (phase === 'sending' || phase === 'done') return;
    setPhase('sending');
    onConfirm()
      .then(() => setPhase('done'))
      .catch(() => setPhase('error'));
  };

  return (
    <Card glass compact style={styles.card}>
      <Text variant="label" upper color={colors.aqua}>
        Confirm {verb.toLowerCase()}
      </Text>

      <View style={styles.amountRow}>
        <Text variant="h2" numeric color={colors.textHi}>
          {amountDisplay}
        </Text>
        {!isAll && (
          <Text variant="caption" muted>
            USDC
          </Text>
        )}
      </View>

      <Text variant="caption" muted>
        {isWithdraw ? 'Withdraw from Compound farming' : 'Supply to Compound farming'}
      </Text>

      {phase === 'done' ? (
        <View style={styles.statusRow}>
          <Icon name="check" size={18} color={colors.success} />
          <Text variant="bodyStrong" color={colors.success}>
            Done ✓
          </Text>
        </View>
      ) : phase === 'error' ? (
        <View style={styles.statusCol}>
          <View style={styles.statusRow}>
            <Icon name="x" size={18} color={colors.danger} />
            <Text variant="bodyStrong" color={colors.danger}>
              Failed
            </Text>
          </View>
          <SlideToConfirm label="Slide to retry" onConfirm={run} resetKey={phase} />
        </View>
      ) : (
        <SlideToConfirm
          label={phase === 'sending' ? 'Working…' : `Slide to ${verb.toLowerCase()}`}
          onConfirm={run}
          disabled={phase === 'sending'}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.sm,
    gap: space.md,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  statusCol: {
    gap: space.md,
  },
});
