import React from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * Renders a CoinGecko token result (`{display:{kind:'token'}}`): header, price +
 * 24h change pill, a market-cap / 7d-change row, a 7d line sparkline drawn with
 * react-native-svg, and an optional truncated description. All fields are
 * null-guarded (CoinGecko often omits supply/ATL/description for smaller coins).
 */
export function TokenInfoCard({ result }: { result: any }) {
  const symbol: string = typeof result?.symbol === 'string' ? result.symbol.toUpperCase() : '';
  const name: string = typeof result?.name === 'string' ? result.name : 'Token';
  const rank: number | null = typeof result?.rank === 'number' ? result.rank : null;

  const priceUsd: number | null = typeof result?.priceUsd === 'number' ? result.priceUsd : null;
  const change24h: number | null = typeof result?.change24h === 'number' ? result.change24h : null;
  const change7d: number | null = typeof result?.change7d === 'number' ? result.change7d : null;
  const marketCapUsd: number | null = typeof result?.marketCapUsd === 'number' ? result.marketCapUsd : null;

  const spark: number[] = Array.isArray(result?.sparkline7d)
    ? result.sparkline7d.filter((n: any) => typeof n === 'number' && isFinite(n))
    : [];

  const description: string | null =
    typeof result?.description === 'string' && result.description.trim() ? result.description.trim() : null;

  const up24 = (change24h ?? 0) >= 0;

  return (
    <Card glass compact style={styles.card}>
      {/* Header */}
      <View style={styles.headRow}>
        <Text variant="bodyStrong" color={colors.textHi}>
          {name} <Text variant="caption" dim>({symbol})</Text>
        </Text>
        {rank != null && (
          <View style={styles.rankPill}>
            <Text variant="label" color={colors.aqua}>
              #{rank}
            </Text>
          </View>
        )}
      </View>

      {/* Price + 24h change pill */}
      <View style={styles.priceRow}>
        <Text variant="h1" numeric color={colors.textHi}>
          {formatUsd(priceUsd)}
        </Text>
        {change24h != null && (
          <View style={[styles.changePill, { backgroundColor: up24 ? 'rgba(47,224,194,0.14)' : 'rgba(255,107,131,0.14)' }]}>
            <Text variant="caption" color={up24 ? colors.success : colors.danger}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </Text>
          </View>
        )}
      </View>

      {/* Market cap / 7d row */}
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text variant="label" upper dim>
            Market cap
          </Text>
          <Text variant="caption" color={colors.text}>
            {formatCompactUsd(marketCapUsd)}
          </Text>
        </View>
        {change7d != null && (
          <View style={styles.stat}>
            <Text variant="label" upper dim>
              7d
            </Text>
            <Text variant="caption" color={change7d >= 0 ? colors.success : colors.danger}>
              {change7d >= 0 ? '+' : ''}{change7d.toFixed(2)}%
            </Text>
          </View>
        )}
      </View>

      {/* 7d sparkline */}
      {spark.length >= 2 && <Sparkline values={spark} />}

      {/* Description */}
      {description && (
        <RNText numberOfLines={3} style={styles.desc}>
          {description}
        </RNText>
      )}
    </Card>
  );
}

/** A 7d line sparkline scaled to its own min/max; green if last ≥ first else red. */
function Sparkline({ values }: { values: number[] }) {
  const W = 100; // viewBox width (percent-like units)
  const H = 44;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const n = values.length;

  const points = values
    .map((v, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - ((v - min) / span) * (H - 4) - 2; // 2px padding top/bottom
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const up = values[n - 1] >= values[0];

  return (
    <View style={styles.sparkWrap}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Polyline
          points={points}
          fill="none"
          stroke={up ? colors.success : colors.danger}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

/** Format a USD price like `$1,234.56` (or `—` when null). */
export function formatUsd(n: number | null): string {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  // Sub-dollar prices keep more precision so tiny tokens don't show as $0.00.
  const decimals = abs !== 0 && abs < 1 ? 4 : 2;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Format a large USD figure compactly: `$1.3T` / `$45.2B` / `$12.7M` / `$3,400` (or `—`). */
export function formatCompactUsd(n: number | null): string {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.sm,
    minWidth: 260,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  rankPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(47,224,194,0.12)',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
  },
  changePill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
  },
  statRow: {
    flexDirection: 'row',
    gap: space.xxl,
    marginTop: space.md,
  },
  stat: {
    gap: 2,
  },
  sparkWrap: {
    marginTop: space.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  desc: {
    marginTop: space.md,
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
});
