import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text as RNText,
  FlatList,
  TextInput,
  StyleSheet,
  ListRenderItem,
} from 'react-native';

import { useNavySession } from '@/lib/auth/SessionContext';
import { getEnv } from '@/lib/config/env';
import { NavyPayClient, Payment } from '@/lib/pay/navyPayClient';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { IconBadge, GlowIcon, PressRow } from '@/ui/Bits';
import { Skeleton } from '@/ui/Skeleton';
import { colors, radius, space } from '@/ui/theme';

// ── helpers ────────────────────────────────────────────────────────────────

function dayLabel(iso: string | null): string {
  if (!iso) return 'Pending';
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'paid') return 'success';
  if (s === 'pending') return 'warning';
  return 'neutral';
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

type Filter = { key: string; label: string; match: (p: Payment) => boolean };

const FILTERS: Filter[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'paid', label: 'Paid', match: (p) => p.status.toLowerCase() === 'paid' },
  {
    key: 'pending',
    label: 'Pending',
    match: (p) => p.status.toLowerCase() !== 'paid',
  },
];

// ── flat-list item types ────────────────────────────────────────────────────

type ListItem =
  | { type: 'section'; title: string; id: string }
  | { type: 'payment'; payment: Payment; isLast: boolean };

// ── screen ─────────────────────────────────────────────────────────────────

export default function History() {
  const { session, authedFetch } = useNavySession();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const token = session?.tokens.accessToken;
    if (!token) return;
    try {
      setPayments(
        await new NavyPayClient(getEnv().navyApiUrl, undefined, authedFetch ?? undefined).getUserPayments(token),
      );
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

  const availableFilters = useMemo(
    () => FILTERS.filter((f) => f.key === 'all' || payments.some(f.match)),
    [payments],
  );

  const filtered = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
    const q = query.trim().toLowerCase();
    return payments.filter((p) => {
      if (!active.match(p)) return false;
      if (!q) return true;
      return (
        (p.merchant ?? '').toLowerCase().includes(q) ||
        (p.reference ?? '').toLowerCase().includes(q)
      );
    });
  }, [payments, filter, query]);

  const sections = useMemo(() => groupByDay(filtered), [filtered]);

  // Flatten sections into a single list for FlatList
  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    for (const section of sections) {
      items.push({ type: 'section', title: section.title, id: section.title });
      section.data.forEach((payment, i) => {
        items.push({
          type: 'payment',
          payment,
          isLast: i === section.data.length - 1,
        });
      });
    }
    return items;
  }, [sections]);

  const renderItem: ListRenderItem<ListItem> = ({ item }) => {
    if (item.type === 'section') {
      return (
        <Text variant="caption" dim style={styles.sectionHeader}>
          {item.title}
        </Text>
      );
    }
    const { payment: p, isLast } = item;
    return (
      <View>
        <View style={styles.row}>
          <IconBadge name="arrowUpRight" color={colors.textDim} size={44} />
          <View style={styles.rowMid}>
            <RNText
              numberOfLines={1}
              style={styles.rowTitle}
            >
              {p.merchant ?? p.reference ?? 'Payment'}
            </RNText>
            <Text variant="caption" muted>
              {[timeLabel(p.paidAt), p.status].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text variant="bodyStrong" numeric color={colors.textHi}>
              -{usdcBaseToDisplay(p.amount)}
            </Text>
            <Text variant="caption" muted>
              USDC
            </Text>
          </View>
        </View>
        {!isLast && <View style={styles.rowDivider} />}
      </View>
    );
  };

  const keyExtractor = (item: ListItem) =>
    item.type === 'section' ? `section-${item.id}` : item.payment.orderId;

  return (
    <Screen scroll tabSafe onRefresh={pull} refreshing={refreshing}>
      {/* Header */}
      <View style={styles.header}>
        <Text variant="h2" color={colors.textHi}>
          Activity
        </Text>
        <PressRow
          onPress={() => {
            setSearching((s) => {
              if (s) setQuery('');
              return !s;
            });
          }}
          style={styles.iconBtn}
        >
          <Icon
            name="search"
            size={20}
            color={searching ? colors.aqua : colors.textDim}
          />
        </PressRow>
      </View>

      {/* Search input */}
      {searching && (
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search merchant or reference"
          placeholderTextColor={colors.textDim}
          style={styles.search}
        />
      )}

      {/* Filter chips */}
      {availableFilters.length > 1 && (
        <View style={styles.chips}>
          {availableFilters.map((f) => {
            const active = f.key === filter;
            return (
              <PressRow
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
              >
                <Text
                  variant="label"
                  color={active ? colors.aqua : colors.textDim}
                >
                  {f.label}
                </Text>
              </PressRow>
            );
          })}
        </View>
      )}

      {/* Loading skeleton */}
      {!loaded && (
        <View style={styles.skeletonWrap}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={64} style={styles.skeletonRow} />
          ))}
        </View>
      )}

      {/* Grouped list via FlatList */}
      {loaded && listItems.length > 0 && (
        <Card glass compact style={styles.listCard}>
          <FlatList
            data={listItems}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            scrollEnabled={false}
          />
        </Card>
      )}

      {/* Empty state */}
      {loaded && filtered.length === 0 && (
        <View style={styles.empty}>
          <GlowIcon name="clock" color={colors.textDim} size={92} />
          <Text
            variant="h3"
            color={colors.text}
            center
            style={styles.emptyTitle}
          >
            {payments.length === 0 ? 'No payments yet' : 'Nothing matches'}
          </Text>
          <Text dim center style={styles.emptyBody}>
            {payments.length === 0
              ? 'When you pay a Navy merchant, it shows up here.'
              : 'Try a different filter or search.'}
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  search: {
    marginBottom: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textHi,
    fontSize: 16,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.md,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: 'rgba(79,140,255,0.14)',
    borderColor: 'rgba(79,140,255,0.32)',
  },
  chipInactive: {
    backgroundColor: colors.glassFill,
    borderColor: colors.border,
  },
  skeletonWrap: {
    gap: space.sm,
    marginTop: space.lg,
  },
  skeletonRow: {
    borderRadius: radius.md,
  },
  listCard: {
    marginTop: space.lg,
    padding: space.xs,
  },
  sectionHeader: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  rowMid: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0,
    lineHeight: 21,
    color: colors.textHi,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: space.md,
  },
  empty: {
    alignItems: 'center',
    marginTop: space.xxl,
    paddingTop: space.xxxl,
    paddingBottom: space.xxxl,
  },
  emptyTitle: {
    marginTop: space.lg,
  },
  emptyBody: {
    marginTop: space.sm,
    textAlign: 'center',
  },
});
