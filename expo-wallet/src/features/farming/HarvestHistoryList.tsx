import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Divider } from '@/ui/Bits';
import { colors, radius, space } from '@/ui/theme';
import type { HarvestsResponse, HarvestRecord } from '@/lib/vault/types';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';

interface HarvestHistoryListProps {
  harvests: HarvestsResponse | null | undefined;
}

/** Format an ISO date string as a short locale date string. */
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Format USDC base units as a display string. */
function fmtUsdc(base: string): string {
  const v = Number(usdcBaseToDisplay(base));
  return v === 0 ? '—' : `${v.toFixed(4)} USDC`;
}

function HarvestRow({ record }: { record: HarvestRecord }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text variant="bodyStrong" color={colors.textHi}>
          {record.protocol}
        </Text>
        <Text variant="caption" muted>
          {fmtDate(record.harvestedAt)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text variant="bodyStrong" numeric color={colors.success}>
          +{fmtUsdc(record.netBase)}
        </Text>
        <Text variant="caption" muted>
          gross {fmtUsdc(record.grossBase)}
        </Text>
      </View>
    </View>
  );
}

export function HarvestHistoryList({ harvests }: HarvestHistoryListProps) {
  if (!harvests || harvests.harvests.length === 0) {
    return (
      <Card glass compact style={styles.card}>
        <Text variant="label" upper color={colors.aqua}>
          Harvest history
        </Text>
        <View style={styles.empty}>
          <Text variant="caption" muted>
            No harvests yet.
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card glass compact style={styles.card}>
      <Text variant="label" upper color={colors.aqua}>
        Harvest history
      </Text>
      <Divider style={styles.divider} />
      {harvests.harvests.map((record, i) => (
        <View key={`${record.harvestedAt}-${i}`}>
          <HarvestRow record={record} />
          {i < harvests.harvests.length - 1 && <View style={styles.rowSep} />}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.lg,
  },
  divider: {
    marginVertical: space.md,
  },
  empty: {
    marginTop: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
  },
  rowRight: {
    alignItems: 'flex-end',
    minWidth: 0,
  },
  rowSep: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: space.md,
  },
});
