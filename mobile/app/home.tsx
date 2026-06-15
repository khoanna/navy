import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Connection, PublicKey } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { getEnv } from '../src/config/env';
import { fetchBalances, lamportsToSol, usdcBaseToDisplay } from '../src/wallet/balances';

export default function Home() {
  const router = useRouter();
  const solana = useEmbeddedSolanaWallet();
  const address = solana?.wallets?.[0]?.address;
  const [sol, setSol] = useState('—');
  const [usdc, setUsdc] = useState('—');

  useEffect(() => {
    if (!address) return;
    const env = getEnv();
    const connection = new Connection(env.solanaRpc, 'confirmed');
    fetchBalances(connection, new PublicKey(address), new PublicKey(env.usdcMint))
      .then((b) => { setSol(lamportsToSol(b.solLamports)); setUsdc(usdcBaseToDisplay(b.usdcBase)); })
      .catch(() => { setSol('0'); setUsdc('0'); });
  }, [address]);

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Navy Wallet</Text>
      <Text style={styles.bal}>{sol} SOL</Text>
      <Text style={styles.bal}>{usdc} USDC</Text>
      <Text selectable style={styles.addr}>{address ?? 'provisioning…'}</Text>
      <Button title="Scan to pay" onPress={() => router.push('/scan')} />
      <Button title="History" onPress={() => router.push('/history')} />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' }, bal: { fontSize: 28, fontWeight: '700' }, addr: { fontFamily: 'monospace', color: '#555' },
});
