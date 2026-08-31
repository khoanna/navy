import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { SlideToConfirm } from '@/ui/SlideToConfirm';
import { colors, space } from '@/ui/theme';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';
import { VaultClient } from '@/lib/vault/vaultClient';
import type { VaultApysResponse } from '@/lib/vault/types';
import { mapSendError } from '@/lib/wallet/sendErrors';

type Phase = 'idle' | 'sending' | 'done' | 'error';

/**
 * Renders a `build_farming_deposit` (`amountBase`) or `build_farming_withdraw`
 * (`sharesBase` / amount) action result from the AI assistant.
 *
 * For deposits, fetches current APY to show an estimated 1-year value line.
 * Slide-to-confirm runs `onConfirm` (the caller wires VaultClient deposit/redeem).
 */
export function FarmingConfirmCard({
  result,
  authedFetch,
  signTypedData,
  onConfirm,
}: {
  result: any;
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  signTypedData: (typedData: any) => Promise<string>;
  onConfirm: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [lastError, setLastError] = useState<unknown>(null);
  const [apyData, setApyData] = useState<VaultApysResponse | null>(null);

  // Fetch APY for deposit estimated-value calculation.
  useEffect(() => {
    if (result?.display?.action !== 'farming_deposit') return;
    let cancelled = false;
    const vault = new VaultClient('', authedFetch, signTypedData);
    vault.getApys().then((res) => {
      if (!cancelled) setApyData(res);
    }).catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [result, authedFetch, signTypedData]);

  const action: string = result?.display?.action ?? '';
  const isWithdraw = action === 'farming_withdraw';
  const rawAmount: string = isWithdraw ? result?.amount : result?.amountBase;
  const isAll = isWithdraw && rawAmount === 'all';
  const amountDisplay = isAll ? 'All' : usdcBaseToDisplay(rawAmount ?? '0');
  const verb = isWithdraw ? 'Withdraw' : 'Deposit';

  // Estimated 1-year value for a deposit: amount * (1 + aggregateApyBps / 10000)
  // Shows real APY including high-utilization markets (can exceed 30%).
  // High utilization = high yield opportunity.
  const estimatedValue = (() => {
    if (!isWithdraw && apyData && rawAmount) {
      const amount = parseFloat(usdcBaseToDisplay(rawAmount));
      const apyPct = (apyData.aggregateApyBps / 100).toFixed(2);
      const est = amount * (1 + apyData.aggregateApyBps / 10000);
      return { est, apyPct };
    }
    return null;
  })();

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
        {isWithdraw
          ? 'Withdraw from the Navy vault'
          : 'Deposit into the Navy vault'}
      </Text>

      {isWithdraw && (
        <Text variant="caption" muted>
          SRCLA Strategy → USDC
        </Text>
      )}

      {estimatedValue && (
        <Text variant="caption" color={colors.aqua}>
          ~${estimatedValue.est.toFixed(2)} est. in 1 year at {estimatedValue.apyPct}% APY
        </Text>
      )}

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
          label={phase === 'sending' ? 'Working…' : `Slide to ${verb.toLowerCase()}`}
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
  reassure: {
    marginTop: space.xs,
  },
});
