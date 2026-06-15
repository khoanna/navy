import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Transaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { getEnv } from '../../src/config/env';
import { NavyPayClient } from '../../src/pay/navyPayClient';
import { payInvoice } from '../../src/pay/payFlow';

export default function PayScreen() {
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const solana = useEmbeddedSolanaWallet();
  const address = solana?.wallets?.[0]?.address;
  const client = new NavyPayClient(getEnv().navyApiUrl);
  const [order, setOrder] = useState<{ amount: string; reference: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (orderId) client.getOrder(orderId).then(setOrder).catch(() => setOrder(null)); }, [orderId]);

  async function pay() {
    if (!address || !orderId) return;
    setBusy(true);
    try {
      const wallet = (solana as any)?.wallets?.[0];
      // provider.getProvider() returns PrivyEmbeddedSolanaWalletProvider
      // provider.signTransaction(input: { transaction: Uint8Array }) => Promise<{ signedTransaction: Uint8Array }>
      // (from @privy-io/js-sdk-core EmbeddedSolanaWalletProvider.signTransaction)
      const provider = await wallet.getProvider();
      const signTransaction = async (tx: Transaction): Promise<Transaction> => {
        const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        const { signedTransaction } = await provider.signTransaction({ transaction: serialized });
        return Transaction.from(signedTransaction);
      };
      const res = await payInvoice({ orderId, payer: address, client, signTransaction });
      Alert.alert('Paid', `Submitted: ${res.txSignature.slice(0, 16)}…`);
      router.replace('/home');
    } catch (e) { Alert.alert('Payment failed', (e as Error).message); }
    finally { setBusy(false); }
  }

  if (!order) return <View style={styles.c}><Text>Loading invoice…</Text></View>;
  return (
    <View style={styles.c}>
      <Text style={styles.h}>Pay invoice</Text>
      <Text style={styles.amt}>{(Number(order.amount) / 1_000_000).toFixed(2)} USDC</Text>
      <Text>Reference: {order.reference}</Text>
      <Text>Status: {order.status}</Text>
      <Button title={busy ? 'Paying…' : 'Pay'} disabled={busy || order.status !== 'awaiting_payment'} onPress={pay} />
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' }, amt: { fontSize: 30, fontWeight: '700' },
});
