'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavySession } from '@/lib/auth/SessionContext';
import { getEnv } from '@/lib/config/env';
import { NavyPayClient, Payment } from '@/lib/pay/navyPayClient';
import { usdcBaseToDisplay } from '@/lib/wallet/balances';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { IconBadge, GlowIcon, PressRow } from '@/ui/Bits';
import { colors, gradients, radius, space } from '@/ui/theme';

// ── helpers ────────────────────────────────────────────────────────────────

function dayLabel(iso: string | null): string {
  if (!iso) return 'Pending';
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
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

// Filter chips are derived from a REAL field (`status`). Every payment in this
// history is outgoing (the payer's own payments) — there is no direction/type
// field, so we do not fabricate received/earn categories.
type Filter = { key: string; label: string; match: (p: Payment) => boolean };

const FILTERS: Filter[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'paid', label: 'Paid', match: (p) => p.status.toLowerCase() === 'paid' },
  { key: 'pending', label: 'Pending', match: (p) => p.status.toLowerCase() !== 'paid' },
];

// ── screen ─────────────────────────────────────────────────────────────────

export default function History() {
  const { session } = useNavySession();
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

  // Which status filters actually apply to the fetched data.
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

  return (
    <Screen scroll tabSafe onRefresh={pull} refreshing={refreshing}>
      {/* Header */}
      <div style={styles.header}>
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
          <Icon name="search" size={20} color={searching ? colors.aqua : colors.textDim} />
        </PressRow>
      </div>

      {searching && (
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant or reference"
          style={styles.search}
        />
      )}

      {/* Filter chips (only ones the data supports) */}
      {availableFilters.length > 1 && (
        <div style={styles.chips}>
          {availableFilters.map((f) => {
            const active = f.key === filter;
            const pill = (
              <PressRow onPress={() => setFilter(f.key)} style={{ borderRadius: `${radius.pill}px` }}>
                <div style={styles.chipInner}>
                  <Text variant="label" color={active ? colors.onAccent : colors.textDim}>
                    {f.label}
                  </Text>
                </div>
              </PressRow>
            );
            return active ? (
              <Gradient key={f.key} colors={gradients.ocean} style={{ borderRadius: `${radius.pill}px` }}>
                {pill}
              </Gradient>
            ) : (
              <div key={f.key} style={styles.chipGlass}>
                {pill}
              </div>
            );
          })}
        </div>
      )}

      {/* Grouped list */}
      {sections.map((section) => (
        <div key={section.title} style={{ marginTop: `${space.lg}px` }}>
          <Text variant="caption" dim style={styles.sectionHeader}>
            {section.title}
          </Text>
          <Card glass compact style={{ padding: `${space.xs}px` }}>
            {section.data.map((item) => (
              <PressRow key={item.orderId} style={styles.row}>
                <IconBadge name="arrowUpRight" color={colors.textDim} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    variant="bodyStrong"
                    color={colors.textHi}
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                  >
                    {item.merchant ?? item.reference ?? 'Payment'}
                  </Text>
                  <Text variant="caption" muted>
                    {[timeLabel(item.paidAt), item.status].filter(Boolean).join(' · ')}
                  </Text>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <Text variant="bodyStrong" numeric color={colors.textHi}>
                    -{usdcBaseToDisplay(item.amount)}
                  </Text>
                  <Text variant="caption" muted>
                    USDC
                  </Text>
                </div>
              </PressRow>
            ))}
          </Card>
        </div>
      ))}

      {/* Empty state — card-less, centered */}
      {loaded && filtered.length === 0 && (
        <div style={styles.empty}>
          <GlowIcon name="clock" color={colors.textDim} size={92} />
          <Text variant="h3" color={colors.text} style={{ marginTop: `${space.lg}px`, textAlign: 'center', display: 'block' }}>
            {payments.length === 0 ? 'No payments yet' : 'Nothing matches'}
          </Text>
          <Text dim style={{ marginTop: `${space.sm}px`, textAlign: 'center', display: 'block' }}>
            {payments.length === 0
              ? 'When you pay a Navy merchant, it shows up here.'
              : 'Try a different filter or search.'}
          </Text>
        </div>
      )}
    </Screen>
  );
}

const styles = {
  header: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: `${space.lg}px`,
  } as React.CSSProperties,
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: `${radius.md}px`,
    justifyContent: 'center',
    backgroundColor: colors.glassFill,
    border: `1px solid ${colors.border}`,
  } as React.CSSProperties,
  search: {
    width: '100%',
    boxSizing: 'border-box',
    marginBottom: `${space.md}px`,
    padding: `${space.md}px`,
    borderRadius: `${radius.md}px`,
    backgroundColor: colors.glassFill,
    border: `1px solid ${colors.border}`,
    color: colors.textHi,
    fontSize: 16,
    outline: 'none',
  } as React.CSSProperties,
  chips: {
    display: 'flex',
    flexDirection: 'row' as const,
    gap: `${space.sm}px`,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  chipInner: {
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: `${space.lg}px`,
    paddingRight: `${space.lg}px`,
  } as React.CSSProperties,
  chipGlass: {
    borderRadius: `${radius.pill}px`,
    backgroundColor: colors.glassFill,
    border: `1px solid ${colors.border}`,
  } as React.CSSProperties,
  sectionHeader: {
    marginBottom: `${space.sm}px`,
    display: 'block',
  } as React.CSSProperties,
  row: {
    gap: `${space.md}px`,
    padding: `${space.md}px`,
  } as React.CSSProperties,
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginTop: `${space.xxl}px`,
    paddingTop: `${space.xxxl}px`,
    paddingBottom: `${space.xxxl}px`,
  } as React.CSSProperties,
} satisfies Record<string, React.CSSProperties>;
