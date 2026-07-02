'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavySession } from '@/lib/auth/SessionContext';
import { getEnv } from '@/lib/config/env';
import { NavyPayClient, Payment } from '@/lib/pay/navyPayClient';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { IconBadge } from '@/ui/Bits';
import { colors, radius, space } from '@/ui/theme';

// ── helpers (verbatim from mobile/app/(tabs)/history.tsx) ──────────────────

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

// ── screen ─────────────────────────────────────────────────────────────────

export default function History() {
  const { session } = useNavySession();
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
    <Screen scroll tabSafe onRefresh={pull} refreshing={refreshing}>
      {/* Header */}
      <div style={styles.header}>
        <Text variant="label" muted upper>
          Activity
        </Text>
        <Text variant="h1" color={colors.textHi} style={{ marginTop: '2px' }}>
          Payments
        </Text>
      </div>

      {/* Section list rendered as mapped divs */}
      {sections.map((section) => (
        <div key={section.title}>
          <Text variant="label" muted upper style={styles.sectionHeader}>
            {section.title}
          </Text>
          {section.data.map((item) => (
            <div key={item.orderId} style={styles.row}>
              <IconBadge name="arrowUpRight" color={colors.accent} size={44} />
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
                  {timeLabel(item.paidAt) || item.status}
                </Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Text variant="bodyStrong" numeric color={colors.textHi}>
                  -{(Number(item.amount) / 1_000_000).toFixed(2)}
                </Text>
                <Text variant="caption" muted>
                  USDC
                </Text>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Empty state */}
      {loaded && payments.length === 0 && (
        <div style={styles.empty}>
          <IconBadge name="clock" color={colors.textMute} size={72} />
          <Text variant="h3" color={colors.text} style={{ marginTop: `${space.lg}px`, textAlign: 'center' }}>
            No payments yet
          </Text>
          <Text dim style={{ marginTop: `${space.sm}px`, textAlign: 'center' }}>
            When you pay a Navy merchant, it shows up here.
          </Text>
        </div>
      )}
    </Screen>
  );
}

const styles = {
  header: {
    marginBottom: `${space.lg}px`,
  } as React.CSSProperties,
  sectionHeader: {
    marginTop: `${space.lg}px`,
    marginBottom: `${space.sm}px`,
    display: 'block',
  } as React.CSSProperties,
  row: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.md}px`,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: `${radius.lg}px`,
    padding: `${space.md}px`,
    marginBottom: `${space.sm}px`,
  } as React.CSSProperties,
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    paddingTop: '80px',
  } as React.CSSProperties,
} satisfies Record<string, React.CSSProperties>;
