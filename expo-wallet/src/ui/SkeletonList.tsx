import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from './Skeleton';
import { colors, radius, space } from './theme';

interface SkeletonListProps {
  rows?: number;
  height?: number;
  /** Show icon + text row skeleton */
  variant?: 'list' | 'card' | 'hero';
}

/** N stacked skeleton rows for loading lists (history, farming, home). */
export function SkeletonList({
  rows = 4,
  height = 56,
  variant = 'list',
}: SkeletonListProps) {
  if (variant === 'hero') {
    return <HeroSkeleton />;
  }

  if (variant === 'card') {
    return (
      <View style={styles.cardSkeleton}>
        {Array.from({ length: rows }).map((_, i) => (
          <View key={i} style={styles.cardRow}>
            <Skeleton circle height={40} width={40} />
            <View style={styles.cardTextGroup}>
              <Skeleton width="60%" height={14} style={styles.cardLine} />
              <Skeleton width="40%" height={12} style={styles.cardLineSmall} />
            </View>
            <Skeleton width={60} height={16} style={styles.cardAmount} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <Skeleton circle height={44} width={44} />
          <View style={styles.textGroup}>
            <Skeleton width="70%" height={15} style={styles.textLine} />
            <Skeleton width="40%" height={12} style={styles.textLineSmall} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Hero skeleton for balance/position displays */
export function HeroSkeleton() {
  return (
    <View style={styles.heroSkeleton}>
      <Skeleton width={120} height={12} style={styles.heroLabel} />
      <View style={styles.heroAmountRow}>
        <Skeleton width={180} height={44} />
      </View>
      <Skeleton width={140} height={12} style={styles.heroSubtext} />
    </View>
  );
}

/** Transaction row skeleton */
export function TransactionSkeleton() {
  return (
    <View style={styles.transactionSkeleton}>
      <Skeleton circle height={44} width={44} />
      <View style={styles.transactionText}>
        <Skeleton width="65%" height={15} style={styles.textLine} />
        <Skeleton width="35%" height={12} style={styles.textLineSmall} />
      </View>
      <Skeleton width={70} height={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  textGroup: {
    flex: 1,
    gap: space.xs,
  },
  textLine: {
    marginBottom: space.xs,
  },
  textLineSmall: {
    marginBottom: 0,
  },
  cardSkeleton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  cardTextGroup: {
    flex: 1,
    gap: space.xs,
  },
  cardLine: {
    marginBottom: space.xs,
  },
  cardLineSmall: {
    marginBottom: 0,
  },
  cardAmount: {
    marginLeft: 'auto',
  },
  heroSkeleton: {
    padding: space.xl,
    gap: space.sm,
    alignItems: 'center',
  },
  heroLabel: {
    marginBottom: space.sm,
  },
  heroAmountRow: {
    marginVertical: space.md,
  },
  heroSubtext: {
    marginTop: space.xs,
  },
  transactionSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  transactionText: {
    flex: 1,
    gap: space.xs,
  },
});
