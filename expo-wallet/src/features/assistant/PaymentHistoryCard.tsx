import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';

/**
 * Renders a `get_payment_history` tool result: `{display:{kind:'card'}, orders:[...]}`.
 * Each order carries `{ orderId, reference, amount, paidAt, merchant }` (amount is 6-decimal
 * USDC base units, serialized as a string). Empty history renders nothing — the assistant's
 * text already says there are no payments.
 */
export function PaymentHistoryCard({ result }: { result: any }) {
  const orders: any[] = Array.isArray(result?.orders) ? result.orders : [];
  if (orders.length === 0) return null;

  return (
    <Card glass compact style={styles.card}>
      <Text variant="label" upper color={colors.aqua}>
        Recent payments
      </Text>
      <View style={styles.rows}>
        {orders.slice(0, 8).map((o, i) => {
          const title: string =
            (typeof o?.merchant === 'string' && o.merchant) ||
            (typeof o?.reference === 'string' && o.reference) ||
            'Payment';
          const amount = usdcBaseToDisplay(typeof o?.amount === 'string' ? o.amount : '0');
          return (
            <View key={o?.orderId ?? i} style={styles.row}>
              <View style={styles.left}>
                <Text variant="body" color={colors.textHi} style={styles.title}>
                  {title}
                </Text>
                {formatDate(o?.paidAt) && (
                  <Text variant="caption" muted>
                    {formatDate(o.paidAt)}
                  </Text>
                )}
              </View>
              <View style={styles.amount}>
                <Text variant="bodyStrong" numeric color={colors.textHi}>
                  {amount}
                </Text>
                <Text variant="caption" muted>
                  USDC
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** ISO/date string → short "MMM D" label; empty string if unparseable. */
function formatDate(v: unknown): string {
  if (typeof v !== 'string' && !(v instanceof Date)) return '';
  const d = new Date(v as any);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.sm,
  },
  rows: {
    marginTop: space.md,
    gap: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  left: {
    flex: 1,
    gap: 2,
  },
  title: {
    flexShrink: 1,
  },
  amount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.xs,
  },
});
