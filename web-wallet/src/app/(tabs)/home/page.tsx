'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Connection, PublicKey } from '@solana/web3.js';
import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { fetchBalances, lamportsToSol, usdcBaseToDisplay } from '@/lib/wallet/balances';
import { NavyPayClient, Payment } from '@/lib/pay/navyPayClient';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Gradient } from '@/ui/Gradient';
import { Card } from '@/ui/Card';
import { Icon, IconName } from '@/ui/Icon';
import { IconBadge, Pill, PressRow } from '@/ui/Bits';
import { Skeleton } from '@/ui/Skeleton';
import { colors, gradients, radius, space } from '@/ui/theme';
import { earnTip } from '@/lib/wallet/tips';

function short(addr?: string) {
  return addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : 'provisioning…';
}

export default function Home() {
  const router = useRouter();
  const { signOut, session } = useNavySession();
  const { address } = useWebSigner();
  const token = session?.tokens.accessToken;

  const [sol, setSol] = useState('—');
  const [usdc, setUsdc] = useState('—');
  const [recent, setRecent] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const env = getEnv();
    if (address) {
      try {
        const connection = new Connection(env.solanaRpc, 'confirmed');
        const b = await fetchBalances(connection, new PublicKey(address), new PublicKey(env.usdcMint));
        setSol(lamportsToSol(b.solLamports));
        setUsdc(usdcBaseToDisplay(b.usdcBase));
      } catch {
        setSol('0');
        setUsdc('0');
      }
    }
    if (token) {
      try {
        const list = await new NavyPayClient(env.navyApiUrl).getUserPayments(token);
        setRecent(list.slice(0, 3));
      } catch {
        setRecent([]);
      }
    }
  }, [address, token]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleSignOut = () => {
    if (window.confirm('End your session?')) {
      signOut();
    }
  };

  // Tip: nudge idle USDC into the Earn vault
  const usdcNumeric = usdc === '—' ? 0 : Number(usdc.replaceAll(',', '')) || 0;
  const tip = earnTip(usdcNumeric, 100);

  return (
    <Screen scroll tabSafe onRefresh={refresh} refreshing={refreshing}>
      {/* Header row */}
      <div style={styles.header}>
        <div>
          <Text variant="caption" dim>
            Welcome back
          </Text>
          <Text variant="h3" color={colors.textHi} style={{ marginTop: '2px' }}>
            {short(address)}
          </Text>
        </div>
        <button onClick={handleSignOut} style={styles.iconBtn}>
          <Icon name="logout" size={20} color={colors.textDim} />
        </button>
      </div>

      {/* Centered balance hero */}
      <div style={styles.heroWrap}>
        {/* Eyebrow row: "Total balance" + Gasless pill */}
        <div style={styles.heroBrow}>
          <Text variant="label" muted upper>
            Total balance
          </Text>
          <Pill tone="accent" label="Gasless" />
        </div>

        {/* Big USDC number — gradient text when loaded, skeleton when pending */}
        {usdc === '—' ? (
          <Skeleton width={190} height={44} style={{ margin: '6px auto' }} />
        ) : (
          <span
            style={{
              background: 'linear-gradient(90deg,#8FB4FF,#4FE6C8)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              display: 'block',
              textAlign: 'center',
              marginTop: `${space.sm}px`,
            }}
          >
            <Text variant="display" numeric>
              {usdc}
            </Text>
          </span>
        )}

        {/* USDC label + SOL sub-line */}
        <Text variant="caption" muted center style={{ marginTop: '2px' }}>
          USDC
        </Text>
        <Text variant="caption" color={colors.aqua} center style={{ marginTop: `${space.xs}px` }}>
          {sol} SOL
        </Text>
      </div>

      {/* Quick actions row: Receive · Pay · Earn */}
      <div style={styles.actions}>
        <Action icon="receive" label="Receive" onPress={() => router.push('/receive')} />
        <Action icon="scan" label="Pay" onPress={() => router.push('/scan')} emphasized />
        <Action icon="sprout" label="Earn" onPress={() => router.push('/farming')} />
      </div>

      {/* Earn tip card (only when eligible) */}
      {tip.show && (
        <Card
          glass
          style={{
            background: 'linear-gradient(135deg, rgba(61,116,255,0.26), rgba(47,224,194,0.15))',
            marginTop: `${space.xl}px`,
          }}
        >
          <Text variant="bodyStrong" color={colors.textHi}>
            Idle USDC could earn 4.2%
          </Text>
          <PressRow onPress={() => router.push('/farming')} style={{ marginTop: `${space.sm}px` }}>
            <Text variant="caption" color={colors.aqua}>
              Move to the Earn vault →
            </Text>
          </PressRow>
        </Card>
      )}

      {/* Recent activity */}
      <div style={styles.sectionHead}>
        <Text variant="h3" color={colors.textHi}>
          Recent activity
        </Text>
        <button onClick={() => router.push('/history')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <Text variant="caption" color={colors.accent}>
            See all
          </Text>
        </button>
      </div>

      <Card glass compact>
        {recent.length === 0 ? (
          <div style={styles.empty}>
            <IconBadge name="clock" color={colors.textMute} size={48} />
            <Text variant="caption" muted center style={{ marginTop: `${space.md}px` }}>
              No payments yet. Scan a Navy QR to make your first payment.
            </Text>
          </div>
        ) : (
          recent.map((p, i) => (
            <div key={p.orderId}>
              {i > 0 && <div style={styles.rowDiv} />}
              <div style={styles.txRow}>
                <IconBadge name="arrowUpRight" color={colors.accent} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" color={colors.textHi} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {p.merchant ?? p.reference ?? 'Payment'}
                  </Text>
                  <Text variant="caption" muted>
                    {p.status}
                  </Text>
                </div>
                <Text variant="bodyStrong" numeric color={colors.textHi}>
                  -{usdcBaseToDisplay(p.amount)}
                </Text>
              </div>
            </div>
          ))
        )}
      </Card>
    </Screen>
  );
}

