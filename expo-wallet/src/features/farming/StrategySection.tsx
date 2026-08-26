import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Divider } from '@/ui/Bits';
import { colors, radius, space } from '@/ui/theme';
import type { StrategyAllocation, AdapterApy } from '@/lib/vault/types';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';

interface StrategySectionProps {
  strategy: StrategyAllocation | null | undefined;
  apys: AdapterApy[];
}

/** Maps adapter address to its APY. */
function apyFor(apys: AdapterApy[], address: string): number {
  return apys.find((a) => a.address.toLowerCase() === address.toLowerCase())?.apyBps ?? 0;
}

/** Format basis points as a percentage string. */
function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function StrategySection({ strategy, apys }: StrategySectionProps) {
  if (!strategy) return null;

  const totalAssets = Number(usdcBaseToDisplay(strategy.totalAssets));

  return (
    <Card glass compact style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Text variant="label" upper color={colors.aqua}>
          Strategy allocation
        </Text>
        <Text variant="caption" muted>
          {totalAssets.toFixed(4)} USDC TVL
        </Text>
      </View>

      <Divider style={styles.divider} />

      {/* Allocation bars */}
      <View style={styles.bars}>
        {strategy.allocations.map((alloc) => {
          const allocApy = apyFor(apys, alloc.adapter);
          return (
            <View key={alloc.adapter} style={styles.allocRow}>
              <View style={styles.allocLeft}>
                <Text variant="bodyStrong" color={colors.textHi}>
                  {alloc.name}
                </Text>
                <Text variant="caption" muted>
                  {allocApy > 0 ? `${fmtPct(allocApy)} APY` : '—'}
                </Text>
              </View>
              <View style={styles.allocRight}>
                <Text variant="caption" numeric color={colors.textHi} style={styles.pctLabel}>
                  {alloc.percentage.toFixed(1)}%
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.min(alloc.percentage, 100)}%` },
                    ]}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  divider: {
    marginVertical: space.md,
  },
  bars: {
    gap: space.md,
  },
  allocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  allocLeft: {
    flex: 1,
    minWidth: 0,
  },
  allocRight: {
    alignItems: 'flex-end',
    minWidth: 90,
  },
  pctLabel: {
    marginBottom: space.xs,
  },
  barTrack: {
    width: '100%',
    height: 6,
    backgroundColor: colors.glassFill,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.aqua,
    borderRadius: radius.sm,
  },
});
