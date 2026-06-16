import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert, StyleSheet } from 'react-native';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';
import { getEnv } from '../src/config/env';
import { FarmingClient, formatSol, Position } from '../src/farming/farmingClient';

export default function Farming() {
  const { session } = useNavySession();
  const solana = useEmbeddedSolanaWallet();
  const token = session?.tokens.accessToken;
  const client = new FarmingClient(getEnv().navyApiUrl);
  const [pos, setPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() { if (token) { try { setPos(await client.getPosition(token)); } catch { setPos(null); } } }
  useEffect(() => { refresh(); }, [token]);

  async function start() {
    if (!token) return; setBusy(true);
    try { await client.createSubwallet(token); await refresh(); } catch (e) { Alert.alert('Error', (e as Error).message); } finally { setBusy(false); }
  }

  async function fund() {
    if (!token || !pos) return; setBusy(true);
    try {
      const env = getEnv();
      const connection = new Connection(env.solanaRpc, 'confirmed');
      const wallet = (solana as any)?.wallets?.[0];
      const from = new PublicKey(wallet.address);
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(pos.address), lamports: 100_000_000 }));
      tx.feePayer = from; tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const provider = await wallet.getProvider();
      const { signedTransaction } = await provider.signTransaction({ transaction: tx.serialize({ requireAllSignatures: false }) });
      await connection.sendRawTransaction(signedTransaction);
      Alert.alert('Funded', 'Sent 0.1 SOL to your farming subwallet'); await refresh();
    } catch (e) { Alert.alert('Fund failed', (e as Error).message); } finally { setBusy(false); }
  }

  async function withdraw() {
    if (!token) return; setBusy(true);
    try { const r = await client.withdraw(token, 'all'); Alert.alert('Withdrawn', r.txSignature.slice(0, 16) + '…'); await refresh(); }
    catch (e) { Alert.alert('Withdraw failed', (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Farming</Text>
      {!pos && <Button title={busy ? '…' : 'Start farming'} disabled={busy} onPress={start} />}
      {pos && (
        <>
          <Text style={styles.l}>Subwallet</Text><Text selectable style={styles.mono}>{pos.address}</Text>
          <Text style={styles.l}>Principal</Text><Text>{formatSol(pos.principalLamports)} SOL</Text>
          <Text style={styles.l}>Current value</Text><Text style={styles.big}>{formatSol(pos.currentValueLamports)} SOL</Text>
          <Button title={busy ? '…' : 'Fund 0.1 SOL from wallet'} disabled={busy} onPress={fund} />
          <Button title={busy ? '…' : 'Withdraw all to my wallet'} disabled={busy} onPress={withdraw} />
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' }, l: { marginTop: 12, fontWeight: '600' }, big: { fontSize: 26, fontWeight: '700' }, mono: { fontFamily: 'monospace' },
});
