import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { JsonRpcProvider, parseEther, parseUnits } from 'ethers';

import { getEnv } from '@/lib/config/env';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { short } from '@/lib/wallet/identicon';
import {
  fetchBalances,
  makeUsdcReader,
  usdcBaseToDisplay,
  weiToEth,
} from '@/lib/wallet/balances';
import { mapSendError } from '@/lib/wallet/sendErrors';
import { TransferClient } from '@/lib/transfer/transferClient';
import { runTransferFlow } from '@/lib/transfer/transferFlow';

import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ErrorState } from '@/ui/ErrorState';
import { SlideToConfirm } from '@/ui/SlideToConfirm';
import { useToast, ToastIntent } from '@/ui/Toast';
import { Skeleton } from '@/ui/Skeleton';
import { colors, radius, space } from '@/ui/theme';

/** Reserve a little ETH for gas so a MAX/ETH send can still be mined. Matches the backend. */
const GAS_RESERVE_WEI = 300000000000000n; // ~0.0003 ETH

type Asset = 'USDC' | 'ETH';
type Phase = 'idle' | 'sending' | 'done' | 'error';
type Resolved = { address: string; username: string | null };

/** amount (decimal display string) → USDC base units (6dp) string. null if invalid / non-positive. */
function usdcAmountToBase(amount: string): string | null {
  const s = (amount ?? '').trim();
  if (!s) return null;
  try {
    const base = parseUnits(s, 6); // 6-decimal USDC base units, exact
    return base > 0n ? base.toString() : null;
  } catch {
    return null;
  }
}

/** amount (decimal display string) → wei string. null if invalid / non-positive. */
function ethAmountToWei(amount: string): string | null {
  try {
    const wei = parseEther(amount);
    return wei > 0n ? wei.toString() : null;
  } catch {
    return null;
  }
}

