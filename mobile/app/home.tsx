import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useNavySession } from '../src/auth/SessionContext';

export default function Home() {
  const router = useRouter();
  const { session, signOut } = useNavySession();
  const solana = useEmbeddedSolanaWallet();
  const address = solana.wallets?.[0]?.address ?? 'provisioning…';

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Navy Wallet</Text>
      <Text style={styles.l}>Solana address</Text>
      <Text selectable style={styles.mono}>{address}</Text>
      <Text style={styles.l}>Navy session</Text>
      <Text style={styles.mono}>{session ? 'active' : 'none'}</Text>
      <Button title="Sign out" onPress={async () => { await signOut(); router.replace('/login'); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' },
  l: { marginTop: 16, fontWeight: '600' },
  mono: { fontFamily: 'monospace' },
});