function Action({
  icon,
  label,
  onPress,
  emphasized,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  emphasized?: boolean;
}) {
  if (emphasized) {
    return (
      <PressRow onPress={onPress} style={styles.actionWrap}>
        <Gradient colors={gradients.ocean} style={styles.actionCardEmphasized}>
          <IconBadge name={icon} color={colors.onAccent} size={46} />
          <Text variant="caption" color={colors.onAccent} style={{ marginTop: `${space.sm}px` }}>
            {label}
          </Text>
        </Gradient>
      </PressRow>
    );
  }
  return (
    <PressRow onPress={onPress} style={styles.actionWrap}>
      <div style={styles.actionCard}>
        <IconBadge name={icon} color={colors.accent} size={46} />
        <Text variant="caption" color={colors.text} style={{ marginTop: `${space.sm}px` }}>
          {label}
        </Text>
      </div>
    </PressRow>
  );
}

const styles = {
  header: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: `${space.xxl}px`,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: `${radius.md}px`,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  } as React.CSSProperties,
  heroWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginTop: `${space.xl}px`,
  },
  heroBrow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.sm}px`,
    justifyContent: 'center',
  },
  actions: {
    display: 'flex',
    flexDirection: 'row' as const,
    gap: `${space.md}px`,
    marginTop: `${space.xl}px`,
  },
  actionWrap: {
    flex: 1,
  } as React.CSSProperties,
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: `${radius.lg}px`,
    border: `1px solid ${colors.border}`,
    paddingTop: `${space.lg}px`,
    paddingBottom: `${space.lg}px`,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  actionCardEmphasized: {
    flex: 1,
    borderRadius: `${radius.lg}px`,
    paddingTop: `${space.lg}px`,
    paddingBottom: `${space.lg}px`,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  } as React.CSSProperties,
  sectionHead: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: `${space.xxxl}px`,
    marginBottom: `${space.md}px`,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    paddingTop: `${space.xl}px`,
    paddingBottom: `${space.xl}px`,
  },
  txRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.md}px`,
    paddingTop: `${space.sm}px`,
    paddingBottom: `${space.sm}px`,
  },
  rowDiv: {
    height: '1px',
    backgroundColor: colors.border,
    marginTop: `${space.xs}px`,
    marginBottom: `${space.xs}px`,
  },
} satisfies Record<string, React.CSSProperties>;
