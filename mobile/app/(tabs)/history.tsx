import React, { useCallback, useEffect, useState } from 'react';
import { View, SectionList, StyleSheet, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavySession } from '../../src/auth/SessionContext';
import { getEnv } from '../../src/config/env';
import { NavyPayClient, Payment } from '../../src/pay/navyPayClient';
import { Text } from '../../src/ui/Text';
import { IconBadge } from '../../src/ui/Bits';
import { colors, radius, space } from '../../src/ui/theme';

function dayLabel(iso: string | null): string {
  if (!iso) return 'Pending';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

interface Section {
  title: string;
  data: Payment[];
}

function groupByDay(payments: Payment[]): Section[] {
  const map = new Map<string, Payment[]>();
  for (const p of payments) {
    const key = dayLabel(p.paidAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

export default function History() {
  const { session } = useNavySession();
  const insets = useSafeAreaInsets();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const token = session?.tokens.accessToken;
    if (!token) return;
    try {
      setPayments(await new NavyPayClient(getEnv().navyApiUrl).getUserPayments(token));
    } catch {
      setPayments([]);
    } finally {
      setLoaded(true);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const pull = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sections = groupByDay(payments);

  return (
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.orderId}
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: 110, paddingHorizontal: space.xl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl tintColor={colors.aqua} refreshing={refreshing} onRefresh={pull} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="label" muted upper>
              Activity
            </Text>
            <Text variant="h1" color={colors.textHi} style={{ marginTop: 2 }}>
              Payments
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text variant="label" muted upper style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <IconBadge name="arrowUpRight" color={colors.accent} size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" color={colors.textHi} numberOfLines={1}>
                {item.merchant ?? item.reference ?? 'Payment'}
              </Text>
              <Text variant="caption" muted>
                {timeLabel(item.paidAt) || item.status}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="bodyStrong" numeric color={colors.textHi}>
                -{(Number(item.amount) / 1_000_000).toFixed(2)}
              </Text>
              <Text variant="caption" muted>
                USDC
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <IconBadge name="clock" color={colors.textMute} size={72} />
              <Text variant="h3" color={colors.text} center style={{ marginTop: space.lg }}>
                No payments yet
              </Text>
              <Text dim center style={{ marginTop: space.sm }}>
                When you pay a Navy merchant, it shows up here.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { marginBottom: space.lg },
  sectionHeader: { marginTop: space.lg, marginBottom: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
  },
  empty: { alignItems: 'center', paddingTop: 80 },
});
