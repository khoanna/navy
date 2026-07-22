import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';

/**
 * Renders an analytics tool result (`{display:{kind:'chart', chartType}}`) as a
 * simple bar chart with react-native-svg. `values` are base-unit strings; bars
 * are scaled to the max value. `labels` (e.g. dates) are shortened to MM-DD.
 */
export function ChartCard({ result }: { result: any }) {
  const labels: string[] = Array.isArray(result?.labels) ? result.labels : [];
  const rawValues: string[] = Array.isArray(result?.values) ? result.values : [];

  const values: bigint[] = rawValues.map((v) => {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  });
  const max = values.reduce((m, v) => (v > m ? v : m), 0n);

  const CHART_H = 120;
  const BAR_GAP = 6;
  const n = values.length;

  return (
    <Card glass compact style={styles.card}>
      <Text variant="label" upper color={colors.aqua}>
        {result?.chartType ?? 'Analytics'}
      </Text>

      <View style={styles.chartWrap}>
        <Svg width="100%" height={CHART_H}>
          {values.map((v, i) => {
            // Scale bar height to max; guard divide-by-zero.
            const frac = max > 0n ? Number((v * 1000n) / max) / 1000 : 0;
            const h = Math.max(2, frac * (CHART_H - 4));
            const barW = n > 0 ? 100 / n : 100;
            const x = i * barW + BAR_GAP / 2;
            const y = CHART_H - h;
            return (
              <Rect
                key={i}
                x={`${x}%`}
                y={y}
                width={`${Math.max(0, barW - BAR_GAP)}%`}
                height={h}
                rx={4}
                fill={colors.accent}
              />
            );
          })}
        </Svg>
      </View>

      {labels.length > 0 && (
        <View style={styles.labels}>
          {labels.map((l, i) => (
            <Text key={i} variant="caption" muted style={styles.label}>
              {shortLabel(l)}
            </Text>
          ))}
        </View>
      )}

      {result?.totalBase !== undefined && (
        <Text variant="caption" dim style={styles.caption}>
          Total {usdcBaseToDisplay(result.totalBase)} USDC
          {result?.count !== undefined ? ` · ${result.count} tx` : ''}
        </Text>
      )}
    </Card>
  );
}

/** Shorten an ISO date / label to MM-DD when it parses as a date; else pass through. */
function shortLabel(l: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(l);
  if (m) return `${m[2]}-${m[3]}`;
  return l.length > 5 ? l.slice(-5) : l;
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.sm,
  },
  chartWrap: {
    marginTop: space.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  label: {
    flex: 1,
    textAlign: 'center',
  },
  caption: {
    marginTop: space.sm,
  },
});
