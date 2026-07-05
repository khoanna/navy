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
import { Icon } from '@/ui/Icon';
import { IconBadge, Pill } from '@/ui/Bits';
import { Skeleton } from '@/ui/Skeleton';
import { useToast } from '@/ui/Toast';
import { colors, radius, space } from '@/ui/theme';

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
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setPos(await client.getPosition(token));
    } catch {
      setPos(null);
    } finally {
      setLoaded(true);
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

  const loading = !loaded;

  return (
    <Screen scroll tabSafe onRefresh={pull} refreshing={refreshing}>
      {/* Header */}
      <div style={styles.head}>
        <Text variant="h2" color={colors.textHi}>
          Earn
        </Text>
        <Text variant="caption" dim>
          Save · devnet
        </Text>
      </div>

      {loading ? (
        /* Loading hero */
        <Card
          glass
          style={{
            ...styles.hero,
            background: 'linear-gradient(135deg, rgba(61,116,255,0.28), rgba(47,224,194,0.16))',
          }}
        >
          <Text variant="label" muted upper center>
            Deposited · earning
          </Text>
          <Skeleton width={170} height={44} style={{ margin: '6px auto' }} />
        </Card>
      ) : !pos ? (
        /* Empty state — start farming */
        <Card
          glass
          style={{ marginTop: `${space.xl}px`, alignItems: 'center', paddingTop: `${space.xxxl}px`, paddingBottom: `${space.xxxl}px` }}
        >
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
            Navy creates a secure, encrypted subwallet that auto-deposits into the yield reserve. Your keys never leave Navy&apos;s signer.
          </Text>
          <Button label="Create farming wallet" icon="plus" loading={busy} onPress={start} />
        </Card>
      ) : (
        <>
          {/* Position hero */}
          <Card
            glass
            style={{
              ...styles.hero,
              background: 'linear-gradient(135deg, rgba(61,116,255,0.28), rgba(47,224,194,0.16))',
            }}
          >
            <Text variant="label" muted upper center>
              Deposited · earning
            </Text>
            <div style={styles.heroAmt}>
              <Text variant="display" numeric color={colors.textHi}>
                {current.toFixed(4)}
              </Text>
              <Text variant="h3" color={colors.textDim} style={{ marginLeft: '6px' }}>
                SOL
              </Text>
            </div>
            <Text variant="caption" color={colors.aqua}>
              {gain >= 0 ? '+' : ''}
              {gain.toFixed(4)} SOL earned ({gainPct >= 0 ? '+' : ''}
              {gainPct.toFixed(2)}%)
            </Text>
          </Card>

          {/* Deposit / Withdraw actions */}
          <div style={styles.btnRow}>
            <div style={{ flex: 1 }}>
              <Button label="Deposit 0.1 SOL" icon="plus" loading={busy} onPress={fund} />
            </div>
            <div style={{ flex: 1 }}>
              <Button label="Withdraw all" icon="down" variant="secondary" loading={busy} onPress={withdraw} />
            </div>
          </div>

          {/* How it works */}
          <Text variant="h3" color={colors.textHi} style={{ marginTop: `${space.xl}px`, display: 'block' }}>
            How it works
          </Text>
          <Card glass compact style={{ marginTop: `${space.md}px` }}>
            <Text variant="caption" color={colors.text}>
              Your USDC is deposited into Save&apos;s SOL reserve via a Navy-secured subwallet. Keys stay encrypted — the agent can
              never move funds off-policy.
            </Text>
          </Card>

          {/* Positions list */}
          <Card glass compact style={{ marginTop: `${space.md}px` }}>
            <div style={styles.posRow}>
              <IconBadge name="sprout" color={colors.aqua} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" color={colors.textHi} style={{ display: 'block' }}>
                  SOL reserve
                </Text>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(pos.address);
                    toast('Subwallet address copied.');
                  }}
                  style={styles.copyRow}
                >
                  <Text variant="mono" color={colors.textDim}>
                    {short(pos.address)}
                  </Text>
                  <Icon name="copy" size={12} color={colors.textDim} />
                </button>
              </div>
              <Text variant="bodyStrong" numeric color={colors.textHi}>
                {current.toFixed(4)} SOL
              </Text>
            </div>
          </Card>

          {/* Devnet note */}
          <div style={styles.noteRow}>
            <Pill label="Devnet" tone="warning" />
            <Text variant="caption" muted style={{ flex: 1 }}>
              Depositing signs a transfer from your main wallet. Withdraw returns principal + yield to your wallet.
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
    display: 'flex',
    flexDirection: 'row' as const,
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  hero: {
    borderRadius: `${radius.xxl}px`,
    padding: `${space.xxl}px`,
    marginTop: `${space.xl}px`,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: `${space.xs}px`,
  } as React.CSSProperties,
  heroAmt: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: '2px',
    marginBottom: '2px',
  },
  posRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.md}px`,
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
