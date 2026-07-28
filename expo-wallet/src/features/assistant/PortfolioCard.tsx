import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';
import { usdcBaseToDisplay, weiToEth } from '@/lib/wallet/balances';

/**
 * Renders a `get_portfolio` or `get_farming_summary` tool result.
 * Both are `{display:{kind:'card'}}` shaped; fields are guarded so a farming
 * summary (`{position:{sharesBase,assetsBase}}`) or a portfolio
 * (`usdcBase`/`ethWei`/`farming:{sharesBase,assetsBase}`) both render sensibly.
 *
 * The pooled vault position exposes `assetsBase` (current USDC value of the
 * user's shares) and `sharesBase` (the raw share balance). We surface the
 * assets value as the headline "Farming" figure.
 */
export function PortfolioCard({ result }: { result: any }) {
  const usdcBase: string | undefined = result?.usdcBase;
  const ethWei: string | undefined = result?.ethWei;
  // Portfolio carries the vault position under `farming`; the farming summary
  // carries it under `position`. Both are `{sharesBase, assetsBase}`.
  const vaultPosition = result?.farming ?? result?.position;
  const farmedBase: string | undefined = vaultPosition?.assetsBase;
  const sharesBase: string | undefined = vaultPosition?.sharesBase;

  return (
    <Card glass compact style={styles.card}>
      <Text variant="label" upper color={colors.aqua}>
        Portfolio
      </Text>
      <View style={styles.rows}>
        {usdcBase !== undefined && (
          <Row label="USDC" value={usdcBaseToDisplay(usdcBase)} unit="USDC" />
        )}
        {ethWei !== undefined && (
          <Row label="ETH" value={weiToEth(ethWei)} unit="ETH" />
        )}
        {farmedBase !== undefined && (
          <Row label="Farming" value={usdcBaseToDisplay(farmedBase)} unit="USDC" accent />
        )}
        {sharesBase !== undefined && farmedBase !== undefined && (
          <Row label="Shares" value={usdcBaseToDisplay(sharesBase)} unit="shares" />
        )}
      </View>
    </Card>
  );
}

function Row({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <View style={styles.amount}>
        <Text variant="bodyStrong" numeric color={accent ? colors.aqua : colors.textHi}>
          {value}
        </Text>
        <Text variant="caption" muted>
          {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.sm,
  },
  rows: {
    marginTop: space.md,
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
  },
});
