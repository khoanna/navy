'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Connection, PublicKey } from '@solana/web3.js';
import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { fetchBalances, lamportsToSol, usdcBaseToDisplay } from '@/lib/wallet/balances';
import { NavyPayClient, Payment } from '@/lib/pay/navyPayClient';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
import { short, avatarColors } from '@/lib/wallet/identicon';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Gradient } from '@/ui/Gradient';
import { Card } from '@/ui/Card';
import { Icon, IconName } from '@/ui/Icon';
import { IconBadge, GlowIcon, PressRow } from '@/ui/Bits';
import { colors, gradients, radius, space } from '@/ui/theme';
import { earnTip } from '@/lib/wallet/tips';

export default function Home() {
  const router = useRouter();
  const { session } = useNavySession();
  const { address } = useWebSigner();
  const token = session?.tokens.accessToken;

  const [sol, setSol] = useState('—');
  const [usdc, setUsdc] = useState('—');
  const [recent, setRecent] = useState<Payment[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  // Tip: nudge idle USDC into the Earn vault
  const usdcNumeric = usdc === '—' ? 0 : Number(usdc.replaceAll(',', '')) || 0;
  const tip = earnTip(usdcNumeric, 100);
  const [avA, avB] = avatarColors(address);

  return (
    <Screen scroll tabSafe onRefresh={refresh} refreshing={refreshing}>
      {/* Hero: wallet identity + balance, on a deep-ocean gradient */}
      <Gradient colors={gradients.oceanDeep} glow style={styles.hero}>
        <div style={styles.heroTop}>
          <div style={styles.idRow}>
            <div style={{ ...styles.avatar, backgroundImage: `linear-gradient(135deg, ${avA}, ${avB})` }} />
            <div style={{ minWidth: 0 }}>
              <Text variant="caption" color="rgba(255,255,255,0.72)">
                Welcome back
              </Text>
              <button onClick={copyAddress} style={styles.addrPill} aria-label="Copy wallet address">
                <Text variant="bodyStrong" numeric color={colors.textHi}>
                  {short(address)}
                </Text>
                <Icon name={copied ? 'check' : 'copy'} size={13} color="rgba(255,255,255,0.9)" />
              </button>
            </div>
          </div>
          <div style={styles.gasless}>
            <span style={styles.gaslessDot} />
            <Text variant="label" color={colors.textHi} style={{ fontSize: 10, letterSpacing: '0.6px' }}>
              GASLESS
            </Text>
          </div>
        </div>

        <div style={styles.balanceBlock}>
          <Text variant="label" upper color="rgba(255,255,255,0.6)">
            Total balance
          </Text>
          {usdc === '—' ? (
            <div style={styles.balSkeleton} />
          ) : (
            <div style={styles.balRow}>
              <Text variant="display" numeric color={colors.textHi}>
                {usdc}
              </Text>
              <Text variant="h3" color="rgba(255,255,255,0.62)">
                USDC
              </Text>
            </div>
          )}
          <Text variant="caption" numeric color="rgba(255,255,255,0.72)" style={{ marginTop: '2px' }}>
            ≈ {sol} SOL
          </Text>
        </div>
      </Gradient>

      {/* Quick actions row: Receive · Pay · Earn */}
      <div style={styles.actions}>
        <Action icon="receive" label="Receive" onPress={() => router.push('/receive')} />
        <Action icon="scan" label="Pay" onPress={() => router.push('/scan')} primary />
        <Action icon="sprout" label="Earn" onPress={() => router.push('/farming')} />
      </div>

      {/* Earn tip card (only when eligible) */}
      {tip.show && (
        <Card glass style={{ marginTop: `${space.xl}px`, boxShadow: `inset 3px 0 0 0 ${colors.aqua}` }}>
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
          <Text variant="caption" color={colors.aqua}>
            See all
          </Text>
        </button>
      </div>

      <Card glass compact>
        {recent.length === 0 ? (
          <div style={styles.empty}>
            <GlowIcon name="clock" color={colors.textDim} size={72} />
            <Text variant="caption" muted center style={{ marginTop: `${space.md}px` }}>
              No payments yet. Scan a Navy QR to make your first payment.
            </Text>
          </div>
        ) : (
          recent.map((p, i) => (
            <div key={p.orderId}>
              {i > 0 && <div style={styles.rowDiv} />}
              <div style={styles.txRow}>
                <IconBadge name="arrowUpRight" color={colors.textDim} size={40} />
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

/** A quick-action tile — a single layer, no nested badge. The primary action
 *  (Pay) is a filled ocean tile; the others are flat navy tiles. Icon sits
 *  directly on the tile. */
function Action({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <PressRow onPress={onPress} style={styles.actionWrap}>
      <div style={primary ? styles.actionPrimary : styles.actionCard}>
        <Icon name={icon} size={24} color={primary ? colors.textHi : colors.text} strokeWidth={1.9} />
        <Text variant="caption" color={primary ? colors.textHi : colors.textDim} style={{ marginTop: `${space.sm}px` }}>
          {label}
        </Text>
      </div>
    </PressRow>
  );
}

const styles = {
  hero: {
    borderRadius: `${radius.xl}px`,
    padding: `${space.xl}px`,
    boxShadow: '0 18px 42px rgba(4,18,40,0.55)',
  } as React.CSSProperties,
  heroTop: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  idRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.md}px`,
    minWidth: 0,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: `${radius.pill}px`,
    border: '1px solid rgba(255,255,255,0.4)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.28)',
    flexShrink: 0,
  } as React.CSSProperties,
  addrPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
    padding: '4px 10px',
    background: 'rgba(255,255,255,0.14)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: `${radius.pill}px`,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  } as React.CSSProperties,
  gasless: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    background: 'rgba(255,255,255,0.14)',
    border: '1px solid rgba(255,255,255,0.22)',
    borderRadius: `${radius.pill}px`,
    flexShrink: 0,
  } as React.CSSProperties,
  gaslessDot: {
    width: '6px',
    height: '6px',
    borderRadius: `${radius.pill}px`,
    background: colors.aqua,
    boxShadow: `0 0 8px ${colors.aqua}`,
  } as React.CSSProperties,
  balanceBlock: {
    marginTop: `${space.xxl}px`,
  },
  balRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'baseline',
    gap: `${space.sm}px`,
    marginTop: '4px',
  },
  balSkeleton: {
    width: '180px',
    height: '44px',
    borderRadius: `${radius.sm}px`,
    background: 'rgba(255,255,255,0.16)',
    marginTop: '6px',
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
  actionPrimary: {
    flex: 1,
    borderRadius: `${radius.lg}px`,
    backgroundImage: 'linear-gradient(135deg, #3D74FF, #2FE0C2)',
    boxShadow: '0 8px 20px rgba(23,196,168,0.22)',
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