export default function SendScreen() {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ to?: string; amountWei?: string; asset?: string }>();
  const { authedFetch } = useNavySession();
  const { address: myAddress, signTypedData, sendTransaction } = useMobileSigner();

  const base = getEnv().navyApiUrl;

  // ── Session guard ─────────────────────────────────────────────────────────
  if (!authedFetch || !myAddress) {
    return (
      <SafeAreaView style={styles.root}>
        <Header onClose={() => router.back()} />
        <View style={styles.center}>
          <Text variant="h3" color={colors.textHi} center>
            Sign in to send
          </Text>
          <Text variant="caption" muted center style={{ marginTop: space.sm }}>
            You need an active Navy session and wallet to send money.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Reachable-safe: after the guard both are defined.
  return (
    <SendInner
      base={base}
      authedFetch={authedFetch}
      myAddress={myAddress}
      signTypedData={signTypedData}
      sendTransaction={sendTransaction}
      params={params}
      router={router}
      toast={toast}
    />
  );
}

function SendInner({
  base,
  authedFetch,
  myAddress,
  signTypedData,
  sendTransaction,
  params,
  router,
  toast,
}: {
  base: string;
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  myAddress: string;
  signTypedData: Parameters<typeof runTransferFlow>[1];
  sendTransaction: (a: { to: string; valueWei: string }) => Promise<string>;
  params: { to?: string; amountWei?: string; asset?: string };
  router: ReturnType<typeof useRouter>;
  toast: (m: string, intent?: ToastIntent) => void;
}) {
  const [asset, setAsset] = useState<Asset>(params.asset === 'ETH' ? 'ETH' : 'USDC');
  const [amount, setAmount] = useState<string>(() =>
    params.amountWei ? weiToEth(params.amountWei) : '',
  );

  // Recipient state.
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [recipientInput, setRecipientInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  // Balances.
  const [usdcBase, setUsdcBase] = useState<string>('0');
  const [ethWei, setEthWei] = useState<string>('0');
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Send phase + error.
  const [phase, setPhase] = useState<Phase>('idle');
  const [sendErr, setSendErr] = useState<{ title: string; detail: string } | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const client = useMemo(() => new TransferClient(base, authedFetch), [base, authedFetch]);

  // Resolve the `?to` param on mount.
  useEffect(() => {
    if (!params.to) return;
    let active = true;
    setResolving(true);
    client
      .resolve(params.to)
      .then((r) => {
        if (active) setResolved(r);
      })
      .catch((e) => {
        if (active) setRecipientError(mapSendError(e).title);
      })
      .finally(() => {
        if (active) setResolving(false);
      });
    return () => {
      active = false;
    };
  }, [client, params.to]);

  // Load balances.
  useEffect(() => {
    let active = true;
    setBalanceLoading(true);
    const provider = new JsonRpcProvider(getEnv().baseRpc);
    const usdcReader = makeUsdcReader(provider, getEnv().usdcAddress);
    fetchBalances(provider, myAddress, usdcReader)
      .then((b) => {
        if (!active) return;
        setUsdcBase(b.usdcBase);
        setEthWei(b.ethWei);
      })
      .catch(() => {
        /* leave zeros on failure */
      })
      .finally(() => {
        if (active) setBalanceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [myAddress]);

  // Resolve a manually-entered recipient (paste 0x or @username) on submit.
  const resolveManual = () => {
    const raw = recipientInput.trim();
    if (!raw) return;
    setResolving(true);
    setRecipientError(null);
    client
      .resolve(raw)
      .then((r) => setResolved(r))
      .catch((e) => setRecipientError(mapSendError(e).title))
      .finally(() => setResolving(false));
  };

  // ── Derived amount / validity ─────────────────────────────────────────────
  const usdcBaseStr = asset === 'USDC' ? usdcAmountToBase(amount) : null;
  const ethWeiStr = asset === 'ETH' ? ethAmountToWei(amount) : null;

  const withinBalance =
    asset === 'USDC'
      ? usdcBaseStr !== null && BigInt(usdcBaseStr) <= BigInt(usdcBase)
      : ethWeiStr !== null && BigInt(ethWeiStr) <= BigInt(ethWei);

  const amountValid = asset === 'USDC' ? usdcBaseStr !== null : ethWeiStr !== null;
  const isSelf =
    !!resolved &&
    !!myAddress &&
    resolved.address.toLowerCase() === myAddress.toLowerCase();
  const canSend =
    !!resolved && !isSelf && amountValid && withinBalance && phase !== 'sending';

  // ── MAX ───────────────────────────────────────────────────────────────────
  const setMax = () => {
    if (asset === 'USDC') {
      setAmount(usdcBaseToDisplay(usdcBase));
    } else {
      const spendable = BigInt(ethWei) - GAS_RESERVE_WEI;
      setAmount(weiToEth(spendable > 0n ? spendable : 0n));
    }
  };

  const balanceDisplay =
    asset === 'USDC'
      ? `${usdcBaseToDisplay(usdcBase)} USDC`
      : `${weiToEth(ethWei)} ETH`;

  // ── Send ──────────────────────────────────────────────────────────────────
  const doSend = () => {
    if (!resolved) return;
    setPhase('sending');
    setSendErr(null);

    const work = async () => {
      if (asset === 'USDC') {
        if (!usdcBaseStr) throw new Error('Invalid amount');
        await runTransferFlow(new TransferClient(base, authedFetch), signTypedData, {
          recipient: resolved.address,
          amountBase: usdcBaseStr,
        });
      } else {
        if (!ethWeiStr) throw new Error('Invalid amount');
        const txHash = await sendTransaction({ to: resolved.address, valueWei: ethWeiStr });
        await new TransferClient(base, authedFetch).recordEth(resolved.address, ethWeiStr, txHash);
      }
    };

    work()
      .then(() => {
        setPhase('done');
        toast('Sent', 'success');
        router.back();
      })
      .catch((e) => {
        setPhase('error');
        setSendErr(mapSendError(e));
        setResetKey((n) => n + 1);
      });
  };

  const recipientLabel = resolved
    ? resolved.username
      ? `@${resolved.username} · ${short(resolved.address)}`
      : short(resolved.address)
    : null;

  return (
    <SafeAreaView style={styles.root}>
      <Header onClose={() => router.back()} />

      <View style={styles.body}>
        {/* Recipient */}
        <Text variant="label" muted upper style={styles.sectionLabel}>
          To
        </Text>
        {params.to || resolved ? (
          <Card compact style={styles.recipientCard}>
            {resolving && !resolved ? (
              <ActivityIndicator color={colors.textDim} />
            ) : recipientLabel ? (
              <Text variant="bodyStrong" color={colors.textHi}>
                {recipientLabel}
              </Text>
            ) : (
              <Text variant="body" color={colors.danger}>
                {recipientError ?? 'Recipient not found'}
              </Text>
            )}
          </Card>
        ) : (
          <>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="@username or 0x address"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                value={recipientInput}
                onChangeText={setRecipientInput}
                onSubmitEditing={resolveManual}
                returnKeyType="done"
              />
              {resolving ? (
                <ActivityIndicator color={colors.textDim} />
              ) : (
                <Pressable onPress={resolveManual} hitSlop={8}>
                  <Text variant="label" color={colors.accent} upper>
                    Find
                  </Text>
                </Pressable>
              )}
            </View>
            {recipientError && (
              <Text variant="caption" color={colors.danger} style={{ marginTop: space.xs }}>
                {recipientError}
              </Text>
            )}
          </>
        )}

        {isSelf && (
          <Text variant="caption" color={colors.danger} style={{ marginTop: space.xs }}>
            You can't send to yourself
          </Text>
        )}

        {/* Asset toggle */}
        <View style={styles.toggle}>
          {(['USDC', 'ETH'] as Asset[]).map((a) => {
            const active = asset === a;
            return (
              <Pressable
                key={a}
                onPress={() => {
                  setAsset(a);
                  setAmount('');
                }}
                style={[styles.toggleBtn, active && styles.toggleBtnActive]}
              >
                <Text
                  variant="bodyStrong"
                  color={active ? colors.textHi : colors.textDim}
                >
                  {a}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Big amount */}
        <View style={styles.amountWrap}>
          {balanceLoading ? (
            <Skeleton width={120} height={52} />
          ) : (
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={colors.textMute}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
          )}
          <Text variant="h2" color={colors.textDim} style={styles.amountUnit}>
            {asset}
          </Text>
        </View>

        {/* Available + MAX */}
        <View style={styles.availRow}>
          {balanceLoading ? (
            <Skeleton width={120} height={14} />
          ) : (
            <Text variant="caption" muted>
              Available {balanceDisplay}
            </Text>
          )}
          {!balanceLoading && (
            <Pressable onPress={setMax} hitSlop={8}>
              <Text variant="label" color={colors.accent} upper>
                Max
              </Text>
            </Pressable>
          )}
        </View>

        {/* Fee bar */}
        <Card glass compact style={styles.feeBar}>
          <Text variant="caption" color={colors.text}>
            {asset === 'USDC'
              ? 'Gasless · network fee $0.00 (relayed)'
              : 'Network fee paid from your ETH'}
          </Text>
        </Card>

        {/* Send failure — persistent + retryable (distinct from inline recipient errors) */}
        {phase === 'error' && sendErr && (
          <Card compact style={styles.errCard}>
            <ErrorState compact error={sendErr} onRetry={canSend ? doSend : undefined} />
          </Card>
        )}

        <View style={{ flex: 1 }} />

        {/* Slide to confirm */}
        <SlideToConfirm
          label={phase === 'sending' ? 'Sending…' : 'Slide to send'}
          onConfirm={doSend}
          disabled={!canSend}
          resetKey={resetKey}
        />
      </View>
    </SafeAreaView>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close">
        <Text variant="h3" color={colors.textHi}>
          ✕
        </Text>
      </Pressable>
      <Text variant="label" color={colors.textHi} upper>
        Send
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  body: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
  sectionLabel: {
    marginBottom: space.sm,
  },
  recipientCard: {
    minHeight: 52,
    justifyContent: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  input: {
    flex: 1,
    paddingVertical: space.lg,
    color: colors.textHi,
    fontSize: 16,
  },
  toggle: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.pill,
    padding: 4,
    marginTop: space.xl,
    alignSelf: 'center',
  },
  toggleBtn: {
    paddingVertical: space.sm,
    paddingHorizontal: space.xxl,
    borderRadius: radius.pill,
  },
  toggleBtnActive: {
    backgroundColor: colors.surfaceHi,
  },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: space.xxxl,
    gap: space.sm,
  },
  amountInput: {
    color: colors.textHi,
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1.5,
    minWidth: 80,
    textAlign: 'center',
    padding: 0,
  },
  amountUnit: {
    marginBottom: space.xs,
  },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  feeBar: {
    marginTop: space.xl,
    alignItems: 'center',
  },
  errCard: {
    marginTop: space.lg,
    borderColor: 'rgba(255,107,131,0.3)',
    backgroundColor: 'rgba(255,107,131,0.10)',
  },
});
