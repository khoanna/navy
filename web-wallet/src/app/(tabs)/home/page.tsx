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
import { IconBadge, PressRow } from '@/ui/Bits';
import { useToast } from '@/ui/Toast';
import { colors, gradients, radius, space } from '@/ui/theme';

function short(addr?: string) {
  return addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : 'provisioning…';
}

export default function Home() {
  const router = useRouter();
  const { signOut, session } = useNavySession();
  const { address } = useWebSigner();
  const token = session?.tokens.accessToken;
  const toast = useToast();

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

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast('Wallet address copied');
  };

  const handleSignOut = () => {
    if (window.confirm('End your session?')) {
      signOut();
    }
  };

  return (
    <Screen scroll tabSafe onRefresh={refresh} refreshing={refreshing}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <Text variant="label" muted upper>
            Navy Wallet
          </Text>
          <Text variant="h2" color={colors.textHi} style={{ marginTop: '2px' }}>
            Good to see you
          </Text>
        </div>
        <button onClick={handleSignOut} style={styles.iconBtn}>
          <Icon name="logout" size={20} color={colors.textDim} />
        </button>
      </div>

      {/* Balance hero */}
      <Gradient
        colors={gradients.ocean}
        glow
        style={{
          ...styles.hero,
          boxShadow: `0 10px 22px rgba(79,140,255,0.5)`,
        }}
      >
        <div style={styles.heroTop}>
          <Text variant="label" color="rgba(4,17,31,0.65)" upper>
            USDC Balance
          </Text>
          <div style={styles.chip}>
            <Icon name="bolt" size={13} color={colors.onAccent} />
            <Text variant="label" color={colors.onAccent}>
              Gasless
            </Text>
          </div>
        </div>

        <div style={styles.amountRow}>
          <Text variant="display" numeric color={colors.onAccent}>
            {usdc}
          </Text>
          <Text variant="h2" color="rgba(4,17,31,0.6)" style={{ marginBottom: '6px' }}>
            USDC
          </Text>
        </div>

        <div style={styles.heroFoot}>
          <div style={styles.solChip}>
            <Icon name="trend" size={14} color={colors.onAccent} strokeWidth={2.2} />
            <Text variant="caption" color={colors.onAccent}>
              {sol} SOL
            </Text>
          </div>
          <button onClick={copy} style={styles.addrChip}>
            <Text variant="mono" color="rgba(4,17,31,0.75)">
              {short(address)}
            </Text>
            <Icon name="copy" size={14} color="rgba(4,17,31,0.75)" />
          </button>
        </div>
      </Gradient>

      {/* Quick actions */}
      <div style={styles.actions}>
        <Action icon="scan" label="Scan & Pay" onPress={() => router.push('/scan')} accent={colors.accent} />
        <Action icon="receive" label="Receive" onPress={copy} accent={colors.aqua} />
        <Action icon="sprout" label="Earn" onPress={() => router.push('/farming')} accent={colors.warning} />
      </div>

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

      <Card compact>
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

function Action({ icon, label, onPress, accent }: { icon: IconName; label: string; onPress: () => void; accent: string }) {
  return (
    <PressRow onPress={onPress} style={styles.actionWrap}>
      <div style={styles.actionCard}>
        <IconBadge name={icon} color={accent} size={46} />
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
  hero: {
    borderRadius: `${radius.xxl}px`,
    padding: `${space.xxl}px`,
  } as React.CSSProperties,
  heroTop: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '4px',
    backgroundColor: 'rgba(4,17,31,0.14)',
    paddingLeft: `${space.md}px`,
    paddingRight: `${space.md}px`,
    paddingTop: '5px',
    paddingBottom: '5px',
    borderRadius: `${radius.pill}px`,
  },
  amountRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'flex-end',
    gap: `${space.sm}px`,
    marginTop: `${space.lg}px`,
  },
  heroFoot: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: `${space.xl}px`,
  },
  solChip: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '5px',
    backgroundColor: 'rgba(4,17,31,0.14)',
    paddingLeft: `${space.md}px`,
    paddingRight: `${space.md}px`,
    paddingTop: '6px',
    paddingBottom: '6px',
    borderRadius: `${radius.pill}px`,
  },
  addrChip: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '6px',
    backgroundColor: 'rgba(4,17,31,0.14)',
    paddingLeft: `${space.md}px`,
    paddingRight: `${space.md}px`,
    paddingTop: '6px',
    paddingBottom: '6px',
    borderRadius: `${radius.pill}px`,
    border: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,
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
