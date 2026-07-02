'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { FarmingClient, formatSol, Position } from '@/lib/farming/farmingClient';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { IconBadge, Pill, Divider } from '@/ui/Bits';
import { useToast } from '@/ui/Toast';
import { colors, gradients, radius, space } from '@/ui/theme';

const FUND_LAMPORTS = 100_000_000; // 0.1 SOL

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-6)}`;
}

export default function Farming() {
  const { session } = useNavySession();
  const { address, sign } = useWebSigner();
  const toast = useToast();
  const token = session?.tokens.accessToken;
  const client = new FarmingClient(getEnv().navyApiUrl);

  const [pos, setPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setPos(await client.getPosition(token));
    } catch {
      setPos(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pull = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const guard = async (fn: () => Promise<void>, label: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const start = () => guard(() => client.createSubwallet(token!).then(() => {}), 'Could not start farming');

  const fund = () =>
    guard(async () => {
      if (!pos || !address) return;
      const env = getEnv();
      const connection = new Connection(env.solanaRpc, 'confirmed');
      const from = new PublicKey(address);
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(pos.address), lamports: FUND_LAMPORTS }),
      );
      tx.feePayer = from;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await sign(tx);
      await connection.sendRawTransaction(signed.serialize());
      toast('Funded: Sent 0.1 SOL to your farming subwallet.');
    }, 'Funding failed');

  const withdraw = () =>
    guard(async () => {
      const r = await client.withdraw(token!, 'all');
      toast(`Withdrawn: Tx ${r.txSignature.slice(0, 16)}…`);
    }, 'Withdraw failed');

  const principal = pos ? Number(formatSol(pos.principalLamports)) : 0;
  const current = pos ? Number(formatSol(pos.currentValueLamports)) : 0;
  const gain = current - principal;
  const gainPct = principal > 0 ? (gain / principal) * 100 : 0;

  return (
    <Screen scroll tabSafe onRefresh={pull} refreshing={refreshing}>
      {/* Header */}
      <div style={styles.head}>
        <Text variant="label" muted upper>
          Earn
        </Text>
        <Text variant="h1" color={colors.textHi} style={{ marginTop: '2px' }}>
          Grow your SOL
        </Text>
        <Text variant="caption" dim style={{ marginTop: `${space.xs}px` }}>
          Idle SOL earns yield on Save (Solend) — withdraw anytime.
        </Text>
      </div>

      {!pos ? (
        /* Empty state */
        <Card elevated style={{ marginTop: `${space.xl}px`, alignItems: 'center', paddingTop: `${space.xxxl}px`, paddingBottom: `${space.xxxl}px` }}>
          <IconBadge name="sprout" color={colors.aqua} size={76} />
          <Text variant="h2" color={colors.textHi} center style={{ marginTop: `${space.lg}px` }}>
            Start earning
          </Text>
          <Text
            dim
            center
            style={{
              marginTop: `${space.sm}px`,
              marginBottom: `${space.xl}px`,
              paddingLeft: `${space.sm}px`,
              paddingRight: `${space.sm}px`,
            }}
          >
            Navy creates a secure, encrypted subwallet that auto-deposits into the yield reserve. Your keys never leave Navy's signer.
          </Text>
          <Button label="Create farming wallet" icon="plus" loading={busy} onPress={start} />
        </Card>
      ) : (
        <>
          {/* Value hero */}
          <Gradient
            colors={gradients.aquaGlow}
            glow
            style={{ ...styles.hero, boxShadow: '0 10px 22px rgba(47,224,194,0.45)' }}
          >
            <Text variant="label" color="rgba(4,17,31,0.65)" upper>
              Current value
            </Text>
            <div style={styles.amtRow}>
              <Text variant="display" numeric color={colors.onAccent}>
                {current.toFixed(4)}
              </Text>
              <Text variant="h2" color="rgba(4,17,31,0.6)" style={{ marginBottom: '6px' }}>
                SOL
              </Text>
            </div>
            <div style={styles.gainChip}>
              <Icon name="trend" size={14} color={colors.onAccent} strokeWidth={2.4} />
              <Text variant="caption" color={colors.onAccent}>
                {gain >= 0 ? '+' : ''}
                {gain.toFixed(4)} SOL ({gainPct >= 0 ? '+' : ''}
                {gainPct.toFixed(2)}%)
              </Text>
            </div>
          </Gradient>

          {/* Details card */}
          <Card style={{ marginTop: `${space.lg}px` }}>
            <div style={styles.detailRow}>
              <Text variant="caption" dim>
                Principal deposited
              </Text>
              <Text variant="bodyStrong" numeric color={colors.textHi}>
                {principal.toFixed(4)} SOL
              </Text>
            </div>
            <Divider style={{ marginTop: `${space.md}px`, marginBottom: `${space.md}px` }} />
            <div style={styles.detailRow}>
              <Text variant="caption" dim>
                Yield earned
              </Text>
              <Text variant="bodyStrong" numeric color={gain >= 0 ? colors.success : colors.danger}>
                {gain >= 0 ? '+' : ''}
                {gain.toFixed(4)} SOL
              </Text>
            </div>
            <Divider style={{ marginTop: `${space.md}px`, marginBottom: `${space.md}px` }} />
            <div style={styles.detailRow}>
              <Text variant="caption" dim>
                Subwallet
              </Text>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(pos.address);
                  toast('Subwallet address copied.');
                }}
                style={styles.copyRow}
              >
                <Text variant="mono" color={colors.text}>
                  {short(pos.address)}
                </Text>
                <Icon name="copy" size={14} color={colors.textDim} />
              </button>
            </div>
          </Card>

          {/* Fund / Withdraw buttons */}
          <div style={styles.btnRow}>
            <div style={{ flex: 1 }}>
              <Button label="Fund 0.1 SOL" icon="plus" variant="secondary" loading={busy} onPress={fund} />
            </div>
            <div style={{ flex: 1 }}>
              <Button label="Withdraw all" icon="down" variant="ghost" loading={busy} onPress={withdraw} />
            </div>
          </div>

          {/* Devnet note */}
          <div style={styles.noteRow}>
            <Pill label="Devnet" tone="warning" />
            <Text variant="caption" muted style={{ flex: 1 }}>
              Funding signs a transfer from your main wallet. Withdraw returns principal + yield to your wallet.
            </Text>
          </div>
        </>
      )}
    </Screen>
  );
}

const styles = {
  head: {
    marginTop: `${space.md}px`,
  },
  hero: {
    borderRadius: `${radius.xxl}px`,
    padding: `${space.xxl}px`,
    marginTop: `${space.xl}px`,
  } as React.CSSProperties,
  amtRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'flex-end',
    gap: `${space.sm}px`,
    marginTop: `${space.md}px`,
  },
  gainChip: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '5px',
    alignSelf: 'flex-start' as const,
    backgroundColor: 'rgba(4,17,31,0.16)',
    paddingLeft: `${space.md}px`,
    paddingRight: `${space.md}px`,
    paddingTop: '6px',
    paddingBottom: '6px',
    borderRadius: `${radius.pill}px`,
    marginTop: `${space.lg}px`,
  },
  detailRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  copyRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  } as React.CSSProperties,
  btnRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    gap: `${space.md}px`,
    marginTop: `${space.lg}px`,
  },
  noteRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.md}px`,
    marginTop: `${space.xl}px`,
  },
} satisfies Record<string, React.CSSProperties>;
